import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inspectSealedBuyerWriterArtifact} from '../buyer-writer/artifact-inspection.js';
import {validateBuyerWriterClientConfiguration} from '../buyer-writer/configuration.js';
import {validateBuyerWriterGatewayServiceConfiguration} from '../buyer-writer/gateway-entry.js';
import {lookupBuyerWriterIdentity} from '../buyer-writer/runtime-identity.js';
import {renderGatewayUnit} from '../buyer-writer/gateway-installation.js';
import {createOperationPermitSigner,validateOperationPermitSigningConfiguration} from '../buyer-writer/operation-permit-signer.js';

const defaults=Object.freeze({config:'/etc/blackspire',gateway:'/etc/blackspire-buyer-writer-gateway/gateway.json',
 dropin:'/etc/systemd/system/blackspire-command.service.d/40-zola-writer.conf',unit:'/etc/systemd/system/blackspire-buyer-writer-gateway.service',
 candidateState:'/var/lib/blackspire-operator/gateway-installation/state.json',state:'/var/lib/blackspire-operator/postmerge-authority',releases:'/opt/blackspire-command/releases'});
const template=fs.readFileSync(fileURLToPath(new URL('../../ops/runtime-ownership/blackspire-buyer-writer-gateway.service',import.meta.url)),'utf8');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),json=value=>Buffer.from(JSON.stringify(value)+'\n');
const reject=()=>{throw new Error('Postmerge authority rebind rejected; retain protected evidence');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const binding=plan=>Object.fromEntries(['operationId','commanderRunId','candidateSha','candidateArtifactDigest','newMainSha','artifactDigest','epochRunId'].map(k=>[k,plan[k]]));
const descriptor=bundle=>({schema:1,binding:bundle.binding,dependencies:bundle.dependencies,files:bundle.files.map(({name,filename,gid,mode,oldBytes,newBytes})=>({name,filename,gid,mode,
 oldDigest:oldBytes===null?null:hash(Buffer.from(oldBytes,'base64')),newDigest:hash(Buffer.from(newBytes,'base64'))}))});

// Called only while the enclosing VPS transaction owns the admission lock.
// The public snapshot contains hashes; credentials remain in a private root-only backup.
export function createPostmergeAuthorityRebind(plan,{paths=defaults,inspectArtifact=inspectSealedBuyerWriterArtifact,
 assertStopped,resolveIdentity=lookupBuyerWriterIdentity,aclTool=spawnSync,io=fs,
 successorReceipt=async input=>(await import('../buyer-writer/owned-successor-gateway-unit.js')).readOwnedSuccessorGatewayUnitReceipt(input)}={}){
 if(process.getuid()!==0||typeof assertStopped!=='function'||!['candidateSha','newMainSha'].every(k=>/^[a-f0-9]{40}$/.test(plan[k]??''))
  ||plan.candidateSha===plan.newMainSha||!['operationId','commanderRunId','epochRunId'].every(k=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(plan[k]??''))
  ||!['candidateArtifactDigest','artifactDigest'].every(k=>/^[a-f0-9]{64}$/.test(plan[k]??'')))reject();
 const filename=path.join(paths.state,plan.operationId+'.json');
 function acl(fd){const result=aclTool('/usr/bin/getfacl',['--numeric','--omit-header','--skip-base','--logical','--','/proc/self/fd/3'],
  {stdio:['ignore','pipe','pipe',fd],encoding:'utf8',timeout:1000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
  if(result.status!==0||result.error||result.stdout!==''||result.stderr!=='')reject();}
 function directory(name){for(let current=name;;current=path.dirname(current)){
  const st=io.lstatSync(current);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==0||(st.mode&0o022)!==0)reject();
  const fd=io.openSync(current,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{acl(fd);}finally{io.closeSync(fd);}
  if(current==='/')break;}}
 function read(name,{uid=0,gid,mode,max=262144}={}){directory(path.dirname(name));let fd;
  try{fd=io.openSync(name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);const before=io.fstatSync(fd);
   if(!before.isFile()||before.uid!==uid||before.nlink!==1||(before.mode&0o022)!==0||before.size<1||before.size>max
    ||gid!==undefined&&before.gid!==gid||mode!==undefined&&(before.mode&0o7777)!==mode)reject();acl(fd);
   const bytes=io.readFileSync(fd),after=io.fstatSync(fd);
   if(bytes.length!==before.size||['dev','ino','size','mtimeMs','ctimeMs','mode','gid','uid','nlink'].some(k=>before[k]!==after[k]))reject();
   return{bytes,uid:before.uid,gid:before.gid,mode:before.mode&0o7777};
  }finally{if(fd!==undefined)io.closeSync(fd);}}
 function absent(name){try{io.lstatSync(name);return false;}catch(error){if(error.code==='ENOENT')return true;throw error;}}
 function sync(name){const fd=io.openSync(name,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{io.fsyncSync(fd);}finally{io.closeSync(fd);}}
 function write(name,bytes,{gid,mode},replace=false){directory(path.dirname(name));const temporary=path.join(path.dirname(name),'.zola-rebind-'+randomUUID());let fd;
  try{fd=io.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
   acl(fd);io.fchownSync(fd,0,gid);io.fchmodSync(fd,mode);acl(fd);io.writeFileSync(fd,bytes);io.fsyncSync(fd);io.closeSync(fd);fd=undefined;
   if(replace)io.renameSync(temporary,name);else{io.linkSync(temporary,name);io.unlinkSync(temporary);}sync(path.dirname(name));
  }finally{if(fd!==undefined)io.closeSync(fd);if(!absent(temporary))io.unlinkSync(temporary);}}
 async function sealed(){const proof=await inspectArtifact({artifactRoot:path.join(paths.releases,plan.newMainSha),releaseSha:plan.newMainSha,environment:'production'});
  if(proof.status!=='SEALED_ARTIFACT_VERIFIED'||proof.releaseSha!==plan.newMainSha||proof.artifactDigest!==plan.artifactDigest
   ||proof.environment!=='production'||proof.deployed!==false||proof.productionAccepted!==false)reject();}
 function reference(value,name){if(!value||path.dirname(value.path)!==paths.config||!/^buyer-writer-(client|ingress|signer)-[a-f0-9]{64}\.json$/.test(path.basename(value.path)))reject();
  const found=read(value.path,{mode:0o640});if(hash(found.bytes)!==value.digest)reject();return{name,filename:value.path,...found};}
 function renderDropin(client,ingress,signer){return Buffer.from('[Service]\nEnvironment=BUYER_WRITER_MODE=scoped\nEnvironment=BUYER_WRITER_WORKSPACE_ID=blackspire-command\nEnvironment=BLACKSPIRE_BUYER_WRITER_CLIENT_CONFIG='+client+'\nEnvironment=BLACKSPIRE_BUYER_WRITER_INGRESS_CONFIG='+ingress+'\nEnvironment=BLACKSPIRE_BUYER_WRITER_SIGNER_CONFIG='+signer+'\n');}
 function parse(bytes){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
 async function prepareBundle(){await assertStopped();await sealed();const identity=await resolveIdentity();
  const oldManifest=read(path.join(paths.config,'zola-installed-'+plan.candidateSha+'.json'),{gid:0,mode:0o600});
  const manifest=parse(oldManifest.bytes);
  if(Object.keys(manifest).sort().join(',')!=='artifactDigest,clientConfig,gatewayConfig,ingressConfig,kind,releaseSha,schema,serviceDropin,signerConfig,workspace'||manifest.schema!==1||manifest.kind!=='zola_installed_buyer_writer'||manifest.releaseSha!==plan.candidateSha
   ||manifest.artifactDigest!==plan.candidateArtifactDigest||manifest.workspace!=='blackspire-command'
   ||manifest.gatewayConfig.path!==paths.gateway||manifest.serviceDropin.path!==paths.dropin)reject();
  const client=reference(manifest.clientConfig,'client'),signer=reference(manifest.signerConfig,'signer'),ingress=reference(manifest.ingressConfig,'ingress');
  const gateway={filename:paths.gateway,...read(paths.gateway,{mode:0o640})},dropin={filename:paths.dropin,...read(paths.dropin,{gid:0,mode:0o644})},unit={filename:paths.unit,...read(paths.unit,{gid:0,mode:0o644})};
  if(hash(gateway.bytes)!==manifest.gatewayConfig.digest||hash(dropin.bytes)!==manifest.serviceDropin.digest||client.gid!==signer.gid||client.gid!==ingress.gid||client.gid===0||gateway.gid===0)reject();
  if(client.gid!==identity.credentialGroupId||!Number.isSafeInteger(identity.uid)||identity.uid<1)reject();
  const oldClient=validateBuyerWriterClientConfiguration(parse(client.bytes),{workspace:'blackspire-command',environment:'production'});
  const oldGateway=validateBuyerWriterGatewayServiceConfiguration(parse(gateway.bytes)),oldSigner=parse(signer.bytes);
  if(oldGateway.version!==4||oldGateway.authority.releaseSha!==plan.candidateSha||oldClient.authority.releaseSha!==plan.candidateSha
   ||!same(oldGateway.authority,oldClient.authority)||oldGateway.gatewayCapability!==oldClient.gatewayCapability)reject();
  createOperationPermitSigner(oldSigner.signer,{expectedUid:identity.uid});
  if(!same(oldSigner.signer.verification,oldGateway.admission.verificationConfiguration))reject();
  const permit=parse(Buffer.from(oldSigner.operationPermitConfiguration));
  if(JSON.stringify(permit)!==oldSigner.operationPermitConfiguration||oldSigner.operationPermitConfiguration!==oldGateway.admission.operationPermitConfiguration
   ||permit.keyId!==oldSigner.signer.activeKeyId)reject();
  validateOperationPermitSigningConfiguration(permit,oldSigner.signer.activeKeyId);
  const keyPath=path.join(paths.config,'buyer-writer-signing-key-'+oldSigner.signer.activeKeyId+'.pem');
  if(oldSigner.signer.activePrivateKeyPath!==keyPath)reject();
  const key=read(keyPath,{uid:identity.uid,gid:identity.credentialGroupId,mode:0o600});
  const candidateState=read(paths.candidateState,{gid:0,mode:0o600}),installation=parse(candidateState.bytes);
  let successorDependencies=[];
  if(installation.sha!==plan.candidateSha){
   if(installation.version!==4||installation.sha!=='2636a1e75cd0f422aff036dfee8a93a81cd5008b'
    ||plan.backendProfile!=='owned-postgres-v1'||plan.profileDigest!=='2563185421523bf337e382a38ca389c5991406cb2adecc952048cdf5cf058505'
    ||oldGateway.authority.operationId!==plan.commanderRunId)reject();
   const receipt=await successorReceipt({releaseSha:plan.candidateSha,operationId:oldGateway.authority.operationId,artifactDigest:plan.candidateArtifactDigest});
   if(receipt?.status!=='OWNED_SUCCESSOR_GATEWAY_UNIT_RECEIPT_VERIFIED'||receipt.sha!==plan.candidateSha
    ||receipt.operationId!==plan.commanderRunId||receipt.attemptId!==oldGateway.authority.attemptId||receipt.profileDigest!==plan.profileDigest
    ||receipt.artifactDigest!==plan.candidateArtifactDigest||receipt.installedUnitSha256!==hash(unit.bytes)
    ||!Array.isArray(receipt.dependencies)||receipt.dependencies.length!==5)reject();
   if(!receipt.dependencies.some(row=>row.filename===paths.candidateState&&row.digest===hash(candidateState.bytes)))reject();
   for(const row of receipt.dependencies){
    if(Object.keys(row).sort().join(',')!=='digest,filename,gid,mode,uid'||row.uid!==0||row.gid!==0||row.mode!==0o600
     ||!/^[a-f0-9]{64}$/.test(row.digest??'')||hash(read(row.filename,row).bytes)!==row.digest)reject();
   }
   if(new Set(receipt.dependencies.map(row=>row.filename)).size!==5)reject();
   successorDependencies=receipt.dependencies.filter(row=>row.filename!==paths.candidateState);
  }
  const dependencies=[{filename:paths.candidateState,uid:0,gid:0,mode:0o600,digest:hash(candidateState.bytes)},...successorDependencies,{filename:ingress.filename,uid:0,gid:ingress.gid,mode:ingress.mode,digest:hash(ingress.bytes)},
   {filename:keyPath,uid:key.uid,gid:key.gid,mode:key.mode,digest:hash(key.bytes)},
   {filename:path.join(paths.config,'zola-installed-'+plan.candidateSha+'.json'),uid:0,gid:0,mode:0o600,digest:hash(oldManifest.bytes)},
   ...[client,signer].map(row=>({filename:row.filename,uid:0,gid:row.gid,mode:row.mode,digest:hash(row.bytes)}))];
  if(!dropin.bytes.equals(renderDropin(client.filename,ingress.filename,signer.filename))
   ||unit.bytes.toString()!==renderGatewayUnit(template,{sha:plan.candidateSha}))reject();
  const nextClient=structuredClone(oldClient),nextGateway=structuredClone(oldGateway),nextSigner=structuredClone(oldSigner);
  nextClient.authority.releaseSha=plan.newMainSha;nextGateway.authority.releaseSha=plan.newMainSha;
  const nextPermit=JSON.stringify({...permit,releaseSha:plan.newMainSha});
  nextGateway.admission.operationPermitConfiguration=nextPermit;nextSigner.operationPermitConfiguration=nextPermit;
  validateBuyerWriterClientConfiguration(nextClient,{workspace:'blackspire-command',environment:'production'});
  validateBuyerWriterGatewayServiceConfiguration(nextGateway);validateOperationPermitSigningConfiguration(JSON.parse(nextPermit),nextSigner.signer.activeKeyId);
  const clientBytes=json(nextClient),signerBytes=json(nextSigner),gatewayBytes=json(nextGateway);
  const clientPath=path.join(paths.config,'buyer-writer-client-'+hash(clientBytes)+'.json'),signerPath=path.join(paths.config,'buyer-writer-signer-'+hash(signerBytes)+'.json');
  const dropinBytes=renderDropin(clientPath,ingress.filename,signerPath);
  const nextManifest={...manifest,releaseSha:plan.newMainSha,artifactDigest:plan.artifactDigest,clientConfig:{path:clientPath,digest:hash(clientBytes)},
   signerConfig:{path:signerPath,digest:hash(signerBytes)},gatewayConfig:{path:paths.gateway,digest:hash(gatewayBytes)},serviceDropin:{path:paths.dropin,digest:hash(dropinBytes)}};
  const row=(name,filename,newBytes,source)=>({name,filename,gid:source?.gid??0,mode:source?.mode??0o600,
   oldBytes:source?.bytes?.toString('base64')??null,newBytes:newBytes.toString('base64')});
  const files=[row('client',clientPath,clientBytes,{gid:client.gid,mode:client.mode}),row('signer',signerPath,signerBytes,{gid:signer.gid,mode:signer.mode}),
   row('gateway',paths.gateway,gatewayBytes,gateway),row('dropin',paths.dropin,dropinBytes,dropin),
   row('unit',paths.unit,Buffer.from(renderGatewayUnit(template,{sha:plan.newMainSha})),unit),
   row('manifest',path.join(paths.config,'zola-installed-'+plan.newMainSha+'.json'),json(nextManifest))];
  await assertStopped();return{schema:1,binding:binding(plan),dependencies,files};
 }
 function load(proof){const state=parse(read(filename,{gid:0,mode:0o600}).bytes);
  if(state.schema!==1||!same(state.binding,binding(plan))||!same(descriptor(state),proof))reject();return state;}
 function matches(row,which){if(absent(row.filename))return false;const value=read(row.filename,row);return value.bytes.equals(Buffer.from(row[which],'base64'));}
 function dependenciesMatch(bundle){return bundle.dependencies.every(row=>hash(read(row.filename,row).bytes)===row.digest);}
 function originalMatches(proof){return proof?.schema===1&&same(proof.binding,binding(plan))
  &&dependenciesMatch(proof)&&proof.files.filter(row=>row.oldDigest!==null).every(row=>hash(read(row.filename,row).bytes)===row.oldDigest);}
 function publicProof(bundle){return Object.freeze(descriptor(bundle));}
 return Object.freeze({
  async prepare(){return publicProof(await prepareBundle());},
  async publish(proof){await assertStopped();await sealed();let bundle;
   if(absent(filename)){
    bundle=await prepareBundle();if(!same(descriptor(bundle),proof))reject();
    if(absent(paths.state)){directory(path.dirname(paths.state));io.mkdirSync(paths.state,{mode:0o700});sync(path.dirname(paths.state));}
    const st=io.lstatSync(paths.state);if(st.uid!==0||st.gid!==0||(st.mode&0o7777)!==0o700)reject();
    write(filename,json(bundle),{gid:0,mode:0o600});
   }else{bundle=load(proof);if(!dependenciesMatch(bundle)||!bundle.files.every(row=>matches(row,'newBytes')))reject();return true;}
   for(const row of bundle.files){await assertStopped();if(!dependenciesMatch(bundle))reject();
    if(matches(row,'newBytes'))continue;
    if(row.oldBytes===null){if(!absent(row.filename))reject();write(row.filename,Buffer.from(row.newBytes,'base64'),row);}
    else{if(!matches(row,'oldBytes'))reject();write(row.filename,Buffer.from(row.newBytes,'base64'),row,true);}
   }
   if(!dependenciesMatch(bundle)||!bundle.files.every(row=>matches(row,'newBytes')))reject();await assertStopped();return true;
  },
  observe(proof){try{const bundle=load(proof);return dependenciesMatch(bundle)&&bundle.files.every(row=>matches(row,'newBytes'));}catch{return false;}},
  recoverable(proof){try{const bundle=load(proof);return dependenciesMatch(bundle)&&bundle.files.every(row=>row.oldBytes===null||matches(row,'newBytes')||matches(row,'oldBytes'));}catch{return false;}},
  async restore(proof){await assertStopped();
   // A failure before publication has no protected backup and nothing to restore.
   if(absent(filename)){if(!originalMatches(proof))reject();return true;}
   const bundle=load(proof);
   for(const row of [...bundle.files].reverse()){if(row.oldBytes===null)continue;await assertStopped();
    if(matches(row,'oldBytes'))continue;if(!matches(row,'newBytes'))reject();write(row.filename,Buffer.from(row.oldBytes,'base64'),row,true);}
   await assertStopped();return dependenciesMatch(bundle)&&bundle.files.filter(row=>row.oldBytes!==null).every(row=>matches(row,'oldBytes'));
  },
  async restored(proof){try{if(absent(filename))return originalMatches(proof);const bundle=load(proof);return dependenciesMatch(bundle)&&bundle.files.filter(row=>row.oldBytes!==null).every(row=>matches(row,'oldBytes'));}catch{return false;}},
 });
}
