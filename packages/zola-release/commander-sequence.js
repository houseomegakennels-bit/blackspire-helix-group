import {randomUUID} from 'node:crypto';
import {hash} from './commander-journal.js';

export const RELEASE_STAGES=Object.freeze([
 'exact_sha_verification','receiver_audit','vercel_exact_head_preview','provider_acl_check','n8n_backup_check',
 'candidate_six_reads','admission_lease','generation_revalidation','n8n_migration','bounded_writer_e2e',
 'migration_preflight','production_migrations','migration_postconditions','six_reads','rollback_acceptance',
 'ci_security','final_diff','expected_head_merge','capture_new_main_sha','verify_main','verify_vercel_production_sha',
 'journaled_vps_cutover','post_merge_held_epoch','mint_acceptance_permit','api_health','worker_readiness',
 'generation_fence','six_live_reads','production_smoke','zero_paid_nexus','zero_unintended_mutation',
 'rollback_verification','final_release_record','guarded_held_to_open',
]);
const MUTATING_STAGE_NAMES=Object.freeze(['n8n_backup_check','candidate_six_reads','admission_lease','n8n_migration','bounded_writer_e2e',
 'production_migrations','six_reads','rollback_acceptance','expected_head_merge','journaled_vps_cutover',
 'post_merge_held_epoch','mint_acceptance_permit','api_health','worker_readiness','generation_fence','six_live_reads','production_smoke',
 'zero_paid_nexus','zero_unintended_mutation','rollback_verification','final_release_record','guarded_held_to_open']);
const MUTATING_STAGE_SET=new Set(MUTATING_STAGE_NAMES);
// Object.freeze(Set) does not freeze its entries. Expose only an immutable
// read facade so stage classification cannot drift after the registry digest
// has been computed.
export const MUTATING_STAGES=Object.freeze({
 size:MUTATING_STAGE_NAMES.length,
 has:value=>MUTATING_STAGE_SET.has(value),
 [Symbol.iterator]:function*(){yield* MUTATING_STAGE_NAMES;},
});
export const RELEASE_REGISTRY_DIGEST=hash(RELEASE_STAGES.map((stage,ordinal)=>({ordinal,stage,mutating:MUTATING_STAGES.has(stage)})));
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const reject=()=>{throw new Error('Release sequence rejected; retain journal and reconcile');};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');

export function inspectReleaseSequence(events){
 const rows=events.filter(row=>String(row?.type??'').startsWith('sequence_'));
 if(!rows.length)return Object.freeze({started:false,completed:false,nextOrdinal:0,pending:null,mutationState:false,context:null,outputs:Object.freeze({})});
 const validateStart=start=>{
  if(!exact(start,['schema','type','operationId','releaseSha','previousMainSha','recoverySha','protectedInputDigest','workspace','principal','inputDigest','registryDigest'])||start.schema!==4||start.type!=='sequence_started'
   ||!uuid(start.operationId)||![start.releaseSha,start.previousMainSha,start.recoverySha].every(sha)||!digest(start.protectedInputDigest)||!digest(start.inputDigest)
   ||!(/^[a-z][a-z0-9-]{2,63}$/).test(start.workspace)||!(/^[a-z][a-z0-9-]{2,63}$/).test(start.principal)||start.registryDigest!==RELEASE_REGISTRY_DIGEST)reject();
 };
 let start=rows[0];validateStart(start);
 let ordinal=0,pending=null,completed=false,newMainSha=null,outputs={},lastType='sequence_started';
 for(const row of rows.slice(1)){
  if(row.type==='sequence_started'){
   // A source-bugged release may be superseded only before any stage proof or
   // mutation intent. The retained failed segment remains auditable.
   if(ordinal!==0||pending||completed||lastType!=='sequence_stopped')reject();
   validateStart(row);start=row;outputs={};newMainSha=null;lastType=row.type;continue;
  }
  if(row.operationId!==start.operationId)reject();
  if(row.type==='sequence_stage_intent'){
   if(row.schema!==4||pending||ordinal>=RELEASE_STAGES.length||!MUTATING_STAGES.has(RELEASE_STAGES[ordinal])
    ||!exact(row,['schema','type','operationId','ordinal','stage','attemptId','inputDigest','checkOutputDigest'])||row.ordinal!==ordinal
    ||row.stage!==RELEASE_STAGES[ordinal]||!uuid(row.attemptId)||!digest(row.inputDigest)||!digest(row.checkOutputDigest)
    ||row.inputDigest!==hash({sequence:start.inputDigest,stage:row.stage,ordinal:row.ordinal,check:row.checkOutputDigest}))reject();
   pending=row;
  }else if(row.type==='sequence_stage_confirmed'){
   if(row.schema!==4||ordinal>=RELEASE_STAGES.length||!exact(row,['schema','type','operationId','ordinal','stage','attemptId','inputDigest','checkOutputDigest','outputDigest','output'])
    ||row.ordinal!==ordinal||row.stage!==RELEASE_STAGES[ordinal]||!digest(row.inputDigest)||!digest(row.checkOutputDigest)||!digest(row.outputDigest)
    ||row.inputDigest!==hash({sequence:start.inputDigest,stage:row.stage,ordinal:row.ordinal,check:row.checkOutputDigest}))reject();
   if(MUTATING_STAGES.has(row.stage)){
    if(!pending||row.attemptId!==pending.attemptId||row.inputDigest!==pending.inputDigest||row.checkOutputDigest!==pending.checkOutputDigest)reject();pending=null;
   }else if(row.attemptId!==null)reject();
   const bytes=JSON.stringify(row.output);if(!safeOutput(row.output)||bytes.length>4096||hash(bytes)!==row.outputDigest)reject();
   outputs[row.stage]=structuredClone(row.output);ordinal++;
  }else if(row.type==='sequence_stopped'){
   if(row.schema!==4||!exact(row,['schema','type','operationId','ordinal','stage','releaseState','reason'])
    ||row.ordinal!==ordinal||row.stage!==RELEASE_STAGES[ordinal]
    ||!['FAIL_CLOSED','BLOCKED_EXTERNAL'].includes(row.releaseState)
    ||typeof row.reason!=='string'||!(/^[A-Z][A-Z0-9_]{2,80}$/).test(row.reason))reject();
  }else if(row.type==='sequence_completed'){
   if(row.schema!==4||pending||ordinal!==RELEASE_STAGES.length||completed
    ||!exact(row,['schema','type','operationId','releaseSha','newMainSha','resultDigest'])
    ||row.releaseSha!==start.releaseSha||!sha(row.newMainSha)||!digest(row.resultDigest))reject();
   const captured=outputs.capture_new_main_sha,opened=outputs.guarded_held_to_open;
   if(captured?.newMainSha!==row.newMainSha||opened?.open!==true||opened?.newMainSha!==row.newMainSha
    ||row.resultDigest!==hash({inputDigest:start.inputDigest,newMainSha:row.newMainSha,stages:RELEASE_STAGES}))reject();
   completed=true;newMainSha=row.newMainSha;
  }else reject();
  lastType=row.type;
 }
 if(completed&&rows.at(-1).type!=='sequence_completed')reject();
 return Object.freeze({started:true,completed,nextOrdinal:ordinal,pending:pending?structuredClone(pending):null,mutationState:pending?null:rows.some(row=>row.type==='sequence_stage_intent'),
  context:Object.freeze({...structuredClone(start),newMainSha}),outputs:Object.freeze(outputs)});
}

function safeOutput(value,depth=0){
 if(depth>4||!value||typeof value!=='object'||Array.isArray(value))return false;
 return Object.entries(value).every(([key,item])=>!/secret|token|password|credential/i.test(key)&&key.length<=64&&(
  typeof item==='boolean'||Number.isSafeInteger(item)||typeof item==='string'&&item.length<=512||item&&typeof item==='object'&&!Array.isArray(item)&&safeOutput(item,depth+1)));
}
function proof(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.status!=='PASS'||!safeOutput(value.evidence))reject();
 const bytes=JSON.stringify(value.evidence);if(bytes.length>4096)reject();return{output:structuredClone(value.evidence),outputDigest:hash(bytes)};
}

// Every production adapter is fixed by the composition root. Caller-supplied
// booleans, commands and approvals are not accepted. A mutation intent is
// durable before dispatch; after any thrown/unknown result, only reconcile may
// confirm that same attempt. Completed stages never execute twice on resume.
export async function runReleaseSequence({input,journal,adapters}){
 const stream=journal.stream('release');let state,wasStarted=false,currentStage=null;
 const stopped=(releaseState,reason,stage=currentStage,mutationSent=state?.mutationState??null)=>{
  if(state?.started&&stage){
   stream.append({schema:4,type:'sequence_stopped',operationId:state.context.operationId,
    ordinal:state.nextOrdinal,stage,releaseState,reason});
  }
  return{status:'STOPPED',releaseState,reason,stage,mutationSent,
   reconciliationRequired:releaseState==='FAIL_CLOSED',resumeReady:true};
 };
 try{
  if(!exact(input,['releaseSha','previousMainSha','recoverySha','protectedInputDigest','workspace','principal','inputDigest'])||![input.releaseSha,input.previousMainSha,input.recoverySha].every(sha)
   ||!digest(input.protectedInputDigest)||!(/^[a-z][a-z0-9-]{2,63}$/).test(input.workspace)||!(/^[a-z][a-z0-9-]{2,63}$/).test(input.principal)
   ||input.inputDigest!==hash({releaseSha:input.releaseSha,previousMainSha:input.previousMainSha,recoverySha:input.recoverySha,protectedInputDigest:input.protectedInputDigest,workspace:input.workspace,principal:input.principal})||!adapters||typeof adapters!=='object'
   ||Object.keys(adapters).sort().join(',')!==[...RELEASE_STAGES].sort().join(','))reject();
  state=inspectReleaseSequence(stream.events());
  wasStarted=state.started;
  if(!state.started){
   const start={schema:4,type:'sequence_started',operationId:randomUUID(),...input,registryDigest:RELEASE_REGISTRY_DIGEST};stream.append(start);state=inspectReleaseSequence(stream.events());
  }else if(!['releaseSha','previousMainSha','recoverySha','protectedInputDigest','workspace','principal','inputDigest'].every(key=>state.context[key]===input[key])){
   const sequenceRows=stream.events().filter(row=>String(row?.type??'').startsWith('sequence_')),last=sequenceRows.at(-1);
   if(state.nextOrdinal!==0||state.pending||state.mutationState!==false||last?.type!=='sequence_stopped'
    ||last.operationId!==state.context.operationId||last.stage!=='exact_sha_verification'||last.reason!=='RELEASE_SEQUENCE_REJECTED')reject();
   const start={schema:4,type:'sequence_started',operationId:randomUUID(),...input,registryDigest:RELEASE_REGISTRY_DIGEST};stream.append(start);state=inspectReleaseSequence(stream.events());
  }
  if(state.completed)return{status:'COMPLETE',releaseState:'PASS',releaseSha:input.releaseSha,newMainSha:state.context.newMainSha,resumed:true};
  for(let ordinal=state.nextOrdinal;ordinal<RELEASE_STAGES.length;ordinal++){
   const stage=RELEASE_STAGES[ordinal],adapter=adapters[stage];currentStage=stage;
   if(!adapter||typeof adapter.check!=='function'||typeof adapter.observe!=='function'
    ||MUTATING_STAGES.has(stage)&&(typeof adapter.execute!=='function'||typeof adapter.reconcile!=='function'))reject();
   let attempt=state.pending;
   let checkedProof;
   if(!attempt){
    const checked=await adapter.check({input,state,ordinal});
    if(checked?.status==='BLOCKED_EXTERNAL')return stopped('BLOCKED_EXTERNAL','EXTERNAL_GATE',stage);
    checkedProof=proof(checked);
   }
   if(MUTATING_STAGES.has(stage)){
    if(!attempt){
     const inputDigest=hash({sequence:input.inputDigest,stage,ordinal,check:checkedProof.outputDigest}),attemptId=randomUUID();
     attempt={schema:4,type:'sequence_stage_intent',operationId:state.context.operationId,ordinal,stage,attemptId,inputDigest,checkOutputDigest:checkedProof.outputDigest};stream.append(attempt);
     state=inspectReleaseSequence(stream.events());
     try{await adapter.execute({input,state,ordinal,attemptId,inputDigest,checkOutputDigest:attempt.checkOutputDigest});}
     catch{return stopped('FAIL_CLOSED','MUTATION_OUTCOME_UNKNOWN',stage,null);}
    }
   }
   const inputDigest=attempt?.inputDigest??hash({sequence:input.inputDigest,stage,ordinal,check:checkedProof.outputDigest});
   const checkOutputDigest=attempt?.checkOutputDigest??checkedProof.outputDigest;
   const observed=await (attempt?adapter.reconcile:adapter.observe)({input,state,ordinal,attemptId:attempt?.attemptId??null,inputDigest,checkOutputDigest});
   if(observed?.status==='BLOCKED_EXTERNAL')return stopped('BLOCKED_EXTERNAL','EXTERNAL_GATE',stage,attempt?null:false);
   const observedProof=proof(observed);
   stream.append({schema:4,type:'sequence_stage_confirmed',operationId:state.context.operationId,ordinal,stage,
    attemptId:attempt?.attemptId??null,inputDigest,checkOutputDigest,...observedProof});
   state=inspectReleaseSequence(stream.events());
  }
  const newMainSha=state.outputs.capture_new_main_sha?.newMainSha;
  if(!sha(newMainSha)||state.outputs.guarded_held_to_open?.open!==true||state.outputs.guarded_held_to_open?.newMainSha!==newMainSha)reject();
  const resultDigest=hash({inputDigest:input.inputDigest,newMainSha,stages:RELEASE_STAGES});
  stream.append({schema:4,type:'sequence_completed',operationId:state.context.operationId,releaseSha:input.releaseSha,newMainSha,resultDigest});
  return{status:'COMPLETE',releaseState:'PASS',releaseSha:input.releaseSha,newMainSha,resumed:wasStarted};
 }catch{
  try{return stopped('FAIL_CLOSED','RELEASE_SEQUENCE_REJECTED');}
  catch{return{status:'STOPPED',releaseState:'FAIL_CLOSED',reason:'RELEASE_SEQUENCE_REJECTED',mutationSent:null,reconciliationRequired:true,resumeReady:true};}
 }
}
