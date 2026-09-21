import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {RELEASE_ADMISSION_ROOT,acquireReleaseAdmissionLock,requireReleaseAdmissionDirectory,validateReleaseAdmissionState,
 validatePremergeReadClaims,validatePremergeReadActive} from '../shared/release-admission.js';
import {readRootOwnedJson} from '../buyer-writer/protected-json.js';
import {inspectReleaseSequenceHistory} from './commander-sequence.js';
import {observeHeldLifecycle} from './held-lifecycle.js';
import {isProductionAcceptanceIdentity} from './production-runtime-identity.js';
import {readCases} from '../zola-six-reads/collector.js';
import {hash} from './commander-journal.js';

const reject=()=>{throw new Error('Premerge read permit rejected; retain evidence and do not replay');};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const names=['premerge-reads-secret.json','premerge-reads.json','premerge-reads-active.json'];
const types=['premerge_reads_intent','premerge_reads_active','premerge_reads_result','premerge_reads_retired'];
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function evidence(value){if(!exact(value,['readCount','crossOwnerDenials','paidProviderCalls','mutationDelta','collectorDigest'])
 ||value.readCount!==6||value.crossOwnerDenials!==6||value.paidProviderCalls!==0||value.mutationDelta!==0||!digest(value.collectorDigest))reject();return structuredClone(value);}
export function inspectPremergeReadHistory(events){
 let intent=null,active=false,result=null,retired=false;
 for(let index=0;index<events.length;index++){
  const row=events[index];if(!String(row?.type??'').startsWith('premerge_reads_'))continue;
  if(!types.includes(row.type)||row.schema!==1)reject();
  const state=inspectReleaseSequenceHistory(events.slice(0,index));
  if(state.pending?.stage!=='six_reads'||row.attemptId!==state.pending.attemptId)reject();
  if(row.type==='premerge_reads_intent'){
   if(intent||!exact(row,['schema','type','attemptId','inputDigest','checkOutputDigest','configDigest','claims','claimsDigest']))reject();
   const claims=validatePremergeReadClaims(row.claims);
   if(claims.commanderRunId!==state.context.operationId||claims.candidateSha!==state.context.releaseSha||!isProductionAcceptanceIdentity(claims)
    ||claims.epochRunId!==state.outputs.admission_lease?.epochRunId||row.claimsDigest!==hash(claims)||![row.inputDigest,row.checkOutputDigest,row.configDigest].every(digest)
    ||row.inputDigest!==state.pending.inputDigest||row.checkOutputDigest!==state.pending.checkOutputDigest)reject();intent=row;
  }else{
   if(!intent||retired||row.claimsDigest!==intent.claimsDigest)reject();
   const keys=['schema','type','attemptId','claimsDigest'];
   if(row.type==='premerge_reads_active'){if(active||result||!exact(row,keys))reject();active=true;}
   else if(row.type==='premerge_reads_result'){
    if(!active||result||!exact(row,[...keys,'evidence','evidenceDigest'])||row.evidenceDigest!==hash(evidence(row.evidence)))reject();result=row;
   }else{if(!exact(row,[...keys,'outcome'])||row.outcome!==(result?'PASS':'UNKNOWN'))reject();retired=true;}
  }
 }
 return{intent,active,result,retired};
}

export async function runPremergeReadPermit({context,call,config,collect},{root=RELEASE_ADMISSION_ROOT,io=fs,
 acquire=acquireReleaseAdmissionLock,observe=observeHeldLifecycle,now=Date.now,acl=spawnSync}={}){
 let lease,activated=false;
 const stream=context.journal.stream('release');
 const prior=inspectPremergeReadHistory(stream.events());
 const append=(type,claimsDigest,extra={})=>stream.append({schema:1,type,attemptId:call.attemptId,claimsDigest,...extra});
 const groupId=io.lstatSync(path.join(root,'state.json')).gid;
 const read=name=>readRootOwnedJson(path.join(root,name),{groupId,maxBytes:16384,io,aclTool:acl});
 const exists=name=>{try{io.lstatSync(path.join(root,name));return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
 function sync(){const fd=io.openSync(root,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{io.fsyncSync(fd);}finally{io.closeSync(fd);}}
 function publish(name,value,mode,gid){let fd;const file=path.join(root,name);
  try{fd=io.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
   const checked=()=>{const result=acl('/usr/bin/getfacl',['--numeric','--omit-header','--skip-base','--logical','--','/proc/self/fd/3'],{stdio:['ignore','pipe','pipe',fd],encoding:'utf8',timeout:1000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin'}});if(result.status!==0||result.error||result.stdout!==''||result.stderr!=='')reject();};
   checked();io.fchownSync(fd,0,gid);io.fchmodSync(fd,mode);checked();io.writeFileSync(fd,JSON.stringify(value)+'\n');io.fsyncSync(fd);
  }finally{if(fd!==undefined)io.closeSync(fd);}sync();
 }
 function retire(claims,claimsDigest,outcome){
  lease?.close();lease=acquire({root,exclusive:true,owner:0,groupId,allowPending:true});lease.assertIdentity();
  if(hash(validatePremergeReadClaims(read(names[1])))!==claimsDigest)reject();
  if(exists(names[2])){const active=validatePremergeReadActive(read(names[2]),claims);if(active.attemptId!==call.attemptId)reject();
   io.unlinkSync(path.join(root,names[2]));sync();}
  append('premerge_reads_retired',claimsDigest,{outcome});activated=false;
 }
 function bound(){const state=inspectReleaseSequenceHistory(stream.events());
  if(state.pending?.stage!=='six_reads'||state.pending.attemptId!==call.attemptId||state.context.operationId!==call.state.context.operationId
   ||state.context.releaseSha!==context.input.releaseSha||state.pending.inputDigest!==call.inputDigest||state.pending.checkOutputDigest!==call.checkOutputDigest
   ||config.version!==4||config.releaseSha!==context.input.releaseSha||!isProductionAcceptanceIdentity(config))reject();return state;
 }
 try{
  if(process.getuid()!==0||typeof collect!=='function')reject();bound();requireReleaseAdmissionDirectory(root,{io});
  if(prior.intent){
   if(prior.intent.configDigest!==hash(config)||prior.intent.attemptId!==call.attemptId)reject();
   if(prior.result){
    if(!prior.retired)retire(prior.intent.claims,prior.intent.claimsDigest,'PASS');
    else if(exists(names[2]))reject();
    return evidence(prior.result.evidence);
   }
   // Collection can already have sent admissions. Never repeat an unknown interval.
   reject();
  }
  lease=acquire({root,exclusive:true,owner:0,groupId});lease.assertIdentity();
  const state=validateReleaseAdmissionState(read('state.json'));
  if(state.mode!=='held'||state.releaseSha!==config.releaseSha||state.runId!==config.runId||state.apiGeneration!==null||state.workerGeneration!==null)reject();
  for(const name of names)if(exists(name))reject();
  const generation=await observe({releaseSha:config.releaseSha,runId:state.runId});
  if(hash(generation)!==hash(await observe({releaseSha:config.releaseSha,runId:state.runId})))reject();
  const token=randomBytes(32).toString('base64url'),issuedAt=now();
  const reads=readCases(config.dealId).map((row,index)=>{const idempotencyKey=`zola-six:${state.runId}:${index}`;
   return{index,idempotencyKey,capability:row.capability,permission:row.permissions[0],request:row.text,
    requestDigest:hash({channel:'jarvis',workspaceId:config.workspace,text:row.text,idempotencyKey,executionIntent:'read_only'})};});
  const claims=validatePremergeReadClaims({schema:1,kind:'held-premerge-reads',permitId:randomUUID(),commanderRunId:call.state.context.operationId,
   candidateSha:config.releaseSha,expectedDeploymentSha:config.releaseSha,epochRunId:state.runId,workspace:config.workspace,principal:config.principal,
   apiGeneration:generation.api.generation,workerGeneration:generation.worker.generation,issuedAt,expiresAt:issuedAt+900000,operations:['six_reads'],reads,tokenDigest:hash(token)});
  const claimsDigest=hash(claims);stream.append({schema:1,type:'premerge_reads_intent',attemptId:call.attemptId,inputDigest:call.inputDigest,
   checkOutputDigest:call.checkOutputDigest,configDigest:hash(config),claims,claimsDigest});
  publish(names[0],{schema:1,permitId:claims.permitId,token},0o600,0);publish(names[1],claims,0o640,groupId);
  publish(names[2],{schema:1,kind:'held-premerge-reads-active',permitId:claims.permitId,claimsDigest,operation:'six_reads',attemptId:call.attemptId,expiresAt:claims.expiresAt},0o640,groupId);
  activated=true;append('premerge_reads_active',claimsDigest);lease.assertIdentity();lease.close();lease=null;
  const result=evidence(await collect());append('premerge_reads_result',claimsDigest,{evidence:result,evidenceDigest:hash(result)});
  retire(claims,claimsDigest,'PASS');
  return result;
 }catch{

  // Best-effort exact retirement never opens public admission or deletes claims.
  if(activated){try{
   const history=inspectPremergeReadHistory(stream.events());
   if(!history.retired)retire(history.intent.claims,history.intent.claimsDigest,history.result?'PASS':'UNKNOWN');
  }catch{} }
  reject();
 }finally{lease?.close();}
}
