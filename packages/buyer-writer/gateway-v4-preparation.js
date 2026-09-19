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
const RELEASE_ROOT='/opt/blackspire-command/releases';
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
    io.linkSync(temporary,name);io.unlinkSync(temporary);
    syncDirectory(io,path.dirname(name));
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
    'preparationRoot','candidatePath','artifact','sourceConfiguration','currentGatewayConfiguration'];
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
  if(current.version!==2||source.units||source.rehearsalFile
    ||source.workspace!==current.workspace||source.creatorOid!==current.creatorOid
    ||!same(source.runtime,current.runtime)||!same(source.issuer,current.issuer)
    ||current.authority.releaseSha===input.releaseSha)fail();
  return {source,current};
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
  now=Date.now,randomBytes:random=randomBytes,randomUUID:uuid=randomUUID,
  generateKeyPairSync:generate=generateKeyPairSync,apiUid,credentialGroupId,
}={}){
  try{
    const {source,current}=validateInput(input);
    if(typeof now!=='function'||typeof random!=='function'||typeof uuid!=='function'
      ||typeof generate!=='function'||!Number.isInteger(apiUid)||apiUid<=0
      ||!Number.isInteger(credentialGroupId)||credentialGroupId<=0)fail();
    const admissionCredential=random(32).toString('base64url'),subject=uuid();
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
    inspectBuyerWriterGatewayConfigurationUpgrade({operationId:input.operationId,
      oldConfiguration:current,newConfiguration:rendered.gatewayConfig});
    const candidateBytes=Buffer.from(JSON.stringify(candidate)+'\n');
    const keyBytes=Buffer.from(privateKey);
    const digests={candidateDigest:digest(candidateBytes),
      publicKeyDigest:digest(Buffer.from(publicKey))};
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
    const observed=await inspectArtifact({artifactRoot:input.artifactRoot,
      releaseSha:input.releaseSha,environment:'production'});
    const builtInput={releaseSha:input.releaseSha,operationId:input.operationId,
      attemptId:input.attemptId,workspace:WORKSPACE,origin:ORIGIN,
      keyId:`zola-${input.releaseSha.slice(0,16)}`,preparationRoot:PREPARATION_ROOT,
      candidatePath:input.candidatePath,artifact:observed,
      sourceConfiguration:source.value,currentGatewayConfiguration:current.value};
    const plan=buildBuyerWriterGatewayV4Preparation(builtInput,{...deps,
      apiUid:identity.apiUid,credentialGroupId:identity.credentialGroupId});
    const freshSource=readSnapshot(input.sourceConfigurationFile,{groupId:0,
      maxBytes:65536,io,aclTool});
    const freshCurrent=readSnapshot(CURRENT_GATEWAY,{groupId:identity.writerGroupId,
      maxBytes:65536,io,aclTool});
    const freshArtifact=await inspectArtifact({artifactRoot:input.artifactRoot,
      releaseSha:input.releaseSha,environment:'production'});
    if(!snapshotSame(source,freshSource)||!snapshotSame(current,freshCurrent)
      ||!same(observed,freshArtifact))fail();
    const publicationIdentity=await resolveIdentity();
    if(!same(identity,publicationIdentity))fail();
    const prepared=publishBuyerWriterGatewayV4Preparation(plan,{io,aclTool,
      artifactProof:freshArtifact,retainHandles:RETAIN_HANDLES});
    try{
      const finalIdentity=await resolveIdentity();
      if(!same(publicationIdentity,finalIdentity))fail();
      verifyPublished(io,aclTool,prepared,finalIdentity,readSnapshot);
    }catch(error){
      rollbackOwnedPreparation(io,prepared);
      throw error;
    }
    commitOwnedPreparation(io,prepared);
    return highResult(prepared);
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
function verifyPublished(io,aclTool,prepared,identity,readSnapshot){
  const candidate=readSnapshot(prepared.candidatePath,{groupId:0,maxBytes:65536,io,aclTool});
  validateBuyerWriterGatewayProvisioningConfiguration(candidate.value,{workspace:WORKSPACE});
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
    'currentGatewayConfiguration']);
  if(!direct)return prepareHigh(input,deps);
  try{
    const plan=buildBuyerWriterGatewayV4Preparation(input,deps);
    return publishBuyerWriterGatewayV4Preparation(plan,{...deps,
      artifactProof:input.artifact});
  }catch{fail();}
}
