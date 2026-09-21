import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {validateBuyerWriterConfiguration,validateBuyerWriterGatewayAuthority} from './configuration.js';
import {readRootOwnedJsonSnapshot} from './protected-json.js';
import {inspectSealedBuyerWriterArtifact} from './artifact-inspection.js';
import {collectBuyerWriterSourceV1Catalog} from './source-v1-catalog-collector.js';

const WORKSPACE='blackspire-command',ENVIRONMENT='production';
const PREPARATION_ROOT='/var/lib/blackspire-operator/preparation';
const RELEASE_ROOT='/opt/blackspire-command/releases';
const MANAGEMENT_CONFIG='/etc/blackspire-buyer-writer-gateway/management.json';
const HOST='db.kchtrvfcixnimvxxctkj.supabase.co';
const SHA=/^[a-f0-9]{40}$/,DIGEST=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const fail=()=>{throw new Error('Buyer writer source v1 preparation failed');};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)
  &&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const absolute=v=>typeof v==='string'&&v.length<=4096&&path.isAbsolute(v)
  &&path.resolve(v)===v&&v!=='/';
const hash=v=>createHash('sha256').update(v).digest('hex');
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`
  :v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
    :JSON.stringify(v);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sameSnapshot=(a,b)=>same(a?.identity,b?.identity)&&same(a?.value,b?.value);

function validArtifact(v,releaseSha){
  return exact(v,['releaseSha','environment','artifactDigest','status','deployed','productionAccepted'])
    &&v.releaseSha===releaseSha&&v.environment===ENVIRONMENT&&DIGEST.test(v.artifactDigest??'')
    &&v.status==='SEALED_ARTIFACT_VERIFIED'&&v.deployed===false&&v.productionAccepted===false;
}
function legacyCredentialSource(value){
  try{
    if(!exact(value,['version','workspace','bindingFile','writerCredential','issuerCredential',
      'gatewayCapability','creatorOid','authority','runtime','issuer'])||value.version!==3
      ||value.workspace!==WORKSPACE)fail();
    validateBuyerWriterGatewayAuthority(value.authority,{workspace:WORKSPACE});
    const source=validateBuyerWriterConfiguration({version:1,workspace:value.workspace,
      bindingFile:value.bindingFile,writerCredential:value.writerCredential,
      issuerCredential:value.issuerCredential,creatorOid:value.creatorOid,
      runtime:value.runtime,issuer:value.issuer},{workspace:WORKSPACE,environment:ENVIRONMENT});
    if(value.runtime.host!==HOST||value.issuer.host!==HOST||value.runtime.port!==5432
      ||value.issuer.port!==5432||value.runtime.database!=='postgres'
      ||value.issuer.database!=='postgres'||typeof value.gatewayCapability!=='string'
      ||!/^[A-Za-z0-9_-]{43}$/.test(value.gatewayCapability)
      ||[source.writerCredential,source.issuerCredential,source.runtime.password,
        source.issuer.password].includes(value.gatewayCapability))fail();
    return source;
  }catch{fail();}
}
function validateCatalog(value,{releaseSha,artifactDigest,credentialSourceDigest,now}){
  try{
    if(!exact(value,['version','kind','releaseSha','environment','workspace','artifactDigest',
      'credentialSourceDigest','capturedAt','target','authentication'])||value.version!==1
      ||value.kind!=='buyer-writer-authenticated-catalog-evidence'
      ||value.releaseSha!==releaseSha||value.environment!==ENVIRONMENT
      ||value.workspace!==WORKSPACE||value.artifactDigest!==artifactDigest
      ||value.credentialSourceDigest!==credentialSourceDigest
      ||!exact(value.target,['host','port','database','serverMajor'])
      ||value.target.host!==HOST||value.target.port!==5432
      ||value.target.database!=='postgres'||value.target.serverMajor!==17
      ||!exact(value.authentication,['sessionUser','currentUser','creatorRole',
        'sessionUserOid','currentUserOid','creatorOid','authenticated'])
      ||value.authentication.sessionUser!=='postgres'
      ||value.authentication.currentUser!=='postgres'
      ||value.authentication.creatorRole!=='postgres'
      ||value.authentication.authenticated!==true)fail();
    const oids=['sessionUserOid','currentUserOid','creatorOid'].map(k=>value.authentication[k]);
    if(oids.some(oid=>!Number.isInteger(oid)||oid<1||oid>4294967295)||new Set(oids).size!==1)fail();
    const captured=Date.parse(value.capturedAt),time=now();
    if(!Number.isFinite(captured)||!Number.isFinite(time)
      ||captured>time+30000||time-captured>300000)fail();
    return oids[0];
  }catch{fail();}
}
export function buildBuyerWriterSourceV1({releaseSha,artifact,credentialSource,catalogEvidence,now=Date.now}){
  try{
    if(!SHA.test(releaseSha??'')||!validArtifact(artifact,releaseSha)||typeof now!=='function')fail();
    const source=legacyCredentialSource(credentialSource);
    const credentialSourceDigest=hash(Buffer.from(canonical(credentialSource)));
    const creatorOid=validateCatalog(catalogEvidence,{releaseSha,artifactDigest:artifact.artifactDigest,
      credentialSourceDigest,now});
    if(source.creatorOid!==creatorOid)fail();
    const configuration=validateBuyerWriterConfiguration({...source},
      {workspace:WORKSPACE,environment:ENVIRONMENT});
    return Object.freeze({configuration,credentialSourceDigest,
      catalogEvidenceDigest:hash(Buffer.from(canonical(catalogEvidence))),
      configurationDigest:hash(Buffer.from(JSON.stringify(configuration)+'\n'))});
  }catch{fail();}
}
function safeDirectory(io,directory){
  let current='/';for(const part of directory.split('/').filter(Boolean)){
    current=path.join(current,part);const stat=io.lstatSync(current);
    if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022)!==0)fail();
  }
}
function aclFree(aclTool,args,stdio=['ignore','pipe','pipe']){
  const r=aclTool('/usr/bin/getfacl',args,{encoding:'utf8',stdio,timeout:1000,maxBuffer:4096,
    killSignal:'SIGKILL',env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
  if(r.status!==0||r.error||r.signal!==null||r.stdout!==''||r.stderr!=='')fail();
}
function syncDirectory(io,directory){
  const fd=io.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
  try{io.fsyncSync(fd);}finally{io.closeSync(fd);}
}
function exactFile(io,aclTool,filename,bytes,links=1){
  let fd,found;
  try{
    fd=io.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    const before=io.fstatSync(fd);
    if(!before.isFile()||before.uid!==0||before.gid!==0||before.nlink!==links
      ||(before.mode&0o7777)!==0o600||before.size!==bytes.length)fail();
    aclFree(aclTool,['--numeric','--omit-header','--skip-base','--logical','--','/proc/self/fd/3'],
      ['ignore','pipe','pipe',fd]);
    found=Buffer.alloc(bytes.length+1);let used=0;
    while(used<found.length){const count=io.readSync(fd,found,used,found.length-used,null);if(!count)break;used+=count;}
    const after=io.fstatSync(fd);
    if(used!==bytes.length||!found.subarray(0,used).equals(bytes)
      ||['dev','ino','uid','gid','mode','nlink','size','ctimeMs','mtimeMs'].some(key=>before[key]!==after[key]))fail();
    return after;
  }finally{found?.fill(0);if(fd!==undefined)io.closeSync(fd);}
}
function maybeStat(io,filename){try{return io.lstatSync(filename);}catch(error){if(error?.code==='ENOENT')return null;throw error;}}
function publish(io,aclTool,filename,bytes,nonce){
  let fd;
  try{
    safeDirectory(io,path.dirname(filename));
    aclFree(aclTool,['--numeric','--omit-header','--skip-base','--default','--logical','--',path.dirname(filename)]);
    if(!/^[a-f0-9]{32}$/.test(nonce))fail();
    const temp=path.join(path.dirname(filename),`.source-v1-${nonce}.tmp`);
    const installed=maybeStat(io,filename),staged=maybeStat(io,temp);
    if(installed){
      if(installed.nlink===1&&!staged){exactFile(io,aclTool,filename,bytes);return 'existing';}
      if(installed.nlink===2&&staged&&installed.dev===staged.dev&&installed.ino===staged.ino){
        exactFile(io,aclTool,filename,bytes,2);exactFile(io,aclTool,temp,bytes,2);
        io.unlinkSync(temp);syncDirectory(io,path.dirname(filename));
        exactFile(io,aclTool,filename,bytes);return 'recovered';
      }
      fail();
    }
    if(staged){
      exactFile(io,aclTool,temp,bytes);io.linkSync(temp,filename);io.unlinkSync(temp);
      syncDirectory(io,path.dirname(filename));exactFile(io,aclTool,filename,bytes);return 'recovered';
    }
    fd=io.openSync(temp,fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_EXCL
      |fs.constants.O_NOFOLLOW|fs.constants.O_CLOEXEC,0o600);
    aclFree(aclTool,['--numeric','--omit-header','--skip-base','--logical','--','/proc/self/fd/3'],
      ['ignore','pipe','pipe',fd]);
    io.fchownSync(fd,0,0);io.fchmodSync(fd,0o600);
    let used=0;while(used<bytes.length){const count=io.writeSync(fd,bytes,used,bytes.length-used,null);if(count<1)fail();used+=count;}
    io.fsyncSync(fd);io.closeSync(fd);fd=undefined;exactFile(io,aclTool,temp,bytes);
    io.linkSync(temp,filename);io.unlinkSync(temp);syncDirectory(io,path.dirname(filename));
    exactFile(io,aclTool,filename,bytes);return 'published';
  }catch{
    if(fd!==undefined)try{io.closeSync(fd);}catch{}
    fail();
  }
}
function highInput(v){
  return exact(v,['releaseSha','operationId','attemptId','credentialSourceFile',
    'managementConfigFile','destinationFile','artifactRoot'])&&SHA.test(v.releaseSha??'')
    &&UUID.test(v.operationId??'')&&UUID.test(v.attemptId??'')&&v.operationId!==v.attemptId
    &&[v.credentialSourceFile,v.destinationFile]
      .every(name=>absolute(name)&&path.dirname(name)===PREPARATION_ROOT)
    &&v.managementConfigFile===MANAGEMENT_CONFIG
    &&new Set([v.credentialSourceFile,v.managementConfigFile,v.destinationFile]).size===3
    &&v.artifactRoot===path.join(RELEASE_ROOT,v.releaseSha);
}
export async function prepareBuyerWriterSourceV1(input,{io=fs,aclTool=spawnSync,
  readSnapshot=readRootOwnedJsonSnapshot,inspectArtifact=inspectSealedBuyerWriterArtifact,
  collectCatalog=collectBuyerWriterSourceV1Catalog,connect,
  now=Date.now,nonce}={}){
  let bytes;
  try{
    if(!highInput(input)||typeof readSnapshot!=='function'||typeof inspectArtifact!=='function'
      ||typeof collectCatalog!=='function'||typeof connect!=='function')fail();
    nonce??=input.attemptId.replaceAll('-','');
    const credential=readSnapshot(input.credentialSourceFile,{groupId:0,maxBytes:65536,io,aclTool});
    const management=readSnapshot(input.managementConfigFile,{groupId:0,maxBytes:65536,io,aclTool});
    if([credential.value.writerCredential,credential.value.issuerCredential,credential.value.gatewayCapability,
      credential.value.runtime?.password,credential.value.issuer?.password].includes(management.value?.password))fail();
    const artifact=await inspectArtifact({artifactRoot:input.artifactRoot,
      releaseSha:input.releaseSha,environment:ENVIRONMENT});
    const credentialSourceDigest=hash(Buffer.from(canonical(credential.value)));
    const catalog=await collectCatalog({releaseSha:input.releaseSha,artifactDigest:artifact.artifactDigest,
      credentialSourceDigest,creatorOid:credential.value.creatorOid,
      target:{host:credential.value.runtime.host,port:credential.value.runtime.port,
        database:credential.value.runtime.database,ca:credential.value.runtime.ca},
      managementConfiguration:management.value},{connect,now});
    const built=buildBuyerWriterSourceV1({releaseSha:input.releaseSha,artifact,
      credentialSource:credential.value,catalogEvidence:catalog,now});
    const freshCredential=readSnapshot(input.credentialSourceFile,{groupId:0,maxBytes:65536,io,aclTool});
    const freshManagement=readSnapshot(input.managementConfigFile,{groupId:0,maxBytes:65536,io,aclTool});
    const freshArtifact=await inspectArtifact({artifactRoot:input.artifactRoot,
      releaseSha:input.releaseSha,environment:ENVIRONMENT});
    if(!sameSnapshot(credential,freshCredential)||!sameSnapshot(management,freshManagement)
      ||!same(artifact,freshArtifact))fail();
    buildBuyerWriterSourceV1({releaseSha:input.releaseSha,artifact:freshArtifact,
      credentialSource:freshCredential.value,catalogEvidence:catalog,now});
    bytes=Buffer.from(JSON.stringify(built.configuration)+'\n');
    publish(io,aclTool,input.destinationFile,bytes,nonce);
    const installed=readSnapshot(input.destinationFile,{groupId:0,maxBytes:65536,io,aclTool});
    validateBuyerWriterConfiguration(installed.value,{workspace:WORKSPACE,environment:ENVIRONMENT});
    if(hash(Buffer.from(JSON.stringify(installed.value)+'\n'))!==built.configurationDigest)fail();
    return Object.freeze({status:'BUYER_WRITER_SOURCE_V1_PREPARED',releaseSha:input.releaseSha,
      operationId:input.operationId,attemptId:input.attemptId,destinationFile:input.destinationFile,
      configurationDigest:built.configurationDigest,credentialSourceDigest:built.credentialSourceDigest,
      catalogEvidenceDigest:built.catalogEvidenceDigest});
  }catch{fail();}finally{bytes?.fill(0);}
}
