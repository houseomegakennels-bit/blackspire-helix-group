import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFile,spawnSync} from 'node:child_process';
import {promisify} from 'node:util';
import {readRootOwnedJsonSnapshot} from '../buyer-writer/protected-json.js';
import {validateBuyerWriterClientConfiguration,validateBuyerWriterGatewayProvisioningConfiguration} from '../buyer-writer/configuration.js';
import {resolveBuyerWriterIdentity} from '../buyer-writer/runtime-identity.js';
import {inspectBuyerWriterArtifact} from '../buyer-writer/artifact-inspection.js';
import {createBuyerWriterGatewayPostgres} from '../buyer-writer/local-gateway-postgres.js';

const execute=promisify(execFile),plans=new WeakMap();
const reject=()=>{throw new Error('Zola configuration installation rejected');};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const defaults={configDirectory:'/etc/blackspire',gatewayConfigDirectory:'/etc/blackspire-buyer-writer-gateway',
  unitDirectory:'/etc/systemd/system',releaseRoot:'/opt/blackspire-command/releases'};
const options={encoding:'utf8',timeout:2000,maxBuffer:8192,killSignal:'SIGKILL',env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}};

function directory(io,name){
  if(!path.isAbsolute(name)||path.resolve(name)!==name)reject();
  let current='/';
  for(const part of ['',...name.split('/').filter(Boolean)]){
    if(part)current=path.join(current,part);
    const s=io.lstatSync(current);
    if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022)!==0)reject();
  }
}
function privateGatewayDirectory(io,name,gid){
  directory(io,name);const stat=io.lstatSync(name);
  if(stat.uid!==0||stat.gid!==gid||(stat.mode&0o7777)!==0o750)reject();
}
function syncDirectory(io,name){const fd=io.openSync(name,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{io.fsyncSync(fd);}finally{io.closeSync(fd);}}
function checkAcl(acl,fd){
  const result=acl('/usr/bin/getfacl',['--numeric','--omit-header','--skip-base','--logical','--','/proc/self/fd/3'],{...options,stdio:['ignore','pipe','pipe',fd]});
  if(result.status!==0||result.error||result.stdout!==''||result.stderr!=='')reject();
}
function checkDirectoryDefaultAcl(acl,name){
  const result=acl('/usr/bin/getfacl',['--numeric','--omit-header','--skip-base','--default','--logical','--',name],options);
  if(result.status!==0||result.error||result.stdout!==''||result.stderr!=='')reject();
}
function readExact(io,acl,name,bytes,gid,mode,uid=0){
  directory(io,path.dirname(name));let fd;
  try{
    fd=io.openSync(name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    const a=io.fstatSync(fd);
    if(!a.isFile()||a.uid!==uid||a.gid!==gid||a.nlink!==1||(a.mode&0o7777)!==mode||a.size!==bytes.length)reject();
    checkAcl(acl,fd);
    const found=Buffer.alloc(bytes.length+1);let count=0;
    while(count<found.length){const n=io.readSync(fd,found,count,found.length-count,null);if(!n)break;count+=n;}
    const b=io.fstatSync(fd);
    if(count!==bytes.length||!found.subarray(0,count).equals(bytes)||['dev','ino','uid','gid','mode','nlink','size','ctimeMs','mtimeMs'].some(k=>a[k]!==b[k]))reject();
    return true;
  }catch(error){if(error.code==='ENOENT')return false;throw error;}finally{if(fd!==undefined)io.closeSync(fd);}
}
// Atomic no-replace publication. A crash can leave an inert temporary file or
// a two-link inode that readers reject; never replace or delete foreign state.
function publish(io,acl,name,bytes,gid,mode,uid=0){
  if(readExact(io,acl,name,bytes,gid,mode,uid))return 'existing';
  const temporary=path.join(path.dirname(name),'.zola-install-'+randomUUID()+'.tmp');let fd,identity;
  try{
    fd=io.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    identity=io.fstatSync(fd);
    // A directory default ACL can create masked named-user entries even at
    // mode0600. Reject them while this inode is EMPTY, before chmod enables its
    // group mask and before any credential bytes are written.
    checkAcl(acl,fd);
    io.fchownSync(fd,uid,gid);io.fchmodSync(fd,mode);io.writeFileSync(fd,bytes);io.fsyncSync(fd);io.closeSync(fd);fd=undefined;
    if(!readExact(io,acl,temporary,bytes,gid,mode,uid))reject();
    io.linkSync(temporary,name);io.unlinkSync(temporary);syncDirectory(io,path.dirname(name));
    if(!readExact(io,acl,name,bytes,gid,mode,uid))reject();return 'published';
  }finally{
    if(fd!==undefined)io.closeSync(fd);
    try{const s=io.lstatSync(temporary);if(identity&&s.dev===identity.dev&&s.ino===identity.ino)io.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
}

async function hostState(run){
  const results=[];
  for(const unit of ['blackspire-command.service','blackspire-command-worker.service','blackspire-buyer-writer-gateway.service']){
    const r=await run('/usr/bin/systemctl',['show','--no-pager','--property=ActiveState,SubState,MainPID,User,Group','--',unit],options);
    if(r.stderr!=='')reject();const pairs=r.stdout.trim().split('\n').map(s=>s.split('='));
    if(pairs.length!==5||new Set(pairs.map(p=>p[0])).size!==5||pairs.some(p=>p.length!==2))reject();
    const expectedUser=unit==='blackspire-command.service'?'blackspire-api':unit==='blackspire-command-worker.service'?'blackspire-worker':'blackspire-writer';
    const expectedGroup=unit==='blackspire-buyer-writer-gateway.service'?'blackspire-api':'blackspire';
    const v=Object.fromEntries(pairs);if(v.ActiveState!=='inactive'||v.SubState!=='dead'||v.MainPID!=='0'||v.User!==expectedUser||v.Group!==expectedGroup)reject();results.push(v);
  }
  return results;
}
async function hostIdentity(run){
  const p=await run('/usr/bin/getent',['passwd','blackspire-api'],options),g=await run('/usr/bin/id',['-G','blackspire-api'],options);
  const fields=p.stdout.trim().split(':');if(p.stderr!==''||g.stderr!==''||fields.length!==7||fields[0]!=='blackspire-api'||fields.some(f=>f.includes('\n')))reject();
  const uid=Number(fields[2]),gid=Number(fields[3]),groups=g.stdout.trim().split(/\s+/).map(Number);
  const identity=await resolveBuyerWriterIdentity({uid,euid:uid,gid,egid:gid,groups,lookup:run});
  const writer=await run('/usr/bin/getent',['passwd','blackspire-writer'],options),writerFields=writer.stdout.trim().split(':');
  if(writer.stderr!==''||writerFields.length!==7||writerFields[0]!=='blackspire-writer'||writerFields.some(f=>f.includes('\n')))reject();
  const gatewayUid=Number(writerFields[2]),gatewayGid=Number(writerFields[3]);
  if(!Number.isSafeInteger(gatewayUid)||gatewayUid<=0||!Number.isSafeInteger(gatewayGid)||gatewayGid<=0)reject();
  return {...identity,gatewayUid,gatewayGid};
}

// No connections and no filesystem mutations while preparing a plan. Production
// CLI does not expose the injectable dependencies used by disposable tests.
export async function prepareZolaConfigurationInstall({releaseSha,configurationFile},{io=fs,acl=spawnSync,run=execute,
  readSnapshot=readRootOwnedJsonSnapshot,inspectArtifact=inspectBuyerWriterArtifact,identity=hostIdentity,paths=defaults,uid=process.getuid()}={}){
  try{
    if(uid!==0||!(/^[a-f0-9]{40}$/).test(releaseSha??''))reject();
    directory(io,paths.configDirectory);directory(io,paths.unitDirectory);
    const state=await hostState(run),ids=await identity(run);
    privateGatewayDirectory(io,paths.gatewayConfigDirectory,ids.gatewayGid);
    const snapshot=readSnapshot(configurationFile,{groupId:ids.credentialGroupId,maxBytes:65536});
    const config=validateBuyerWriterGatewayProvisioningConfiguration(snapshot.value,{workspace:'blackspire-command'});
    if(config.authority.releaseSha!==releaseSha)reject();
    if(config.bindingFile!==path.join(paths.configDirectory,'buyer-writer-binding.json')||config.units||config.rehearsalFile)reject();
    for(const c of [config.runtime,config.issuer])if(c.host!=='db.kchtrvfcixnimvxxctkj.supabase.co'||c.port!==5432||c.database!=='postgres'
      ||hash(c.ca??'')!=='700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7')reject();
    const artifact=await inspectArtifact({artifactRoot:path.join(paths.releaseRoot,releaseSha),releaseSha,environment:'production'});
    if(artifact.releaseSha!==releaseSha||artifact.environment!=='production'||!(/^[a-f0-9]{64}$/).test(artifact.artifactDigest??''))reject();
    const socketPath='/run/blackspire/buyer-writer.sock';
    const gatewayConfig=Object.freeze({version:2,workspace:config.workspace,socketPath,gatewayCapability:config.gatewayCapability,creatorOid:config.creatorOid,authority:config.authority,
      runtime:config.runtime,issuer:config.issuer});
    const clientConfig=validateBuyerWriterClientConfiguration({version:3,workspace:config.workspace,socketPath,gatewayCapability:config.gatewayCapability,authority:config.authority},
      {workspace:'blackspire-command',environment:'production'});
    const ingressConfig=Object.freeze({version:1,workspace:config.workspace,bindingFile:config.bindingFile,
      writerCredential:config.writerCredential,issuerCredential:config.issuerCredential});
    const gatewayBytes=Buffer.from(JSON.stringify(gatewayConfig)+'\n'),clientBytes=Buffer.from(JSON.stringify(clientConfig)+'\n'),
      ingressBytes=Buffer.from(JSON.stringify(ingressConfig)+'\n');
    const gatewayConfigPath=path.join(paths.gatewayConfigDirectory,'gateway.json');
    const clientConfigPath=path.join(paths.configDirectory,'buyer-writer-client-'+hash(clientBytes)+'.json');
    const ingressConfigPath=path.join(paths.configDirectory,'buyer-writer-ingress-'+hash(ingressBytes)+'.json');
    const dropinDirectory=path.join(paths.unitDirectory,'blackspire-command.service.d'),dropinPath=path.join(dropinDirectory,'40-zola-writer.conf');
    const dropin=Buffer.from('[Service]\nEnvironment=BUYER_WRITER_MODE=scoped\nEnvironment=BUYER_WRITER_WORKSPACE_ID=blackspire-command\nEnvironment=BLACKSPIRE_BUYER_WRITER_CLIENT_CONFIG='+clientConfigPath+'\nEnvironment=BLACKSPIRE_BUYER_WRITER_INGRESS_CONFIG='+ingressConfigPath+'\n');
    readExact(io,acl,gatewayConfigPath,gatewayBytes,ids.gatewayGid,0o640);
    readExact(io,acl,clientConfigPath,clientBytes,ids.credentialGroupId,0o640);
    readExact(io,acl,ingressConfigPath,ingressBytes,ids.credentialGroupId,0o640);
    try{directory(io,dropinDirectory);readExact(io,acl,dropinPath,dropin,0,0o644);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(!same(snapshot,readSnapshot(configurationFile,{groupId:ids.credentialGroupId,maxBytes:65536}))||!same(state,await hostState(run)))reject();
    const result=Object.freeze({version:2,kind:'zola-configuration-install',releaseSha,artifactDigest:artifact.artifactDigest,
      configPath:clientConfigPath,clientConfigPath,ingressConfigPath,gatewayConfigPath,dropinPath,
      status:'PREPARED',servicesStarted:false,authorityActivated:false});
    plans.set(result,{io,acl,run,readSnapshot,identity,inspectArtifact,paths,input:{releaseSha,configurationFile},snapshot,ids,
      gatewayBytes,clientBytes,ingressBytes,dropin,dropinDirectory});return result;
  }catch{reject();}
}

export async function installZolaConfiguration(plan,{connect=createBuyerWriterGatewayPostgres,record}={}){
  let database;
  try{
    const p=plans.get(plan);if(!p||typeof record!=='function')reject();
    const fresh=await prepareZolaConfigurationInstall(p.input,{...p,uid:process.getuid()});
    const f=plans.get(fresh);if(!same(plan,fresh)||!same(p.snapshot,f.snapshot)||!same(p.ids,f.ids))reject();
    // Reject inherited named ACLs for both trust zones before writing any
    // credential-bearing inode. Per-file checks remain mandatory as a second
    // fence against a directory ACL change during publication.
    checkDirectoryDefaultAcl(p.acl,p.paths.configDirectory);
    checkDirectoryDefaultAcl(p.acl,p.paths.gatewayConfigDirectory);
    // Only the existing fixed scoped-role allow/deny SQL is run. No role creation,
    // SQL writes, issuer permit, writer apply or provider call is reachable here.
    database=await connect({runtime:p.snapshot.value.runtime,issuer:p.snapshot.value.issuer,creatorOid:p.snapshot.value.creatorOid});
    if(database.isHealthy()!==true)reject();await database.close();database=undefined;
    await hostState(p.run);
    if(!same(p.ids,await p.identity(p.run))||!same(p.snapshot,p.readSnapshot(p.input.configurationFile,{groupId:p.ids.credentialGroupId,maxBytes:65536})))reject();
    const artifact=await p.inspectArtifact({artifactRoot:path.join(p.paths.releaseRoot,plan.releaseSha),releaseSha:plan.releaseSha,environment:'production'});
    if(artifact.artifactDigest!==plan.artifactDigest||artifact.releaseSha!==plan.releaseSha||artifact.environment!=='production')reject();
    record({event:'configuration_install_intent',releaseSha:plan.releaseSha,artifactDigest:plan.artifactDigest});
    privateGatewayDirectory(p.io,p.paths.gatewayConfigDirectory,p.ids.gatewayGid);
    publish(p.io,p.acl,plan.gatewayConfigPath,p.gatewayBytes,p.ids.gatewayGid,0o640);
    publish(p.io,p.acl,plan.clientConfigPath,p.clientBytes,p.ids.credentialGroupId,0o640);
    publish(p.io,p.acl,plan.ingressConfigPath,p.ingressBytes,p.ids.credentialGroupId,0o640);
    try{p.io.mkdirSync(p.dropinDirectory,{mode:0o755});syncDirectory(p.io,path.dirname(p.dropinDirectory));}catch(e){if(e.code!=='EEXIST')throw e;}
    directory(p.io,p.dropinDirectory);await hostState(p.run);
    publish(p.io,p.acl,plan.dropinPath,p.dropin,0,0o644);
    record({event:'configuration_install_verified',releaseSha:plan.releaseSha});
    return {...plan,status:'INSTALLED_RELOAD_REQUIRED'};
  }catch{reject();}finally{if(database)await database.close().catch(()=>{});}
}
