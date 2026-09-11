import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {HELD_ACCEPTANCE_ACTIVE_FILE,RELEASE_ADMISSION_ROOT,acquireReleaseAdmissionLock,validateReleaseAdmissionState} from '../shared/release-admission.js';
import {readRootOwnedJson} from '../buyer-writer/protected-json.js';
import {hash} from './commander-journal.js';

export const HELD_ACCEPTANCE_OPERATIONS=Object.freeze([
 'api_health','worker_readiness','generation_fence','six_live_reads','production_smoke',
 'zero_paid_nexus','zero_unintended_mutation','rollback_verification',
]);
export const HELD_ACCEPTANCE_CAPABILITIES=Object.freeze([
 'seller.opportunities.search','buyer.profiles.search','buyer.matches.search',
 'deal.records.search','deal.analysis.get','nexus.enrichment.status',
]);
const sessions=new WeakMap();
const activePermitSessions=new Map();
const PERMISSIONS=Object.freeze({
 'seller.opportunities.search':'seller.opportunities.read','buyer.profiles.search':'buyer.profiles.read',
 'buyer.matches.search':'buyer.matches.read','deal.records.search':'deal.records.read',
 'deal.analysis.get':'deal.analysis.read','nexus.enrichment.status':'nexus.enrichment.read',
});
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
function readActive(io,filename,{owner,gid}){
 let fd;
 try{
  fd=io.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);const before=io.fstatSync(fd);
  if(!before.isFile()||before.uid!==owner||before.gid!==gid||before.nlink!==1||(before.mode&0o7777)!==0o640||before.size<2||before.size>2048)reject();
  const value=JSON.parse(io.readFileSync(fd,'utf8')),after=io.fstatSync(fd);
  if(!['dev','ino','uid','gid','mode','nlink','size','mtimeMs','ctimeMs'].every(key=>before[key]===after[key]))reject();return value;
 }finally{if(fd!==undefined)io.closeSync(fd);}
}
function validateReads(reads,epochRunId,workspace){
 if(!Array.isArray(reads)||reads.length!==6)return false;
 const keys=new Set();
 return reads.every((row,index)=>exact(row,['index','idempotencyKey','capability','permission','request','requestDigest'])&&row.index===index
  &&row.idempotencyKey===`zola-six:${epochRunId}:${index}`&&!keys.has(row.idempotencyKey)
  &&(keys.add(row.idempotencyKey),row.capability===HELD_ACCEPTANCE_CAPABILITIES[index])
  &&row.permission===PERMISSIONS[row.capability]&&typeof row.request==='string'&&row.request.length>0&&row.request.length<=4000
  &&row.requestDigest===hash({channel:'jarvis',workspaceId:workspace,text:row.request,idempotencyKey:row.idempotencyKey,executionIntent:'read_only'}));
}
function validateClaims(value){
 if(!exact(value,['schema','kind','permitId','commanderRunId','mergeMainSha','expectedDeploymentSha','epochRunId','workspace','principal','apiGeneration','workerGeneration','issuedAt','expiresAt','operations','reads','tokenDigest'])
  ||value.schema!==1||value.kind!=='held-epoch-acceptance'||![value.permitId,value.commanderRunId,value.epochRunId].every(uuid)
  ||!sha(value.mergeMainSha)||value.expectedDeploymentSha!==value.mergeMainSha||typeof value.workspace!=='string'||!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(value.workspace)
  ||typeof value.principal!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(value.principal)
  ||![value.apiGeneration,value.workerGeneration].every(generation)||value.apiGeneration===value.workerGeneration
  ||!Number.isSafeInteger(value.issuedAt)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=value.issuedAt||value.expiresAt-value.issuedAt>15*60*1000
  ||JSON.stringify(value.operations)!==JSON.stringify(HELD_ACCEPTANCE_OPERATIONS)||!validateReads(value.reads,value.epochRunId,value.workspace)||!digest(value.tokenDigest))reject();
 return structuredClone(value);
}
function authorityRows(events){return events.filter(row=>String(row?.type??'').startsWith('held_acceptance_'));}
export function inspectHeldAcceptanceHistory(events){
 const rows=authorityRows(events);if(!rows.length)return Object.freeze({status:'ABSENT',claims:null});
 let claims,minted=false,consumeIntent=false,consumed=false,pending=null;const completed=[],evidenceDigests=[];
 for(const row of rows){
  if(row.type==='held_acceptance_mint_intent'){
   if(claims||!exact(row,['schema','type','claims','claimsDigest'])||row.schema!==1)reject();claims=validateClaims(row.claims);if(row.claimsDigest!==hash(claims))reject();
  }else if(row.type==='held_acceptance_minted'){
   if(!claims||minted||!exact(row,['schema','type','permitId','claimsDigest'])||row.schema!==1||row.permitId!==claims.permitId||row.claimsDigest!==hash(claims))reject();minted=true;
  }else if(row.type==='held_acceptance_consume_intent'){
   if(!minted||consumeIntent||!exact(row,['schema','type','permitId','claimsDigest'])||row.schema!==1||row.permitId!==claims.permitId||row.claimsDigest!==hash(claims))reject();consumeIntent=true;
  }else if(row.type==='held_acceptance_operation_intent'){
   const operation=HELD_ACCEPTANCE_OPERATIONS[completed.length];
   if(!consumeIntent||consumed||pending||!exact(row,['schema','type','permitId','claimsDigest','operation','attemptId'])||row.schema!==1
    ||row.permitId!==claims.permitId||row.claimsDigest!==hash(claims)||row.operation!==operation||!uuid(row.attemptId))reject();pending=row;
  }else if(row.type==='held_acceptance_operation_result'){
   if(!pending||!exact(row,['schema','type','permitId','claimsDigest','operation','attemptId','evidenceDigest','evidence'])||row.schema!==1
    ||row.permitId!==claims.permitId||row.claimsDigest!==hash(claims)||row.operation!==pending.operation||row.attemptId!==pending.attemptId
    ||!digest(row.evidenceDigest)||row.evidenceDigest!==hash(row.evidence)||JSON.stringify(row.evidence).length>4096)reject();
   completed.push(row.operation);evidenceDigests.push(row.evidenceDigest);pending=null;
  }else if(row.type==='held_acceptance_consumed'){
   if(!consumeIntent||consumed||pending||completed.length!==HELD_ACCEPTANCE_OPERATIONS.length
    ||!exact(row,['schema','type','permitId','claimsDigest','operationsDigest','acceptanceDigest'])||row.schema!==1||row.permitId!==claims.permitId
    ||row.claimsDigest!==hash(claims)||row.operationsDigest!==hash(HELD_ACCEPTANCE_OPERATIONS)
    ||row.acceptanceDigest!==hash({claimsDigest:hash(claims),operations:completed,evidenceDigests}))reject();consumed=true;
  }else reject();
 }
 return Object.freeze({status:consumed?'CONSUMED':consumeIntent?'CONSUMING':minted?'MINTED':'MINT_UNKNOWN',claims:Object.freeze(claims),
  completed:Object.freeze([...completed]),pending:pending?Object.freeze(structuredClone(pending)):null,
  evidenceDigests:Object.freeze([...evidenceDigests]),acceptanceDigest:consumed?hash({claimsDigest:hash(claims),operations:completed,evidenceDigests}):null});
}
export function mintHeldAcceptancePermit({commanderRunId,mergeMainSha,expectedDeploymentSha,epochRunId,workspace,principal,apiGeneration,workerGeneration,reads,journal,verifyGenerations,now=Date.now},
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
    ||!['commanderRunId','mergeMainSha','expectedDeploymentSha','epochRunId','workspace','principal','apiGeneration','workerGeneration'].every(key=>claims[key]===({commanderRunId,mergeMainSha,expectedDeploymentSha,epochRunId,workspace,principal,apiGeneration,workerGeneration})[key])
    ||JSON.stringify(claims.reads)!==JSON.stringify(reads)||state.apiGeneration!==apiGeneration||state.workerGeneration!==workerGeneration)reject();
   stream.append({schema:1,type:'held_acceptance_minted',permitId:claims.permitId,claimsDigest:hash(claims)});return Object.freeze({token:secret.token,claims:Object.freeze(claims)});
  }
  for(const name of ['acceptance.json','acceptance-secret.json',HELD_ACCEPTANCE_ACTIVE_FILE])try{io.lstatSync(path.join(root,name));reject();}catch(error){if(error.code!=='ENOENT')throw error;}
  const issuedAt=now(),token=randomBytes(32).toString('base64url');
  const claims=validateClaims({schema:1,kind:'held-epoch-acceptance',permitId:randomUUID(),commanderRunId,mergeMainSha,expectedDeploymentSha,epochRunId,workspace,principal,
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
  if(!['MINTED','CONSUMING'].includes(history.status))reject();lease=acquire({root,exclusive:true,owner,groupId});lease.assertIdentity();
  const claims=validateClaims(readAuthority()),secret=readSecret(),state=validateReleaseAdmissionState(readState());
  const supplied=Buffer.from(tokenDigest(token),'hex'),expected=Buffer.from(claims.tokenDigest,'hex');
  if(!exact(secret,['schema','permitId','token'])||secret.schema!==1||secret.permitId!==claims.permitId||secret.token!==token
   ||!timingSafeEqual(supplied,expected)||hash(claims)!==hash(history.claims)||now()>=claims.expiresAt||state.mode!=='held'||state.releaseSha!==claims.mergeMainSha
   ||state.runId!==claims.epochRunId||state.apiGeneration!==claims.apiGeneration||state.workerGeneration!==claims.workerGeneration)reject();
  if(JSON.stringify(verifyGenerations())!==JSON.stringify({apiGeneration:claims.apiGeneration,workerGeneration:claims.workerGeneration}))reject();
  if(activePermitSessions.has(claims.permitId))reject();
  if(history.status==='MINTED')stream.append({schema:1,type:'held_acceptance_consume_intent',permitId:claims.permitId,claimsDigest:hash(claims)});
  const session=Object.freeze({permitId:claims.permitId});sessions.set(session,{claims,root,owner,groupId,secretGroupId,io,acquire,readState,readAuthority,verifyGenerations,journal,now,resumed:history.status==='CONSUMING'});activePermitSessions.set(claims.permitId,session);return session;
 }catch{reject();}finally{lease?.close();}
}
function assertSession(state,bindings){
 if(!state||!exact(bindings,['mergeMainSha','expectedDeploymentSha','epochRunId','workspace','apiGeneration','workerGeneration'])
  ||!['mergeMainSha','expectedDeploymentSha','epochRunId','workspace','apiGeneration','workerGeneration'].every(key=>bindings[key]===state.claims[key])
  ||state.now()>=state.claims.expiresAt||JSON.stringify(state.verifyGenerations())!==JSON.stringify({apiGeneration:state.claims.apiGeneration,workerGeneration:state.claims.workerGeneration}))reject();
 const admission=validateReleaseAdmissionState(state.readState());
 if(admission.mode!=='held'||admission.releaseSha!==state.claims.mergeMainSha||admission.runId!==state.claims.epochRunId
  ||admission.apiGeneration!==state.claims.apiGeneration||admission.workerGeneration!==state.claims.workerGeneration)reject();
}
export function authorizeHeldAcceptanceOperation(session,operation,bindings){
 const state=sessions.get(session);let lease;try{
  assertSession(state,bindings);lease=state.acquire({root:state.root,exclusive:true,owner:state.owner,groupId:state.groupId});lease.assertIdentity();
  const history=inspectHeldAcceptanceHistory(state.journal.stream('release').events()),expected=HELD_ACCEPTANCE_OPERATIONS[history.completed.length];
  if(history.status!=='CONSUMING'||operation!==expected||history.pending&&!state.resumed)reject();
  const authorization=Object.freeze(history.pending?{permitId:history.pending.permitId,operation:history.pending.operation,attemptId:history.pending.attemptId,claimsDigest:history.pending.claimsDigest}
   :{permitId:state.claims.permitId,operation,attemptId:randomUUID(),claimsDigest:hash(state.claims)});
  if(!history.pending)state.journal.stream('release').append({schema:1,type:'held_acceptance_operation_intent',...authorization});
  if(operation==='six_live_reads'){
   const filename=path.join(state.root,HELD_ACCEPTANCE_ACTIVE_FILE),active={schema:1,kind:'held-acceptance-active',permitId:authorization.permitId,
    claimsDigest:authorization.claimsDigest,operation,attemptId:authorization.attemptId,expiresAt:state.claims.expiresAt};
   try{const retained=readActive(state.io,filename,{owner:state.owner,gid:state.groupId});if(JSON.stringify(retained)!==JSON.stringify(active))reject();}
   catch(error){if(error.code!=='ENOENT')throw error;atomic(state.io,filename,active,{mode:0o640,uid:state.owner,gid:state.groupId});}
  }
  return authorization;
 }catch{reject();}finally{lease?.close();}
}
export function completeHeldAcceptanceOperation(session,authorization,bindings,evidence){
 const state=sessions.get(session);let lease;try{
  assertSession(state,bindings);lease=state.acquire({root:state.root,exclusive:true,owner:state.owner,groupId:state.groupId});lease.assertIdentity();
  const history=inspectHeldAcceptanceHistory(state.journal.stream('release').events());
  if(history.status!=='CONSUMING'||!history.pending||!authorization||!['permitId','operation','attemptId','claimsDigest'].every(key=>authorization[key]===history.pending[key]))reject();
  const common=['schema','operation','permitId','attemptId','mergeMainSha','epochRunId','apiGeneration','workerGeneration','bindingDigest'];
  const operationKeys=authorization.operation==='six_live_reads'?['status','livePass','readCount','crossOwnerDenials','paidProviderCalls','mutationDelta','collectorDigest']
   :authorization.operation==='zero_paid_nexus'?['paidProviderCalls','usageDigest']
   :authorization.operation==='zero_unintended_mutation'?['mutationDelta','mutationDigest']:['status','observationDigest'];
  if(!exact(evidence,[...common,...operationKeys])||evidence.schema!==1||evidence.operation!==authorization.operation||evidence.permitId!==authorization.permitId
   ||evidence.attemptId!==authorization.attemptId||evidence.mergeMainSha!==state.claims.mergeMainSha||evidence.epochRunId!==state.claims.epochRunId
   ||evidence.apiGeneration!==state.claims.apiGeneration||evidence.workerGeneration!==state.claims.workerGeneration
   ||evidence.bindingDigest!==hash({permitId:authorization.permitId,attemptId:authorization.attemptId,operation:authorization.operation,mergeMainSha:state.claims.mergeMainSha,
    epochRunId:state.claims.epochRunId,apiGeneration:state.claims.apiGeneration,workerGeneration:state.claims.workerGeneration})||JSON.stringify(evidence).length>4096)reject();
  if(authorization.operation==='six_live_reads'&&(evidence.status!=='PASS_LIVE_ACCEPTANCE'||evidence.livePass!==true||evidence.readCount!==6||evidence.crossOwnerDenials!==6
   ||evidence.paidProviderCalls!==0||evidence.mutationDelta!==0||!digest(evidence.collectorDigest)))reject();
  if(['api_health','worker_readiness','generation_fence','production_smoke','rollback_verification'].includes(authorization.operation)&&(evidence.status!=='PASS'||!digest(evidence.observationDigest)))reject();
  if(authorization.operation==='zero_paid_nexus'&&(evidence.paidProviderCalls!==0||!digest(evidence.usageDigest)))reject();
  if(authorization.operation==='zero_unintended_mutation'&&(evidence.mutationDelta!==0||!digest(evidence.mutationDigest)))reject();
  if(authorization.operation==='six_live_reads'){
   const filename=path.join(state.root,HELD_ACCEPTANCE_ACTIVE_FILE);
   try{
    const retained=readActive(state.io,filename,{owner:state.owner,gid:state.groupId});
    if(retained.permitId!==authorization.permitId||retained.attemptId!==authorization.attemptId||retained.operation!==authorization.operation||retained.claimsDigest!==authorization.claimsDigest)reject();
    state.io.unlinkSync(filename);sync(state.io,state.root);
   }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  state.journal.stream('release').append({schema:1,type:'held_acceptance_operation_result',...authorization,evidenceDigest:hash(evidence),evidence:structuredClone(evidence)});
  return Object.freeze({permitId:authorization.permitId,operation:authorization.operation,evidenceDigest:hash(evidence)});
 }catch{reject();}finally{lease?.close();}
}
export function finishHeldAcceptancePermit(session){
 const state=sessions.get(session);let lease;try{
  if(!state)reject();const history=inspectHeldAcceptanceHistory(state.journal.stream('release').events());
  if(history.status!=='CONSUMING'||history.pending||history.completed.length!==HELD_ACCEPTANCE_OPERATIONS.length)reject();
  lease=state.acquire({root:state.root,exclusive:true,owner:state.owner,groupId:state.groupId});lease.assertIdentity();
  const admission=validateReleaseAdmissionState(state.readState());
  if(state.now()>=state.claims.expiresAt||admission.mode!=='held'||admission.releaseSha!==state.claims.mergeMainSha||admission.runId!==state.claims.epochRunId
   ||admission.apiGeneration!==state.claims.apiGeneration||admission.workerGeneration!==state.claims.workerGeneration
   ||JSON.stringify(state.verifyGenerations())!==JSON.stringify({apiGeneration:state.claims.apiGeneration,workerGeneration:state.claims.workerGeneration}))reject();
  const filename=path.join(state.root,'acceptance.json'),retained=validateClaims(state.readAuthority());if(hash(retained)!==hash(state.claims))reject();
  try{state.io.lstatSync(path.join(state.root,HELD_ACCEPTANCE_ACTIVE_FILE));reject();}catch(error){if(error.code!=='ENOENT')throw error;}
  for(const [name,mode,gid] of [['acceptance.json',0o640,state.groupId],['acceptance-secret.json',0o600,state.secretGroupId]]){
   const target=path.join(state.root,name),fd=state.io.openSync(target,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
   try{const stat=state.io.fstatSync(fd);if(!stat.isFile()||stat.uid!==state.owner||stat.gid!==gid||stat.nlink!==1||(stat.mode&0o7777)!==mode)reject();state.io.unlinkSync(target);sync(state.io,state.root);}finally{state.io.closeSync(fd);}
  }
  const acceptanceDigest=hash({claimsDigest:hash(state.claims),operations:history.completed,evidenceDigests:history.evidenceDigests});
  state.journal.stream('release').append({schema:1,type:'held_acceptance_consumed',permitId:state.claims.permitId,claimsDigest:hash(state.claims),operationsDigest:hash(HELD_ACCEPTANCE_OPERATIONS),acceptanceDigest});
  sessions.delete(session);activePermitSessions.delete(state.claims.permitId);return{status:'CONSUMED',permitId:state.claims.permitId,acceptanceDigest};
 }catch{reject();}finally{lease?.close();}
}
