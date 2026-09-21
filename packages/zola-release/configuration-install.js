import {verifyOwnedBuyerMigrationQuiescence} from '../buyer-writer/owned-migration-host.js';
import {validateDatabaseTarget} from '../buyer-writer/database-profile.js';
import {validateOwnedPostgresProfile,OWNED_POSTGRES_PROFILE_PATH} from '../buyer-writer/owned-postgres.js';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile,spawnSync} from 'node:child_process';
import {promisify} from 'node:util';
import {readRootOwnedJsonSnapshot} from '../buyer-writer/protected-json.js';
import {renderZolaGatewayConfigurations} from './gateway-configuration-render.js';
import {resolveBuyerWriterIdentity} from '../buyer-writer/runtime-identity.js';
import {inspectSealedBuyerWriterArtifact} from '../buyer-writer/artifact-inspection.js';
import {createBuyerWriterGatewayPostgres} from '../buyer-writer/local-gateway-postgres.js';
import {createOperationPermitSigner} from '../buyer-writer/operation-permit-signer.js';
import {installedBuyerWriterManifestPath} from './installed-buyer-writer.js';

const execute=promisify(execFile),plans=new WeakMap();
const reject=()=>{throw new Error('Zola configuration installation rejected');};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sealedArtifactProof=(artifact,releaseSha)=>artifact&&Object.keys(artifact).length===6
  &&artifact.releaseSha===releaseSha&&artifact.environment==='production'
  &&(/^[a-f0-9]{64}$/).test(artifact.artifactDigest??'')
  &&artifact.status==='SEALED_ARTIFACT_VERIFIED'&&artifact.deployed===false&&artifact.productionAccepted===false;
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
function readExact(io,acl,name,bytes,gid,mode,uid=0,links=1){
  directory(io,path.dirname(name));let fd,found;
  try{
    fd=io.openSync(name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    const a=io.fstatSync(fd);
    if(!a.isFile()||a.uid!==uid||a.gid!==gid||a.nlink!==links||(a.mode&0o7777)!==mode||a.size!==bytes.length)reject();
    checkAcl(acl,fd);
    found=Buffer.alloc(bytes.length+1);let count=0;
    while(count<found.length){const n=io.readSync(fd,found,count,found.length-count,null);if(!n)break;count+=n;}
    const b=io.fstatSync(fd);
    if(count!==bytes.length||!found.subarray(0,count).equals(bytes)||['dev','ino','uid','gid','mode','nlink','size','ctimeMs','mtimeMs'].some(k=>a[k]!==b[k]))reject();
    return true;
  }catch(error){if(error.code==='ENOENT')return false;throw error;}
  finally{found?.fill(0);if(fd!==undefined)io.closeSync(fd);}
}
function statOrNull(io,name){try{return io.lstatSync(name);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function publicationState(io,acl,name,bytes,gid,mode,uid=0){
  const token=hash(Buffer.concat([Buffer.from(name+'\0'),bytes])).slice(0,32);
  const temporary=path.join(path.dirname(name),'.zola-install-'+token+'.tmp');
  const installed=statOrNull(io,name),staged=statOrNull(io,temporary);
  if(!installed&&!staged)return 'absent';
  if(installed?.nlink===1&&!staged&&readExact(io,acl,name,bytes,gid,mode,uid))return 'published';
  if(!installed&&staged?.nlink===1&&readExact(io,acl,temporary,bytes,gid,mode,uid))return 'staged';
  if(installed?.nlink===2&&staged&&installed.dev===staged.dev&&installed.ino===staged.ino
    &&readExact(io,acl,name,bytes,gid,mode,uid,2)&&readExact(io,acl,temporary,bytes,gid,mode,uid,2))return 'linked';
  reject();
}
// Deterministic no-replace publication. Exact one-link, staged, and post-link
// states are recoverable; foreign state is never replaced or removed.
function publish(io,acl,name,bytes,gid,mode,uid=0){
  const token=hash(Buffer.concat([Buffer.from(name+'\0'),bytes])).slice(0,32);
  const temporary=path.join(path.dirname(name),'.zola-install-'+token+'.tmp');let fd,identity;
  const installed=statOrNull(io,name),staged=statOrNull(io,temporary);
  if(installed){
    if(installed.nlink===1&&!staged&&readExact(io,acl,name,bytes,gid,mode,uid))return 'existing';
    if(installed.nlink===2&&staged&&installed.dev===staged.dev&&installed.ino===staged.ino
      &&readExact(io,acl,name,bytes,gid,mode,uid,2)&&readExact(io,acl,temporary,bytes,gid,mode,uid,2)){
      io.unlinkSync(temporary);syncDirectory(io,path.dirname(name));
      if(readExact(io,acl,name,bytes,gid,mode,uid))return 'recovered';
    }
    reject();
  }
  if(staged){
    if(!readExact(io,acl,temporary,bytes,gid,mode,uid))reject();
    io.linkSync(temporary,name);io.unlinkSync(temporary);syncDirectory(io,path.dirname(name));
    if(readExact(io,acl,name,bytes,gid,mode,uid))return 'recovered';
    reject();
  }
  try{
    fd=io.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
    identity=io.fstatSync(fd);checkAcl(acl,fd);
    io.fchownSync(fd,uid,gid);io.fchmodSync(fd,mode);io.writeFileSync(fd,bytes);io.fsyncSync(fd);io.closeSync(fd);fd=undefined;
    if(!readExact(io,acl,temporary,bytes,gid,mode,uid))reject();
    io.linkSync(temporary,name);io.unlinkSync(temporary);syncDirectory(io,path.dirname(name));
    if(!readExact(io,acl,name,bytes,gid,mode,uid))reject();return 'published';
  }finally{
    if(fd!==undefined)io.closeSync(fd);
    try{
      const temp=io.lstatSync(temporary),target=statOrNull(io,name);
      if(identity&&temp.dev===identity.dev&&temp.ino===identity.ino&&!target)io.unlinkSync(temporary);
    }catch(error){if(error.code!=='ENOENT')throw error;}
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
export function prepareZolaConfigurationInstall(input,deps){return prepareConfigurationInstall(input,deps,false);}
export function prepareOwnedZolaConfigurationInstall(input,deps){return prepareConfigurationInstall(input,deps,true);}
async function prepareConfigurationInstall({releaseSha,configurationFile},{io=fs,acl=spawnSync,run=execute,
  quiesce=verifyOwnedBuyerMigrationQuiescence,readSnapshot=readRootOwnedJsonSnapshot,inspectArtifact=inspectSealedBuyerWriterArtifact,identity=hostIdentity,paths=defaults,uid=process.getuid()}={},owned=false){
  try{
    if(uid!==0||!(/^[a-f0-9]{40}$/).test(releaseSha??''))reject();
    directory(io,paths.configDirectory);directory(io,paths.unitDirectory);
    if(owned)await quiesce();
    const profileSnapshot=owned?readSnapshot(OWNED_POSTGRES_PROFILE_PATH,{groupId:0,maxBytes:65536}):null;
    if(owned&&(profileSnapshot.identity.uid!==0||profileSnapshot.identity.gid!==0||(profileSnapshot.identity.mode&0o7777)!==0o600))reject();
    const profile=owned?validateOwnedPostgresProfile(profileSnapshot.value):null;
    const state=await hostState(run),ids=await identity(run);
    privateGatewayDirectory(io,paths.gatewayConfigDirectory,ids.gatewayGid);
    const snapshot=readSnapshot(configurationFile,{groupId:ids.credentialGroupId,maxBytes:65536});
    const {config,gatewayConfig,clientConfig,ingressConfig,signerConfig}=renderZolaGatewayConfigurations(snapshot.value);
    const expectedPrivateKeyPath=path.join(paths.configDirectory,
      'buyer-writer-signing-key-'+signerConfig.signer.activeKeyId+'.pem');
    if(signerConfig.signer.activePrivateKeyPath!==expectedPrivateKeyPath)reject();
    createOperationPermitSigner(signerConfig.signer,{expectedUid:ids.uid});
    if(config.authority.releaseSha!==releaseSha)reject();
    if(config.bindingFile!==path.join(paths.configDirectory,'buyer-writer-binding.json')||config.units||config.rehearsalFile)reject();
    for(const c of [config.runtime,config.issuer]){
      if(owned){if(c.backendProfile!=='owned-postgres-v1'||config.creatorOid!==profile.creatorOid)reject();validateDatabaseTarget(c,{ownedProfile:profile});}
      else if(c.backendProfile!==undefined||c.profileDigest!==undefined||c.host!=='db.kchtrvfcixnimvxxctkj.supabase.co'||c.port!==5432||c.database!=='postgres'
        ||hash(c.ca??'')!=='700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7')reject();
    }
    const artifact=await inspectArtifact({artifactRoot:path.join(paths.releaseRoot,releaseSha),releaseSha,environment:'production'});
    if(!sealedArtifactProof(artifact,releaseSha))reject();
    const gatewayBytes=Buffer.from(JSON.stringify(gatewayConfig)+'\n'),clientBytes=Buffer.from(JSON.stringify(clientConfig)+'\n'),
      ingressBytes=Buffer.from(JSON.stringify(ingressConfig)+'\n'),signerBytes=Buffer.from(JSON.stringify(signerConfig)+'\n');
    const gatewayConfigPath=path.join(paths.gatewayConfigDirectory,'gateway.json');
    const clientConfigPath=path.join(paths.configDirectory,'buyer-writer-client-'+hash(clientBytes)+'.json');
    const ingressConfigPath=path.join(paths.configDirectory,'buyer-writer-ingress-'+hash(ingressBytes)+'.json');
    const signerConfigPath=path.join(paths.configDirectory,'buyer-writer-signer-'+hash(signerBytes)+'.json');
    const dropinDirectory=path.join(paths.unitDirectory,'blackspire-command.service.d'),dropinPath=path.join(dropinDirectory,'40-zola-writer.conf');
    const dropin=Buffer.from('[Service]\nEnvironment=BUYER_WRITER_MODE=scoped\nEnvironment=BUYER_WRITER_WORKSPACE_ID=blackspire-command\nEnvironment=BLACKSPIRE_BUYER_WRITER_CLIENT_CONFIG='+clientConfigPath+'\nEnvironment=BLACKSPIRE_BUYER_WRITER_INGRESS_CONFIG='+ingressConfigPath+'\nEnvironment=BLACKSPIRE_BUYER_WRITER_SIGNER_CONFIG='+signerConfigPath+'\n');
    const manifestPath=installedBuyerWriterManifestPath(releaseSha,{configDirectory:paths.configDirectory});
    const manifestBytes=Buffer.from(JSON.stringify({schema:1,kind:'zola_installed_buyer_writer',releaseSha,
      artifactDigest:artifact.artifactDigest,workspace:config.workspace,
      clientConfig:{path:clientConfigPath,digest:hash(clientBytes)},ingressConfig:{path:ingressConfigPath,digest:hash(ingressBytes)},
      signerConfig:{path:signerConfigPath,digest:hash(signerBytes)},gatewayConfig:{path:gatewayConfigPath,digest:hash(gatewayBytes)},
      serviceDropin:{path:dropinPath,digest:hash(dropin)}})+'\n');
    publicationState(io,acl,gatewayConfigPath,gatewayBytes,ids.gatewayGid,0o640);
    publicationState(io,acl,clientConfigPath,clientBytes,ids.credentialGroupId,0o640);
    publicationState(io,acl,ingressConfigPath,ingressBytes,ids.credentialGroupId,0o640);
    publicationState(io,acl,signerConfigPath,signerBytes,ids.credentialGroupId,0o640);
    publicationState(io,acl,manifestPath,manifestBytes,0,0o600);
    try{directory(io,dropinDirectory);publicationState(io,acl,dropinPath,dropin,0,0o644);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(owned)await quiesce();
    if(owned&&!same(profileSnapshot,readSnapshot(OWNED_POSTGRES_PROFILE_PATH,{groupId:0,maxBytes:65536})))reject();
    if(!same(snapshot,readSnapshot(configurationFile,{groupId:ids.credentialGroupId,maxBytes:65536}))||!same(state,await hostState(run)))reject();
    const result=Object.freeze({version:2,kind:'zola-configuration-install',releaseSha,artifactDigest:artifact.artifactDigest,
      configPath:clientConfigPath,clientConfigPath,ingressConfigPath,signerConfigPath,gatewayConfigPath,dropinPath,manifestPath,
      status:'PREPARED',servicesStarted:false,authorityActivated:false});
    plans.set(result,{io,acl,run,quiesce,readSnapshot,identity,inspectArtifact,paths,owned,profileSnapshot,input:{releaseSha,configurationFile},snapshot,ids,
      gatewayBytes,clientBytes,ingressBytes,signerBytes,dropin,dropinDirectory,manifestBytes});return result;
  }catch{reject();}
}

export async function installZolaConfiguration(plan,{connect=createBuyerWriterGatewayPostgres,record}={}){
  let database;
  try{
    const p=plans.get(plan);if(!p||typeof record!=='function')reject();
    const fresh=await prepareConfigurationInstall(p.input,{...p,uid:process.getuid()},p.owned);
    const f=plans.get(fresh);if(!same(plan,fresh)||!same(p.snapshot,f.snapshot)||!same(p.ids,f.ids)||!same(p.profileSnapshot,f.profileSnapshot))reject();
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
    if(!sealedArtifactProof(artifact,plan.releaseSha)||artifact.artifactDigest!==plan.artifactDigest)reject();
    if(p.owned)await p.quiesce();
    if(p.owned&&!same(p.profileSnapshot,p.readSnapshot(OWNED_POSTGRES_PROFILE_PATH,{groupId:0,maxBytes:65536})))reject();
    if(!same(p.snapshot,p.readSnapshot(p.input.configurationFile,{groupId:p.ids.credentialGroupId,maxBytes:65536})))reject();
    record({event:'configuration_install_intent',releaseSha:plan.releaseSha,artifactDigest:plan.artifactDigest});
    privateGatewayDirectory(p.io,p.paths.gatewayConfigDirectory,p.ids.gatewayGid);
    publish(p.io,p.acl,plan.gatewayConfigPath,p.gatewayBytes,p.ids.gatewayGid,0o640);
    publish(p.io,p.acl,plan.clientConfigPath,p.clientBytes,p.ids.credentialGroupId,0o640);
    publish(p.io,p.acl,plan.ingressConfigPath,p.ingressBytes,p.ids.credentialGroupId,0o640);
    publish(p.io,p.acl,plan.signerConfigPath,p.signerBytes,p.ids.credentialGroupId,0o640);
    try{p.io.mkdirSync(p.dropinDirectory,{mode:0o755});syncDirectory(p.io,path.dirname(p.dropinDirectory));}catch(e){if(e.code!=='EEXIST')throw e;}
    directory(p.io,p.dropinDirectory);await hostState(p.run);
    publish(p.io,p.acl,plan.dropinPath,p.dropin,0,0o644);
    publish(p.io,p.acl,plan.manifestPath,p.manifestBytes,0,0o600);
    if(p.owned)await p.quiesce();
    if(p.owned&&!same(p.profileSnapshot,p.readSnapshot(OWNED_POSTGRES_PROFILE_PATH,{groupId:0,maxBytes:65536})))reject();
    if(!same(p.snapshot,p.readSnapshot(p.input.configurationFile,{groupId:p.ids.credentialGroupId,maxBytes:65536})))reject();
    record({event:'configuration_install_verified',releaseSha:plan.releaseSha,
      manifestPath:plan.manifestPath,manifestDigest:hash(p.manifestBytes)});
    return {...plan,status:'INSTALLED_RELOAD_REQUIRED'};
  }catch{reject();}finally{if(database)await database.close().catch(()=>{});}
}
