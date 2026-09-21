import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash,createPrivateKey,createPublicKey,generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {validateBuyerWriterConfiguration,
  validateBuyerWriterGatewayProvisioningConfiguration} from './configuration.js';
import {validateBuyerWriterGatewayServiceConfiguration} from './gateway-entry.js';
import {readRootOwnedJsonSnapshot} from './protected-json.js';
import {inspectSealedBuyerWriterArtifact} from './artifact-inspection.js';
import {inspectBuyerWriterGatewayConfigurationUpgrade} from './gateway-configuration-upgrade.js';
import {renderZolaGatewayConfigurations} from '../zola-release/gateway-configuration-render.js';

const plans=new WeakMap(),publications=new WeakMap(),RETAIN_HANDLES=Symbol();
const WORKSPACE='blackspire-command';
const ORIGIN='https://blackspirehelix.com';
const ISSUER='zola-control';
const AUDIENCE='buyer-writer';
const KEY_ROOT='/etc/blackspire';
const PREPARATION_ROOT='/var/lib/blackspire-operator/preparation';
const CURRENT_GATEWAY='/etc/blackspire-buyer-writer-gateway/gateway.json';
const ACCEPTANCE_TARGET='/var/lib/blackspire-operator/writer-acceptance.json';
const RELEASE_ROOT='/opt/blackspire-command/releases';
const INTENT_VERSION=3;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{40}$/;
const fail=()=>{throw new Error('Buyer writer gateway v4 preparation failed');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
function absolute(value){
  return typeof value==='string'&&value.length<=4096&&path.isAbsolute(value)
    &&path.resolve(value)===value&&value!=='/';
}
function artifact(value,releaseSha){
  return exact(value,['releaseSha','environment','artifactDigest','status','deployed','productionAccepted'])
    &&value.releaseSha===releaseSha&&value.environment==='production'
    &&/^[a-f0-9]{64}$/.test(value.artifactDigest??'')
    &&value.status==='SEALED_ARTIFACT_VERIFIED'&&value.deployed===false
    &&value.productionAccepted===false;
}
function acceptanceTarget(value,releaseSha){
  if(!exact(value,['schema','kind','releaseSha','workspace','principal','capability',
    'jobId','ownerId','criteria','updatedAt'])||value.schema!==1
    ||value.kind!=='zola_bounded_writer_acceptance_target'||value.releaseSha!==releaseSha
    ||value.workspace!==WORKSPACE||value.capability!=='buyer.writer.acceptance'
    ||typeof value.principal!=='string'||!/^[a-z][a-z0-9-]{2,63}$/.test(value.principal)
    ||!UUID.test(value.jobId??'')||!UUID.test(value.ownerId??''))fail();
  return value;
}
function result(input,status,{candidateDigest,publicKeyDigest}={}){
  return Object.freeze({status,releaseSha:input.releaseSha,operationId:input.operationId,
    attemptId:input.attemptId,workspace:input.workspace,candidatePath:input.candidatePath,
    keyPath:input.keyPath,keyId:input.keyId,candidateDigest,publicKeyDigest});
}
function safeDirectory(io,name){
  if(!absolute(name))fail();
  let current='/';
  for(const part of name.split('/').filter(Boolean)){
    current=path.join(current,part);
    const value=io.lstatSync(current);
    if(!value.isDirectory()||value.isSymbolicLink()||value.uid!==0||(value.mode&0o022)!==0)fail();
  }
}
function syncDirectory(io,name){
  const fd=io.openSync(name,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
  try{io.fsyncSync(fd);}finally{io.closeSync(fd);}
}
function acl(aclTool,args,stdio=['ignore','pipe','pipe']){
  const value=aclTool('/usr/bin/getfacl',args,{encoding:'utf8',stdio,timeout:1000,
    maxBuffer:4096,killSignal:'SIGKILL',env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
  if(value.status!==0||value.error||value.signal!==null||value.stdout!==''||value.stderr!=='')fail();
}
function noNamedAcl(aclTool,fd){
  acl(aclTool,['--numeric','--omit-header','--skip-base','--logical','--','/proc/self/fd/3'],
    ['ignore','pipe','pipe',fd]);
}
function noDefaultAcl(aclTool,name){
  acl(aclTool,['--numeric','--omit-header','--skip-base','--default','--logical','--',name]);
}
function inspectFile(io,aclTool,name,bytes,uid,gid,mode){
  let fd;
  try{
    fd=io.openSync(name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    const before=io.fstatSync(fd);
    if(!before.isFile()||before.uid!==uid||before.gid!==gid||before.nlink!==1
      ||(before.mode&0o7777)!==mode||before.size!==bytes.length)fail();
    noNamedAcl(aclTool,fd);
    const found=Buffer.alloc(bytes.length+1);let used=0;
    while(used<found.length){const count=io.readSync(fd,found,used,found.length-used,null);if(!count)break;used+=count;}
    const after=io.fstatSync(fd);
    if(used!==bytes.length||!found.subarray(0,used).equals(bytes)
      ||['uid','gid','mode','nlink','size','dev','ino','mtimeMs','ctimeMs']
        .some(key=>before[key]!==after[key]))fail();
    return true;
  }catch(error){if(error?.code==='ENOENT')return false;throw error;}
  finally{if(fd!==undefined)io.closeSync(fd);}
}
function heldMatches(io,name,fd){
  const held=io.fstatSync(fd);let target;
  try{target=io.lstatSync(name);}
  catch(error){if(error?.code==='ENOENT')return false;throw error;}
  return held.isFile()&&target.isFile()&&held.dev===target.dev&&held.ino===target.ino;
}
function removeHeldPublication(io,name,handle){
  if(!handle||!Number.isInteger(handle.fd))fail();
  if(!heldMatches(io,name,handle.fd))fail();
  io.unlinkSync(name);syncDirectory(io,path.dirname(name));
}
function closeHandle(io,handle){
  if(handle?.fd!==undefined){io.closeSync(handle.fd);handle.fd=undefined;}
}
export function buyerWriterGatewayV4IntentPath(candidatePath){
  if(!absolute(candidatePath)||path.dirname(candidatePath)!==PREPARATION_ROOT)fail();
  return candidatePath+'.intent.json';
}
export function buyerWriterGatewayV4CompletePath(candidatePath){
  return buyerWriterGatewayV4IntentPath(candidatePath).replace(/\.intent\.json$/,'.complete.json');
}
export function buyerWriterGatewayV4RetiredPath(candidatePath,attemptId){
  if(!UUID.test(attemptId??''))fail();
  return buyerWriterGatewayV4IntentPath(candidatePath).replace(/\.intent\.json$/,
    `.retired-${attemptId}.json`);
}
const stableDigest=value=>digest(Buffer.from(JSON.stringify(value)));
const fileIdentity=stat=>Object.freeze({dev:stat.dev,ino:stat.ino,uid:stat.uid,gid:stat.gid,
  mode:stat.mode&0o7777,nlink:stat.nlink,size:stat.size});
function stageFile(io,aclTool,name,temporary,bytes,uid,gid,mode){
  const handle={fd:undefined,temporary,name};let complete=false;
  try{
    handle.fd=io.openSync(temporary,fs.constants.O_RDWR|fs.constants.O_CREAT
      |fs.constants.O_EXCL|fs.constants.O_NOFOLLOW|fs.constants.O_CLOEXEC,0o600);
    noNamedAcl(aclTool,handle.fd);io.fchownSync(handle.fd,uid,gid);io.fchmodSync(handle.fd,mode);
    let written=0;
    while(written<bytes.length){
      const count=io.writeSync(handle.fd,bytes,written,bytes.length-written,null);
      if(!Number.isInteger(count)||count<1)fail();written+=count;
    }
    io.fsyncSync(handle.fd);
    syncDirectory(io,path.dirname(temporary));
    if(!inspectFile(io,aclTool,temporary,bytes,uid,gid,mode))fail();
    handle.identity=fileIdentity(io.fstatSync(handle.fd));complete=true;return handle;
  }finally{
    if(!complete&&handle.fd!==undefined){
      try{if(heldMatches(io,temporary,handle.fd))io.unlinkSync(temporary);}
      finally{closeHandle(io,handle);}
    }
  }
}
function promoteStage(io,aclTool,handle,bytes,uid,gid,mode){
  io.linkSync(handle.temporary,handle.name);
  syncDirectory(io,path.dirname(handle.name));
  if(io.fstatSync(handle.fd).nlink!==2||!heldMatches(io,handle.temporary,handle.fd)
    ||!heldMatches(io,handle.name,handle.fd))fail();
  io.unlinkSync(handle.temporary);
  syncDirectory(io,path.dirname(handle.temporary));
  if(!inspectFile(io,aclTool,handle.name,bytes,uid,gid,mode)
    ||!heldMatches(io,handle.name,handle.fd))fail();
}
function cleanupStage(io,handle){
  let error;
  for(const name of [handle?.name,handle?.temporary])if(handle)try{
    if(heldMatches(io,name,handle.fd)){io.unlinkSync(name);syncDirectory(io,path.dirname(name));}
  }catch(value){error??=value;}
  try{closeHandle(io,handle);}catch(value){error??=value;}
  if(error)throw error;
}
function publishFile(io,aclTool,name,bytes,uid,gid,mode){
  if(inspectFile(io,aclTool,name,bytes,uid,gid,mode))fail();
  const temporary=path.join(path.dirname(name),'.zola-v4-'+randomUUID()+'.tmp');
  const handle={fd:undefined};let completed=false;
  try{
    handle.fd=io.openSync(temporary,fs.constants.O_RDWR|fs.constants.O_CREAT
      |fs.constants.O_EXCL|fs.constants.O_NOFOLLOW|fs.constants.O_CLOEXEC,0o600);
    noNamedAcl(aclTool,handle.fd);
    io.fchownSync(handle.fd,uid,gid);io.fchmodSync(handle.fd,mode);
    let written=0;
    while(written<bytes.length){
      const count=io.writeSync(handle.fd,bytes,written,bytes.length-written,null);
      if(!Number.isInteger(count)||count<1)fail();
      written+=count;
    }
    io.fsyncSync(handle.fd);
    if(!inspectFile(io,aclTool,temporary,bytes,uid,gid,mode))fail();
    io.linkSync(temporary,name);
    syncDirectory(io,path.dirname(name));
    if(io.fstatSync(handle.fd).nlink!==2||!heldMatches(io,temporary,handle.fd)
      ||!heldMatches(io,name,handle.fd))fail();
    io.unlinkSync(temporary);
    syncDirectory(io,path.dirname(temporary));
    if(!inspectFile(io,aclTool,name,bytes,uid,gid,mode)
      ||!heldMatches(io,name,handle.fd))fail();
    completed=true;return handle;
  }finally{
    if(!completed&&handle.fd!==undefined){
      let cleanupError;
      for(const entry of [name,temporary])try{
        if(heldMatches(io,entry,handle.fd)){
          io.unlinkSync(entry);syncDirectory(io,path.dirname(entry));
        }
      }catch(error){cleanupError??=error;}
      try{closeHandle(io,handle);}catch(error){cleanupError??=error;}
      if(cleanupError)throw cleanupError;
    }
  }
}
function rollbackHandles(io,publication){
  let cleanupError;
  for(const [name,handle] of [
    [publication.candidatePath,publication.candidateHandle],
    [publication.keyPath,publication.keyHandle],
  ])if(handle)try{removeHeldPublication(io,name,handle);}
  catch(error){cleanupError??=error;}
  for(const handle of [publication.candidateHandle,publication.keyHandle])
    try{closeHandle(io,handle);}catch(error){cleanupError??=error;}
  if(cleanupError)throw cleanupError;
}
function rollbackOwnedPreparation(io,prepared){
  const publication=publications.get(prepared);
  if(!publication)fail();
  try{rollbackHandles(io,publication);}
  finally{publications.delete(prepared);}
}
function commitOwnedPreparation(io,prepared){
  const publication=publications.get(prepared);
  if(!publication)fail();
  try{closeHandle(io,publication.candidateHandle);}
  finally{closeHandle(io,publication.keyHandle);publications.delete(prepared);}
}
function validateInput(input){
  const keys=['releaseSha','operationId','attemptId','workspace','origin','keyId',
    'preparationRoot','candidatePath','artifact','sourceConfiguration','currentGatewayConfiguration',
    'acceptanceTarget'];
  if(!exact(input,keys)||!SHA.test(input.releaseSha??'')||!UUID.test(input.operationId??'')
    ||!UUID.test(input.attemptId??'')||input.operationId===input.attemptId
    ||input.workspace!==WORKSPACE||input.origin!==ORIGIN
    ||input.keyId!==`zola-${input.releaseSha.slice(0,16)}`
    ||input.preparationRoot!==PREPARATION_ROOT||!absolute(input.candidatePath)
    ||path.dirname(input.candidatePath)!==input.preparationRoot
    ||!artifact(input.artifact,input.releaseSha))fail();
  const source=validateBuyerWriterConfiguration(input.sourceConfiguration,
    {workspace:WORKSPACE,environment:'production'});
  const current=validateBuyerWriterGatewayServiceConfiguration(input.currentGatewayConfiguration);
  const target=acceptanceTarget(input.acceptanceTarget,input.releaseSha);
  if(current.version!==2||source.units||source.rehearsalFile
    ||source.workspace!==current.workspace||source.creatorOid!==current.creatorOid
    ||!same(source.runtime,current.runtime)||!same(source.issuer,current.issuer)
    ||current.authority.releaseSha===input.releaseSha)fail();
  return {source,current,target};
}
function keyMaterial(generate){
  const pair=generate('ed25519');
  const privateKey=pair?.privateKey?.export({type:'pkcs8',format:'pem'});
  const publicKey=pair?.publicKey?.export({type:'spki',format:'pem'});
  if(typeof privateKey!=='string'||typeof publicKey!=='string'
    ||createPrivateKey(privateKey).asymmetricKeyType!=='ed25519'
    ||createPublicKey(privateKey).export({type:'spki',format:'pem'})!==publicKey)fail();
  return {privateKey,publicKey};
}
export function buildBuyerWriterGatewayV4Preparation(input,{
  now=Date.now,randomBytes:random=randomBytes,
  generateKeyPairSync:generate=generateKeyPairSync,apiUid,credentialGroupId,
}={}){
  try{
    const {source,current,target}=validateInput(input);
    if(typeof now!=='function'||typeof random!=='function'
      ||typeof generate!=='function'||!Number.isInteger(apiUid)||apiUid<=0
      ||!Number.isInteger(credentialGroupId)||credentialGroupId<=0)fail();
    const admissionCredential=random(32).toString('base64url'),subject=target.ownerId;
    if(!UUID.test(subject)||!/^[A-Za-z0-9_-]{43}$/.test(admissionCredential)
      ||new Set([source.writerCredential,source.issuerCredential,current.gatewayCapability,
        source.runtime.password,source.issuer.password,admissionCredential]).size!==6)fail();
    const {privateKey,publicKey}=keyMaterial(generate),keyPath=path.join(KEY_ROOT,
      'buyer-writer-signing-key-'+input.keyId+'.pem');
    const authority={releaseSha:input.releaseSha,operationId:input.operationId,
      attemptId:input.attemptId,workspace:WORKSPACE,gatewayIdentity:'blackspire-writer'};
    const permit={issuer:ISSUER,audience:AUDIENCE,subject,keyId:input.keyId,origin:ORIGIN,
      releaseSha:input.releaseSha,operationId:input.operationId,attemptId:input.attemptId,
      workspace:WORKSPACE};
    const verification={version:2,keys:[{keyId:input.keyId,publicKeyPem:publicKey,
      lifecycle:'current',verifyNotBefore:0,verifyNotAfter:null}]};
    const candidate=validateBuyerWriterGatewayProvisioningConfiguration({
      version:4,workspace:WORKSPACE,bindingFile:source.bindingFile,
      writerCredential:source.writerCredential,issuerCredential:source.issuerCredential,
      admissionCredential,gatewayCapability:current.gatewayCapability,
      creatorOid:source.creatorOid,authority,runtime:source.runtime,issuer:source.issuer,
      operationPermitConfiguration:JSON.stringify(permit),
      operationPermitVerificationConfiguration:verification,
      operationPermitSignerConfiguration:{version:1,activeKeyId:input.keyId,
        activePrivateKeyPath:keyPath,verification},
    },{workspace:WORKSPACE});
    const rendered=renderZolaGatewayConfigurations(candidate);
    const candidateBytes=Buffer.from(JSON.stringify(candidate)+'\n');
    const keyBytes=Buffer.from(privateKey);
    const digests={candidateDigest:digest(candidateBytes),
      publicKeyDigest:digest(Buffer.from(publicKey))};
    inspectBuyerWriterGatewayConfigurationUpgrade({releaseSha:input.releaseSha,
      operationId:input.operationId,attemptId:input.attemptId,
      artifactDigest:input.artifact.artifactDigest,candidateDigest:digests.candidateDigest,
      oldConfiguration:current,newConfiguration:rendered.gatewayConfig});
    const output=result({...input,keyPath},'GATEWAY_V4_PREPARATION_BUILT',digests);
    plans.set(output,{input:{...input,keyPath},candidateBytes,keyBytes,publicKey,digests,
      apiUid,credentialGroupId});
    return output;
  }catch{fail();}
}

export function publishBuyerWriterGatewayV4Preparation(plan,{
  io=fs,aclTool=spawnSync,artifactProof,retainHandles,
}={}){
  try{
    const state=plans.get(plan);
    if(!state||artifactProof!==undefined&&!same(artifactProof,state.input.artifact)
      ||!artifact(state.input.artifact,state.input.releaseSha))fail();
    safeDirectory(io,KEY_ROOT);safeDirectory(io,state.input.preparationRoot);
    noDefaultAcl(aclTool,KEY_ROOT);noDefaultAcl(aclTool,state.input.preparationRoot);
    if(inspectFile(io,aclTool,state.input.keyPath,state.keyBytes,state.apiUid,
      state.credentialGroupId,0o600)
      ||inspectFile(io,aclTool,state.input.candidatePath,state.candidateBytes,0,0,0o600))fail();
    const keyHandle=publishFile(io,aclTool,state.input.keyPath,state.keyBytes,
      state.apiUid,state.credentialGroupId,0o600);
    let candidateHandle;
    try{
      candidateHandle=publishFile(io,aclTool,state.input.candidatePath,
        state.candidateBytes,0,0,0o600);
      const output=result(state.input,'GATEWAY_V4_PREPARED',state.digests);
      if(retainHandles===RETAIN_HANDLES){
        publications.set(output,{keyHandle,candidateHandle,
          keyPath:state.input.keyPath,candidatePath:state.input.candidatePath});
      }else{
        closeHandle(io,candidateHandle);closeHandle(io,keyHandle);
      }
      return output;
    }catch(error){
      rollbackHandles(io,{candidatePath:state.input.candidatePath,candidateHandle,
        keyPath:state.input.keyPath,keyHandle});
      throw error;
    }
  }catch{fail();}
}
function absentPath(io,name){
  try{io.lstatSync(name);return false;}catch(error){if(error?.code==='ENOENT')return true;throw error;}
}
function abandonStage(io,handle){
  closeHandle(io,handle);
}
function deterministicStages(input,keyPath){
  const token=stableDigest({releaseSha:input.releaseSha,operationId:input.operationId,
    attemptId:input.attemptId,candidatePath:input.candidatePath,keyPath}).slice(0,32);
  return Object.freeze({candidateStagePath:path.join(PREPARATION_ROOT,`.zola-v4-${token}.candidate`),
    keyStagePath:path.join(KEY_ROOT,`.zola-v4-${token}.key`)});
}
function intentValue(input,source,current,acceptance,artifactProof,state){
  const stages=deterministicStages(input,state.input.keyPath);
  return Object.freeze({version:INTENT_VERSION,releaseSha:input.releaseSha,
    operationId:input.operationId,attemptId:input.attemptId,workspace:WORKSPACE,
    artifactDigest:artifactProof.artifactDigest,artifactProofDigest:stableDigest(artifactProof),
    sourceSnapshotDigest:stableDigest(source),currentSnapshotDigest:stableDigest(current),
    acceptanceTargetSnapshotDigest:stableDigest(acceptance),candidatePath:input.candidatePath,keyPath:state.input.keyPath,...stages,
    candidateDigest:state.digests.candidateDigest,keyDigest:digest(state.keyBytes),
    publicKeyDigest:state.digests.publicKeyDigest,candidateSize:state.candidateBytes.length,
    keySize:state.keyBytes.length});
}
const intentKeys=['version','releaseSha','operationId','attemptId','workspace',
  'artifactDigest','artifactProofDigest','sourceSnapshotDigest','currentSnapshotDigest',
  'acceptanceTargetSnapshotDigest','candidatePath','keyPath','candidateStagePath','keyStagePath','candidateDigest',
  'keyDigest','publicKeyDigest','candidateSize','keySize'];
function validateIntent(value,input,identity){
  const keyPath=path.join(KEY_ROOT,'buyer-writer-signing-key-zola-'+input.releaseSha.slice(0,16)+'.pem');
  const stages=deterministicStages(input,keyPath);
  if(!exact(value,intentKeys)||value.version!==INTENT_VERSION
    ||value.releaseSha!==input.releaseSha||value.operationId!==input.operationId
    ||value.attemptId!==input.attemptId||value.workspace!==WORKSPACE
    ||value.candidatePath!==input.candidatePath||value.keyPath!==keyPath
    ||value.candidateStagePath!==stages.candidateStagePath||value.keyStagePath!==stages.keyStagePath
    ||![value.artifactDigest,value.artifactProofDigest,value.sourceSnapshotDigest,
      value.currentSnapshotDigest,value.acceptanceTargetSnapshotDigest,value.candidateDigest,
      value.keyDigest,value.publicKeyDigest]
      .every(item=>/^[a-f0-9]{64}$/.test(item??''))
    ||!Number.isSafeInteger(value.candidateSize)||value.candidateSize<2||value.candidateSize>65536
    ||!Number.isSafeInteger(value.keySize)||value.keySize<1||value.keySize>4096
    ||!Number.isInteger(identity.apiUid)||!Number.isInteger(identity.credentialGroupId))fail();
  return value;
}
function openRecordedFile(io,aclTool,name,{uid,gid,size,digest:expectedDigest,publicKeyDigest}){
  let fd;
  try{fd=io.openSync(name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);}
  catch(error){if(error?.code==='ENOENT')return null;throw error;}
  try{
    const before=io.fstatSync(fd);
    if(!before.isFile()||before.uid!==uid||before.gid!==gid||(before.mode&0o7777)!==0o600
      ||![1,2].includes(before.nlink)||before.size!==size)return {foreign:true,fd};
    noNamedAcl(aclTool,fd);
    const bytes=Buffer.alloc(size+1);let used=0;
    while(used<bytes.length){const count=io.readSync(fd,bytes,used,bytes.length-used,null);if(!count)break;used+=count;}
    const after=io.fstatSync(fd);
    if(used!==size||!same(fileIdentity(before),fileIdentity(after))
      ||digest(bytes.subarray(0,used))!==expectedDigest)return {foreign:true,fd};
    if(publicKeyDigest){
      let publicPem;
      try{publicPem=createPublicKey(createPrivateKey(bytes.subarray(0,used)))
        .export({type:'spki',format:'pem'});}catch{return {foreign:true,fd};}
      if(digest(Buffer.from(publicPem))!==publicKeyDigest)return {foreign:true,fd};
    }
    return {fd,identity:fileIdentity(before)};
  }catch(error){closeHandle(io,{fd});throw error;}
}
function observeRecordedFile(io,aclTool,name,stageName,expected){
  const target=openRecordedFile(io,aclTool,name,expected);
  const stage=openRecordedFile(io,aclTool,stageName,expected);
  if(target?.foreign||stage?.foreign)return {status:'FOREIGN',target,stage};
  if(!target&&!stage)return {status:'ABSENT'};
  if(target&&stage){
    if(target.identity.dev!==stage.identity.dev||target.identity.ino!==stage.identity.ino
      ||target.identity.nlink!==2||stage.identity.nlink!==2)return {status:'FOREIGN',target,stage};
    return {status:'LINKED',target,stage};
  }
  if(target)return {status:target.identity.nlink===1?'OWNED':'FOREIGN',target};
  return {status:stage.identity.nlink===1?'STAGED':'FOREIGN',stage};
}
function closeObservation(io,value){
  for(const item of [value?.target,value?.stage])if(item?.fd!==undefined)io.closeSync(item.fd);
}
function completeValue(intent){
  return Object.freeze({version:1,status:'COMPLETE',releaseSha:intent.releaseSha,
    operationId:intent.operationId,attemptId:intent.attemptId,
    intentDigest:stableDigest(intent),candidateDigest:intent.candidateDigest,
    keyDigest:intent.keyDigest,publicKeyDigest:intent.publicKeyDigest});
}
function rootRecordStagePath(name){
  return name+'.stage';
}
function openRootRecord(io,aclTool,name,maxBytes){
  const fd=io.openSync(name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{
    const before=io.fstatSync(fd);
    if(!before.isFile()||before.uid!==0||before.gid!==0||(before.mode&0o7777)!==0o600
      ||before.nlink!==2||before.size<2||before.size>maxBytes)fail();
    noNamedAcl(aclTool,fd);
    const bytes=Buffer.alloc(before.size+1);let used=0;
    while(used<bytes.length){
      const count=io.readSync(fd,bytes,used,bytes.length-used,null);
      if(!count)break;used+=count;
    }
    const after=io.fstatSync(fd);
    if(used!==before.size||!same(fileIdentity(before),fileIdentity(after)))fail();
    return {fd,identity:fileIdentity(before),bytes:bytes.subarray(0,used)};
  }catch(error){io.closeSync(fd);throw error;}
}
function readRootRecord(io,aclTool,name,{maxBytes=65536,reconcile=false}={}){
  const stage=rootRecordStagePath(name);
  if(reconcile&&!absentPath(io,name)&&!absentPath(io,stage)){
    let target,staged;
    try{
      target=openRootRecord(io,aclTool,name,maxBytes);
      staged=openRootRecord(io,aclTool,stage,maxBytes);
      if(target.identity.dev!==staged.identity.dev||target.identity.ino!==staged.identity.ino
        ||!target.bytes.equals(staged.bytes)||!heldMatches(io,stage,staged.fd))fail();
      io.unlinkSync(stage);syncDirectory(io,path.dirname(stage));
    }finally{closeHandle(io,target);closeHandle(io,staged);}
  }
  return readRootOwnedJsonSnapshot(name,{groupId:0,maxBytes,io,aclTool});
}
function writeRootRecord(io,aclTool,name,value){
  const bytes=Buffer.from(JSON.stringify(value)+'\n'),stage=rootRecordStagePath(name);
  if(!absentPath(io,name)){
    const current=readRootRecord(io,aclTool,name,{maxBytes:bytes.length+1,reconcile:true});
    if(!same(current.value,value))fail();
    return false;
  }
  let handle;
  if(!absentPath(io,stage)){
    const staged=openRecordedFile(io,aclTool,stage,
      {uid:0,gid:0,size:bytes.length,digest:digest(bytes)});
    if(!staged||staged.foreign||staged.identity.nlink!==1){
      closeHandle(io,staged);fail();
    }
    handle={fd:staged.fd,temporary:stage,name,identity:staged.identity};
  }else handle=stageFile(io,aclTool,name,stage,bytes,0,0,0o600);
  try{promoteStage(io,aclTool,handle,bytes,0,0,0o600);return true;}
  finally{closeHandle(io,handle);}
}
async function loadPreparationState(input,{io=fs,aclTool=spawnSync,
  readSnapshot=readRootOwnedJsonSnapshot,inspectArtifact=inspectSealedBuyerWriterArtifact,
  resolveIdentity=systemIdentity,reconcileRootRecords=false}={}){
  if(!highInput(input))fail();
  const identity=await resolveIdentity();
  if(!identity||!Number.isInteger(identity.apiUid)||identity.apiUid<=0
    ||!Number.isInteger(identity.credentialGroupId)||identity.credentialGroupId<=0
    ||!Number.isInteger(identity.writerGroupId)||identity.writerGroupId<=0)fail();
  const source=readSnapshot(input.sourceConfigurationFile,{groupId:0,maxBytes:65536,io,aclTool});
  const current=readSnapshot(CURRENT_GATEWAY,{groupId:identity.writerGroupId,maxBytes:65536,io,aclTool});
  const acceptance=readSnapshot(ACCEPTANCE_TARGET,{groupId:identity.credentialGroupId,
    maxBytes:32768,io,aclTool});
  acceptanceTarget(acceptance.value,input.releaseSha);
  const artifactProof=await inspectArtifact({artifactRoot:input.artifactRoot,
    releaseSha:input.releaseSha,environment:'production'});
  const intentPath=buyerWriterGatewayV4IntentPath(input.candidatePath);
  const intentSnapshot=reconcileRootRecords
    ?readRootRecord(io,aclTool,intentPath,{maxBytes:65536,reconcile:true})
    :readSnapshot(intentPath,{groupId:0,maxBytes:65536,io,aclTool});
  const intent=validateIntent(intentSnapshot.value,input,identity);
  if(intentSnapshot.identity.uid!==0||intentSnapshot.identity.gid!==0
    ||(intentSnapshot.identity.mode&0o7777)!==0o600
    ||intent.artifactDigest!==artifactProof.artifactDigest
    ||intent.artifactProofDigest!==stableDigest(artifactProof)
    ||intent.sourceSnapshotDigest!==stableDigest(source)
    ||intent.currentSnapshotDigest!==stableDigest(current)
    ||intent.acceptanceTargetSnapshotDigest!==stableDigest(acceptance))fail();
  return {identity,intent,intentPath,source,current,acceptance,artifactProof};
}
export async function inspectBuyerWriterGatewayV4Preparation(input,deps={}){
  try{
    const {identity,intent}=await loadPreparationState(input,deps),io=deps.io??fs,
      aclTool=deps.aclTool??spawnSync;
    const candidate=observeRecordedFile(io,aclTool,intent.candidatePath,
      intent.candidateStagePath,{uid:0,gid:0,size:intent.candidateSize,
        digest:intent.candidateDigest});
    const key=observeRecordedFile(io,aclTool,intent.keyPath,intent.keyStagePath,
      {uid:identity.apiUid,gid:identity.credentialGroupId,size:intent.keySize,
        digest:intent.keyDigest,publicKeyDigest:intent.publicKeyDigest});
    try{
      if(candidate.status==='FOREIGN'||key.status==='FOREIGN')fail();
      const published=value=>['OWNED','LINKED'].includes(value.status);
      const state=published(candidate)&&published(key)?'COMPLETE'
        :candidate.status==='ABSENT'&&key.status==='ABSENT'?'ABSENT':'PARTIAL';
      const completePath=buyerWriterGatewayV4CompletePath(input.candidatePath);
      const markerAbsent=absentPath(io,completePath);
      if(!markerAbsent){
        const snapshot=(deps.readSnapshot??readRootOwnedJsonSnapshot)(completePath,
          {groupId:0,maxBytes:4096,io,aclTool});
        if(snapshot.identity.uid!==0||snapshot.identity.gid!==0
          ||(snapshot.identity.mode&0o7777)!==0o600
          ||!same(snapshot.value,completeValue(intent))||state!=='COMPLETE')fail();
      }
      return Object.freeze({status:state,releaseSha:intent.releaseSha,
        operationId:intent.operationId,attemptId:intent.attemptId,
        keyId:`zola-${intent.releaseSha.slice(0,16)}`,
        candidatePath:intent.candidatePath,keyPath:intent.keyPath,
        candidateDigest:intent.candidateDigest,publicKeyDigest:intent.publicKeyDigest,
        completeRecorded:!markerAbsent});
    }finally{closeObservation(io,candidate);closeObservation(io,key);}
  }catch{fail();}
}
export async function reconcileBuyerWriterGatewayV4Preparation(input,deps={}){
  try{
    const io=deps.io??fs,aclTool=deps.aclTool??spawnSync;
    const loaded=await loadPreparationState(input,{...deps,reconcileRootRecords:true});
    const completePath=buyerWriterGatewayV4CompletePath(input.candidatePath);
    if(!absentPath(io,completePath)&&!absentPath(io,rootRecordStagePath(completePath)))
      readRootRecord(io,aclTool,completePath,{maxBytes:4096,reconcile:true});
    const observed=await inspectBuyerWriterGatewayV4Preparation(input,deps);
    const {identity,intent}=loaded;
    const candidate=observeRecordedFile(io,aclTool,intent.candidatePath,
      intent.candidateStagePath,{uid:0,gid:0,size:intent.candidateSize,
        digest:intent.candidateDigest});
    const key=observeRecordedFile(io,aclTool,intent.keyPath,intent.keyStagePath,
      {uid:identity.apiUid,gid:identity.credentialGroupId,size:intent.keySize,
        digest:intent.keyDigest,publicKeyDigest:intent.publicKeyDigest});
    try{
      if(candidate.status==='FOREIGN'||key.status==='FOREIGN')fail();
      if(observed.status==='COMPLETE'){
        for(const [stageName,value] of [[intent.candidateStagePath,candidate],
          [intent.keyStagePath,key]])if(value.status==='LINKED'){
          if(!heldMatches(io,stageName,value.stage.fd))fail();
          io.unlinkSync(stageName);syncDirectory(io,path.dirname(stageName));
        }
        if(!observed.completeRecorded)writeRootRecord(io,aclTool,
          buyerWriterGatewayV4CompletePath(input.candidatePath),completeValue(intent));
        return Object.freeze({...observed,status:'BUYER_WRITER_GATEWAY_V4_PREPARED',
          completeRecorded:true});
      }
      for(const [targetName,stageName,value] of [
        [intent.candidatePath,intent.candidateStagePath,candidate],
        [intent.keyPath,intent.keyStagePath,key],
      ]){
        for(const [name,item] of [[targetName,value.target],[stageName,value.stage]])if(item){
          if(!heldMatches(io,name,item.fd))fail();
          io.unlinkSync(name);syncDirectory(io,path.dirname(name));
        }
      }
    }finally{closeObservation(io,candidate);closeObservation(io,key);}
    return Object.freeze({...observed,status:observed.status==='ABSENT'
      ?'ABSENT_RETRY_NOT_AUTHORIZED':'PARTIAL_REMOVED_RETRY_NOT_AUTHORIZED',
      completeRecorded:false});
  }catch{fail();}
}

const retiredKeys=['version','status','releaseSha','operationId','attemptId','nextAttemptId',
  'candidatePath','intentDigest'];
function validateRetired(value,input,nextAttemptId){
  if(!exact(value,retiredKeys)||value.version!==1||value.status!=='RETIRED'
    ||value.releaseSha!==input.releaseSha||value.operationId!==input.operationId
    ||value.attemptId!==input.attemptId||value.nextAttemptId!==nextAttemptId
    ||value.candidatePath!==input.candidatePath||!/^[a-f0-9]{64}$/.test(value.intentDigest??''))fail();
  return value;
}
function retiredValue(intent,nextAttemptId){
  return Object.freeze({version:1,status:'RETIRED',releaseSha:intent.releaseSha,
    operationId:intent.operationId,attemptId:intent.attemptId,nextAttemptId,
    candidatePath:intent.candidatePath,intentDigest:stableDigest(intent)});
}
export async function retireBuyerWriterGatewayV4Preparation(input,{nextAttemptId,...deps}={}){
  try{
    if(!UUID.test(nextAttemptId??'')||nextAttemptId===input.attemptId
      ||nextAttemptId===input.operationId)fail();
    const io=deps.io??fs,aclTool=deps.aclTool??spawnSync;
    const intentPath=buyerWriterGatewayV4IntentPath(input.candidatePath);
    const retiredPath=buyerWriterGatewayV4RetiredPath(input.candidatePath,input.attemptId);
    if(!absentPath(io,retiredPath)){
      const marker=validateRetired(readRootRecord(io,aclTool,retiredPath,
        {maxBytes:4096,reconcile:true}).value,input,nextAttemptId);
      if(absentPath(io,intentPath))return Object.freeze({
        status:'RETIRED_RETRY_AUTHORIZED',releaseSha:input.releaseSha,
        operationId:input.operationId,attemptId:input.attemptId,nextAttemptId,
        candidatePath:input.candidatePath,reconciled:true});
      const {intent}=await loadPreparationState(input,{...deps,reconcileRootRecords:true});
      if(marker.intentDigest!==stableDigest(intent))fail();
    }
    const reconciled=await reconcileBuyerWriterGatewayV4Preparation(input,deps);
    if(!['ABSENT_RETRY_NOT_AUTHORIZED','PARTIAL_REMOVED_RETRY_NOT_AUTHORIZED']
      .includes(reconciled.status))fail();
    const {intent}=await loadPreparationState(input,{...deps,reconcileRootRecords:true});
    writeRootRecord(io,aclTool,retiredPath,retiredValue(intent,nextAttemptId));
    if(!absentPath(io,intentPath)){
      io.unlinkSync(intentPath);syncDirectory(io,path.dirname(intentPath));
    }
    return Object.freeze({...reconciled,status:'RETIRED_RETRY_AUTHORIZED',nextAttemptId});
  }catch{fail();}
}

function verifyRetryAuthorization(input,io,aclTool){
  const intentName=path.basename(buyerWriterGatewayV4IntentPath(input.candidatePath));
  const prefix=intentName.replace(/\.intent\.json$/,'.retired-');
  const entries=io.readdirSync(PREPARATION_ROOT).filter(name=>
    name.startsWith(prefix)&&name.endsWith('.json')&&!name.endsWith('.json.stage'));
  if(entries.length===0)return false;
  let matched=0;
  for(const entry of entries){
    const attemptId=entry.slice(prefix.length,-'.json'.length);
    if(!UUID.test(attemptId))fail();
    const marker=readRootRecord(io,aclTool,path.join(PREPARATION_ROOT,entry),
      {maxBytes:4096,reconcile:true}).value;
    if(!exact(marker,retiredKeys)||marker.version!==1||marker.status!=='RETIRED'
      ||marker.releaseSha!==input.releaseSha||marker.operationId!==input.operationId
      ||marker.candidatePath!==input.candidatePath||marker.attemptId!==attemptId
      ||!UUID.test(marker.nextAttemptId??'')||!/^[a-f0-9]{64}$/.test(marker.intentDigest??''))fail();
    if(marker.nextAttemptId===input.attemptId)matched++;
  }
  if(matched!==1)fail();
  return true;
}
async function prepareHigh(input,{
  io=fs,aclTool=spawnSync,readSnapshot=readRootOwnedJsonSnapshot,
  inspectArtifact=inspectSealedBuyerWriterArtifact,resolveIdentity=systemIdentity,...deps
}={}){
  try{
    if(!highInput(input)||typeof readSnapshot!=='function'
      ||typeof inspectArtifact!=='function'||typeof resolveIdentity!=='function')fail();
    const identity=await resolveIdentity();
    if(!identity||!Number.isInteger(identity.apiUid)||identity.apiUid<=0
      ||!Number.isInteger(identity.credentialGroupId)||identity.credentialGroupId<=0
      ||!Number.isInteger(identity.writerGroupId)||identity.writerGroupId<=0)fail();
    const source=readSnapshot(input.sourceConfigurationFile,{groupId:0,maxBytes:65536,
      io,aclTool});
    const current=readSnapshot(CURRENT_GATEWAY,{groupId:identity.writerGroupId,
      maxBytes:65536,io,aclTool});
    const acceptance=readSnapshot(ACCEPTANCE_TARGET,{groupId:identity.credentialGroupId,
      maxBytes:32768,io,aclTool});
    acceptanceTarget(acceptance.value,input.releaseSha);
    const observed=await inspectArtifact({artifactRoot:input.artifactRoot,
      releaseSha:input.releaseSha,environment:'production'});
    const builtInput={releaseSha:input.releaseSha,operationId:input.operationId,
      attemptId:input.attemptId,workspace:WORKSPACE,origin:ORIGIN,
      keyId:`zola-${input.releaseSha.slice(0,16)}`,preparationRoot:PREPARATION_ROOT,
      candidatePath:input.candidatePath,artifact:observed,
      sourceConfiguration:source.value,currentGatewayConfiguration:current.value,
      acceptanceTarget:acceptance.value};
    const intentPath=buyerWriterGatewayV4IntentPath(input.candidatePath);
    const completePath=buyerWriterGatewayV4CompletePath(input.candidatePath);
    safeDirectory(io,KEY_ROOT);safeDirectory(io,PREPARATION_ROOT);
    noDefaultAcl(aclTool,KEY_ROOT);noDefaultAcl(aclTool,PREPARATION_ROOT);
    verifyRetryAuthorization(input,io,aclTool);
    if(!absentPath(io,intentPath)||!absentPath(io,rootRecordStagePath(intentPath))
      ||!absentPath(io,completePath)||!absentPath(io,rootRecordStagePath(completePath))
      ||!absentPath(io,input.candidatePath)
      ||!absentPath(io,path.join(KEY_ROOT,'buyer-writer-signing-key-zola-'
        +input.releaseSha.slice(0,16)+'.pem')))fail();
    const plan=buildBuyerWriterGatewayV4Preparation(builtInput,{...deps,
      apiUid:identity.apiUid,credentialGroupId:identity.credentialGroupId});
    const freshSource=readSnapshot(input.sourceConfigurationFile,{groupId:0,
      maxBytes:65536,io,aclTool});
    const freshCurrent=readSnapshot(CURRENT_GATEWAY,{groupId:identity.writerGroupId,
      maxBytes:65536,io,aclTool});
    const freshAcceptance=readSnapshot(ACCEPTANCE_TARGET,{groupId:identity.credentialGroupId,
      maxBytes:32768,io,aclTool});
    acceptanceTarget(freshAcceptance.value,input.releaseSha);
    const freshArtifact=await inspectArtifact({artifactRoot:input.artifactRoot,
      releaseSha:input.releaseSha,environment:'production'});
    if(!snapshotSame(source,freshSource)||!snapshotSame(current,freshCurrent)
      ||!snapshotSame(acceptance,freshAcceptance)||!same(observed,freshArtifact))fail();
    const publicationIdentity=await resolveIdentity();
    if(!same(identity,publicationIdentity))fail();
    const state=plans.get(plan);let keyStage,candidateStage,intentPublished=false;
    const intent=intentValue(input,source,current,acceptance,observed,state);
    try{
      writeRootRecord(io,aclTool,intentPath,intent);intentPublished=true;
      keyStage=stageFile(io,aclTool,state.input.keyPath,intent.keyStagePath,state.keyBytes,
        identity.apiUid,identity.credentialGroupId,0o600);
      candidateStage=stageFile(io,aclTool,state.input.candidatePath,
        intent.candidateStagePath,state.candidateBytes,0,0,0o600);
      promoteStage(io,aclTool,keyStage,state.keyBytes,identity.apiUid,
        identity.credentialGroupId,0o600);
      promoteStage(io,aclTool,candidateStage,state.candidateBytes,0,0,0o600);
      const prepared=result(state.input,'GATEWAY_V4_PREPARED',state.digests);
      const finalIdentity=await resolveIdentity();
      if(!same(publicationIdentity,finalIdentity))fail();
      verifyPublished(io,aclTool,prepared,finalIdentity,readSnapshot,acceptance.value);
      if(!heldMatches(io,state.input.candidatePath,candidateStage.fd)
        ||!heldMatches(io,state.input.keyPath,keyStage.fd))fail();
      writeRootRecord(io,aclTool,completePath,completeValue(intent));
      if(!heldMatches(io,state.input.candidatePath,candidateStage.fd)
        ||!heldMatches(io,state.input.keyPath,keyStage.fd))fail();
      closeHandle(io,candidateStage);closeHandle(io,keyStage);
      return highResult(prepared);
    }catch(error){
      if(intentPublished){
        abandonStage(io,candidateStage);abandonStage(io,keyStage);
      }else{
        cleanupStage(io,candidateStage);cleanupStage(io,keyStage);
      }
      throw error;
    }
  }catch{fail();}
}

function systemIdentity(run=execFileSync){
  const options={encoding:'utf8',timeout:1000,maxBuffer:4096,
    stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}};
  const passwd=run('/usr/bin/getent',['passwd','blackspire-api'],options).trim().split(':');
  const apiGroup=run('/usr/bin/getent',['group','blackspire-api'],options).trim().split(':');
  const writerGroup=run('/usr/bin/getent',['group','blackspire-writer'],options).trim().split(':');
  if(passwd.length!==7||passwd[0]!=='blackspire-api'||apiGroup.length!==4
    ||apiGroup[0]!=='blackspire-api'||writerGroup.length!==4
    ||writerGroup[0]!=='blackspire-writer'
    ||![passwd[2],passwd[3],apiGroup[2],writerGroup[2]]
      .every(value=>/^[1-9][0-9]{0,9}$/.test(value))
    ||passwd[3]!==apiGroup[2])fail();
  return Object.freeze({apiUid:Number(passwd[2]),credentialGroupId:Number(apiGroup[2]),
    writerGroupId:Number(writerGroup[2])});
}
function highResult(value){
  return Object.freeze({status:'BUYER_WRITER_GATEWAY_V4_PREPARED',
    releaseSha:value.releaseSha,operationId:value.operationId,attemptId:value.attemptId,
    keyId:value.keyId,candidatePath:value.candidatePath,keyPath:value.keyPath,
    candidateDigest:value.candidateDigest,publicKeyDigest:value.publicKeyDigest});
}
function highInput(value){
  return exact(value,['releaseSha','operationId','attemptId','sourceConfigurationFile',
    'candidatePath','artifactRoot'])
    &&SHA.test(value.releaseSha??'')&&UUID.test(value.operationId??'')
    &&UUID.test(value.attemptId??'')&&value.operationId!==value.attemptId
    &&absolute(value.sourceConfigurationFile)&&absolute(value.candidatePath)
    &&path.dirname(value.sourceConfigurationFile)===PREPARATION_ROOT
    &&path.dirname(value.candidatePath)===PREPARATION_ROOT
    &&value.sourceConfigurationFile!==value.candidatePath&&absolute(value.artifactRoot)
    &&value.artifactRoot===path.join(RELEASE_ROOT,value.releaseSha);
}
function snapshotSame(left,right){
  return same(left?.identity,right?.identity)&&same(left?.value,right?.value);
}
function verifyPublished(io,aclTool,prepared,identity,readSnapshot,target){
  const candidate=readSnapshot(prepared.candidatePath,{groupId:0,maxBytes:65536,io,aclTool});
  const validated=validateBuyerWriterGatewayProvisioningConfiguration(
    candidate.value,{workspace:WORKSPACE});
  const permit=JSON.parse(validated.operationPermitConfiguration);
  if(permit.subject!==acceptanceTarget(target,prepared.releaseSha).ownerId)fail();
  const candidateBytes=Buffer.from(JSON.stringify(candidate.value)+'\n');
  if(digest(candidateBytes)!==prepared.candidateDigest)fail();
  let fd;
  try{
    fd=io.openSync(prepared.keyPath,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    const stat=io.fstatSync(fd);
    if(!stat.isFile()||stat.uid!==identity.apiUid||stat.gid!==identity.credentialGroupId
      ||stat.nlink!==1||(stat.mode&0o7777)!==0o600||stat.size<1||stat.size>4096)fail();
    noNamedAcl(aclTool,fd);
    const pem=io.readFileSync(fd,{encoding:'utf8'});
    const publicPem=createPublicKey(createPrivateKey(pem)).export({type:'spki',format:'pem'});
    if(digest(Buffer.from(publicPem))!==prepared.publicKeyDigest)fail();
  }finally{if(fd!==undefined)io.closeSync(fd);}
}

export function prepareBuyerWriterGatewayV4(input,deps={}){
  const direct=exact(input,['releaseSha','operationId','attemptId','workspace','origin',
    'keyId','preparationRoot','candidatePath','artifact','sourceConfiguration',
    'currentGatewayConfiguration','acceptanceTarget']);
  if(!direct)return prepareHigh(input,deps);
  try{
    const plan=buildBuyerWriterGatewayV4Preparation(input,deps);
    return publishBuyerWriterGatewayV4Preparation(plan,{...deps,
      artifactProof:input.artifact});
  }catch{fail();}
}
