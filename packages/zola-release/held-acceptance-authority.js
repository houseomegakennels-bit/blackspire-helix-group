import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {RELEASE_ADMISSION_ROOT,acquireReleaseAdmissionLock,validateReleaseAdmissionState} from '../shared/release-admission.js';
import {readRootOwnedJson} from '../buyer-writer/protected-json.js';
import {hash} from './commander-journal.js';

export const HELD_ACCEPTANCE_OPERATIONS=Object.freeze([
 'api_worker_health_readiness','generation_fence','six_live_reads','production_smoke',
 'zero_paid_nexus','zero_unintended_mutation','rollback_verification',
]);
export const HELD_ACCEPTANCE_CAPABILITIES=Object.freeze([
 'seller.opportunities.search','buyer.profiles.search','buyer.matches.search',
 'deal.records.search','deal.analysis.get','nexus.enrichment.status',
]);
const sessions=new WeakMap();
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const generation=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const reject=()=>{throw new Error('HELD acceptance authority rejected');};
const tokenDigest=token=>createHash('sha256').update(token).digest('hex');
const sync=(io,directory)=>{const fd=io.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{io.fsyncSync(fd);}finally{io.closeSync(fd);}};
function atomic(io,filename,value,{mode=0o600,uid=0,gid=0}={}){
 const directory=path.dirname(filename),temporary=path.join(directory,`.held-acceptance-${randomUUID()}.tmp`);let fd;
 try{fd=io.openSync(temporary,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  io.fchownSync(fd,uid,gid);io.fchmodSync(fd,mode);io.writeFileSync(fd,JSON.stringify(value)+'\n');io.fsyncSync(fd);io.closeSync(fd);fd=undefined;
  io.renameSync(temporary,filename);sync(io,directory);
 }finally{if(fd!==undefined)io.closeSync(fd);try{io.unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
function validateReads(reads){
 if(!Array.isArray(reads)||reads.length!==6)return false;
 const keys=new Set();
 return reads.every((row,index)=>exact(row,['index','idempotencyKey','capability','permission','requestDigest'])&&row.index===index
  &&typeof row.idempotencyKey==='string'&&/^zola-six:[a-f0-9-]{36}:[0-5]$/.test(row.idempotencyKey)&&!keys.has(row.idempotencyKey)
  &&(keys.add(row.idempotencyKey),row.capability===HELD_ACCEPTANCE_CAPABILITIES[index])
  &&typeof row.permission==='string'&&/^[a-z]+(?:\.[a-z]+)+$/.test(row.permission)&&digest(row.requestDigest));
}
function validateClaims(value){
 if(!exact(value,['schema','kind','permitId','commanderRunId','mergeMainSha','expectedDeploymentSha','epochRunId','workspace','apiGeneration','workerGeneration','issuedAt','expiresAt','operations','reads','tokenDigest'])
  ||value.schema!==1||value.kind!=='held-epoch-acceptance'||![value.permitId,value.commanderRunId,value.epochRunId].every(uuid)
  ||!sha(value.mergeMainSha)||value.expectedDeploymentSha!==value.mergeMainSha||typeof value.workspace!=='string'||!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(value.workspace)
  ||![value.apiGeneration,value.workerGeneration].every(generation)||value.apiGeneration===value.workerGeneration
  ||!Number.isSafeInteger(value.issuedAt)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=value.issuedAt||value.expiresAt-value.issuedAt>15*60*1000
  ||JSON.stringify(value.operations)!==JSON.stringify(HELD_ACCEPTANCE_OPERATIONS)||!validateReads(value.reads)||!digest(value.tokenDigest))reject();
 return structuredClone(value);
}
function authorityRows(events){return events.filter(row=>String(row?.type??'').startsWith('held_acceptance_'));}
export function inspectHeldAcceptanceHistory(events){
 const rows=authorityRows(events);if(!rows.length)return Object.freeze({status:'ABSENT',claims:null});
 let claims,minted=false,consumeIntent=false,consumed=false;
 for(const row of rows){
  if(row.type==='held_acceptance_mint_intent'){
   if(claims||!exact(row,['schema','type','claims','claimsDigest'])||row.schema!==1)reject();claims=validateClaims(row.claims);if(row.claimsDigest!==hash(claims))reject();
  }else if(row.type==='held_acceptance_minted'){
   if(!claims||minted||!exact(row,['schema','type','permitId','claimsDigest'])||row.schema!==1||row.permitId!==claims.permitId||row.claimsDigest!==hash(claims))reject();minted=true;
  }else if(row.type==='held_acceptance_consume_intent'){
   if(!minted||consumeIntent||!exact(row,['schema','type','permitId','claimsDigest'])||row.schema!==1||row.permitId!==claims.permitId||row.claimsDigest!==hash(claims))reject();consumeIntent=true;
  }else if(row.type==='held_acceptance_consumed'){
   if(!consumeIntent||consumed||!exact(row,['schema','type','permitId','claimsDigest','operationsDigest'])||row.schema!==1||row.permitId!==claims.permitId
    ||row.claimsDigest!==hash(claims)||row.operationsDigest!==hash(HELD_ACCEPTANCE_OPERATIONS))reject();consumed=true;
  }else reject();
 }
 return Object.freeze({status:consumed?'CONSUMED':consumeIntent?'CONSUMPTION_UNKNOWN':minted?'MINTED':'MINT_UNKNOWN',claims:Object.freeze(claims)});
}
export function mintHeldAcceptancePermit({commanderRunId,mergeMainSha,expectedDeploymentSha,epochRunId,workspace,apiGeneration,workerGeneration,reads,journal,verifyGenerations,now=Date.now},
 {root=RELEASE_ADMISSION_ROOT,owner=0,groupId=0,secretGroupId=0,io=fs,acquire=acquireReleaseAdmissionLock,readState=()=>readRootOwnedJson(path.join(root,'state.json'),{groupId,maxBytes:2048}),
 readAuthority=()=>readRootOwnedJson(path.join(root,'acceptance.json'),{groupId,maxBytes:16384}),readSecret=()=>readRootOwnedJson(path.join(root,'acceptance-secret.json'),{groupId:0,maxBytes:1024}),getuid=()=>process.getuid()}={}){
 let lease;try{
  if(getuid()!==0||typeof journal?.stream!=='function'||typeof verifyGenerations!=='function')reject();const stream=journal.stream('release');
  const history=inspectHeldAcceptanceHistory(stream.events());if(!['ABSENT','MINT_UNKNOWN'].includes(history.status))reject();
  lease=acquire({root,exclusive:true,owner,groupId});lease.assertIdentity();const state=validateReleaseAdmissionState(readState());
  const expectedGenerations={apiGeneration,workerGeneration};
  if(JSON.stringify(verifyGenerations())!==JSON.stringify(expectedGenerations)||JSON.stringify(verifyGenerations())!==JSON.stringify(expectedGenerations))reject();
  if(state.mode!=='held'||state.releaseSha!==mergeMainSha||state.runId!==epochRunId
   ||!((state.apiGeneration===null&&state.workerGeneration===null)||(state.apiGeneration===apiGeneration&&state.workerGeneration===workerGeneration)))reject();
  if(history.status==='MINT_UNKNOWN'){
   const claims=validateClaims(readAuthority()),secret=readSecret();
   if(!exact(secret,['schema','permitId','token'])||secret.schema!==1||secret.permitId!==claims.permitId||typeof secret.token!=='string'||secret.token.length!==43
    ||tokenDigest(secret.token)!==claims.tokenDigest||hash(claims)!==hash(history.claims)||now()>=claims.expiresAt
    ||!['commanderRunId','mergeMainSha','expectedDeploymentSha','epochRunId','workspace','apiGeneration','workerGeneration'].every(key=>claims[key]===({commanderRunId,mergeMainSha,expectedDeploymentSha,epochRunId,workspace,apiGeneration,workerGeneration})[key])
    ||JSON.stringify(claims.reads)!==JSON.stringify(reads)||state.apiGeneration!==apiGeneration||state.workerGeneration!==workerGeneration)reject();
   stream.append({schema:1,type:'held_acceptance_minted',permitId:claims.permitId,claimsDigest:hash(claims)});return Object.freeze({token:secret.token,claims:Object.freeze(claims)});
  }
  for(const name of ['acceptance.json','acceptance-secret.json'])try{io.lstatSync(path.join(root,name));reject();}catch(error){if(error.code!=='ENOENT')throw error;}
  const issuedAt=now(),token=randomBytes(32).toString('base64url');
  const claims=validateClaims({schema:1,kind:'held-epoch-acceptance',permitId:randomUUID(),commanderRunId,mergeMainSha,expectedDeploymentSha,epochRunId,workspace,
   apiGeneration,workerGeneration,issuedAt,expiresAt:issuedAt+15*60*1000,operations:[...HELD_ACCEPTANCE_OPERATIONS],reads:structuredClone(reads),tokenDigest:tokenDigest(token)});
  const claimsDigest=hash(claims);stream.append({schema:1,type:'held_acceptance_mint_intent',claims,claimsDigest});
  atomic(io,path.join(root,'acceptance-secret.json'),{schema:1,permitId:claims.permitId,token},{uid:owner,gid:secretGroupId});
  atomic(io,path.join(root,'acceptance.json'),claims,{mode:0o640,uid:owner,gid:groupId});
  atomic(io,path.join(root,'state.json'),{...state,apiGeneration,workerGeneration},{mode:0o640,uid:owner,gid:groupId});
  lease.assertIdentity();stream.append({schema:1,type:'held_acceptance_minted',permitId:claims.permitId,claimsDigest});
  return Object.freeze({token,claims:Object.freeze(claims)});
 }catch{reject();}finally{lease?.close();}
}
export function consumeHeldAcceptancePermit({token,journal,now=Date.now},{root=RELEASE_ADMISSION_ROOT,owner=0,groupId=0,secretGroupId=0,io=fs,acquire=acquireReleaseAdmissionLock,
 readState=()=>readRootOwnedJson(path.join(root,'state.json'),{groupId,maxBytes:2048}),readAuthority=()=>readRootOwnedJson(path.join(root,'acceptance.json'),{groupId,maxBytes:16384}),
 readSecret=()=>readRootOwnedJson(path.join(root,'acceptance-secret.json'),{groupId:secretGroupId,maxBytes:1024}),verifyGenerations,getuid=()=>process.getuid()}={}){
 let lease;try{
  if(getuid()!==0||typeof token!=='string'||token.length!==43||typeof journal?.stream!=='function'||typeof verifyGenerations!=='function')reject();const stream=journal.stream('release'),history=inspectHeldAcceptanceHistory(stream.events());
  if(history.status!=='MINTED')reject();lease=acquire({root,exclusive:true,owner,groupId});lease.assertIdentity();
  const claims=validateClaims(readAuthority()),secret=readSecret(),state=validateReleaseAdmissionState(readState());
  const supplied=Buffer.from(tokenDigest(token),'hex'),expected=Buffer.from(claims.tokenDigest,'hex');
  if(!exact(secret,['schema','permitId','token'])||secret.schema!==1||secret.permitId!==claims.permitId||secret.token!==token
   ||!timingSafeEqual(supplied,expected)||hash(claims)!==hash(history.claims)||now()>=claims.expiresAt||state.mode!=='held'||state.releaseSha!==claims.mergeMainSha
   ||state.runId!==claims.epochRunId||state.apiGeneration!==claims.apiGeneration||state.workerGeneration!==claims.workerGeneration)reject();
  if(JSON.stringify(verifyGenerations())!==JSON.stringify({apiGeneration:claims.apiGeneration,workerGeneration:claims.workerGeneration}))reject();
  stream.append({schema:1,type:'held_acceptance_consume_intent',permitId:claims.permitId,claimsDigest:hash(claims)});
  const session=Object.freeze({permitId:claims.permitId});sessions.set(session,{claims,remaining:new Set(HELD_ACCEPTANCE_OPERATIONS),root,owner,groupId,secretGroupId,io,acquire,readState,readAuthority,verifyGenerations,journal,now});return session;
 }catch{reject();}finally{lease?.close();}
}
export function authorizeHeldAcceptanceOperation(session,operation,bindings){
 const state=sessions.get(session);try{
  if(!state||!state.remaining.has(operation)||!exact(bindings,['mergeMainSha','expectedDeploymentSha','epochRunId','workspace','apiGeneration','workerGeneration'])
   ||!['mergeMainSha','expectedDeploymentSha','epochRunId','workspace','apiGeneration','workerGeneration'].every(key=>bindings[key]===state.claims[key])||state.now()>=state.claims.expiresAt)reject();
  state.remaining.delete(operation);return Object.freeze({permitId:state.claims.permitId,operation,claimsDigest:hash(state.claims)});
 }catch{reject();}
}
export function finishHeldAcceptancePermit(session){
 const state=sessions.get(session);let lease;try{
  if(!state||state.remaining.size)reject();lease=state.acquire({root:state.root,exclusive:true,owner:state.owner,groupId:state.groupId});lease.assertIdentity();
  const admission=validateReleaseAdmissionState(state.readState());
  if(state.now()>=state.claims.expiresAt||admission.mode!=='held'||admission.releaseSha!==state.claims.mergeMainSha||admission.runId!==state.claims.epochRunId
   ||admission.apiGeneration!==state.claims.apiGeneration||admission.workerGeneration!==state.claims.workerGeneration
   ||JSON.stringify(state.verifyGenerations())!==JSON.stringify({apiGeneration:state.claims.apiGeneration,workerGeneration:state.claims.workerGeneration}))reject();
  const filename=path.join(state.root,'acceptance.json'),retained=validateClaims(state.readAuthority());if(hash(retained)!==hash(state.claims))reject();
  for(const [name,mode,gid] of [['acceptance.json',0o640,state.groupId],['acceptance-secret.json',0o600,state.secretGroupId]]){
   const target=path.join(state.root,name),fd=state.io.openSync(target,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
   try{const stat=state.io.fstatSync(fd);if(!stat.isFile()||stat.uid!==state.owner||stat.gid!==gid||stat.nlink!==1||(stat.mode&0o7777)!==mode)reject();state.io.unlinkSync(target);sync(state.io,state.root);}finally{state.io.closeSync(fd);}
  }
  state.journal.stream('release').append({schema:1,type:'held_acceptance_consumed',permitId:state.claims.permitId,claimsDigest:hash(state.claims),operationsDigest:hash(HELD_ACCEPTANCE_OPERATIONS)});
  sessions.delete(session);return{status:'CONSUMED',permitId:state.claims.permitId,acceptanceDigest:hash(state.claims)};
 }catch{reject();}finally{lease?.close();}
}
