
import {hash} from './commander-journal.js';
import {MIXED_RETIREMENT as P} from './mixed-retirement-history.js';
import {inspectReleaseSequenceHistory} from './commander-sequence.js';
export const MIXED_N8N_HISTORY=Object.freeze({count:24,digest:'60ccc4e067cb0f5d9883153804320c35b2cc67b0f5e90e28bea32dc97e75dfbb',workflowDigest:'2b5f190442f7805b7bf6db6fe58f2772ff97a1e33528040bfed1104b17a2cc8c',priorProofDigest:'c96ad3861869d83a74847b608e0d3648ad0b8945f7ceb2d860eab20d38117f20'});
const fail=()=>{throw Error('MIXED_N8N_CARRYOVER_REFUSED');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function createMixedN8nObservationJournal({journal,plan}){
 const raw=journal.stream('n8n'),validate=rows=>{
  const prefix=rows.slice(0,MIXED_N8N_HISTORY.count);
  if(prefix.length!==MIXED_N8N_HISTORY.count||hash(prefix)!==MIXED_N8N_HISTORY.digest
   ||plan.releaseSha!==P.successorReleaseSha)fail();
  const current=rows.slice(MIXED_N8N_HISTORY.count);
  for(const r of current)if(Object.keys(r).sort().join(',')!=='namespace,releaseSha,state,type'
   ||r.type!=='observation'||r.releaseSha!==P.successorReleaseSha||r.namespace!==plan.namespace
   ||r.state?.kind!=='CANDIDATE'||r.state.active!==true||r.state.definitionDigest!==plan.candidateDigest)fail();
  return structuredClone(current);
 };
 validate(raw.events());
 return {events:()=>validate(raw.events()),append:e=>{validate([...raw.events(),e]);raw.append(e);validate(raw.events());}};
}
// Carryover observes the existing published candidate and its retained cloud
// proof. It cannot deactivate, update, publish or rewrite a credential.
export function createMixedN8nCarryoverOperations(context,{observe,verifyInstalled}){
 if(context.release?.schema!==3||context.release.releaseSha!==P.successorReleaseSha
  ||context.release.operationId!==P.successorOperationId||hash(context.release)!==P.successorInputDigest)fail();
 const run=async(stage,call,attempt)=>{
  const state=inspectReleaseSequenceHistory(context.journal.stream('release').events());
  if(!same(call.input,context.input)||state.context?.operationId!==P.successorOperationId
   ||state.context.releaseSha!==P.successorReleaseSha||call.ordinal!==(stage==='n8n_backup_check'?3:8)
   ||call.state.context.operationId!==state.context.operationId
   ||attempt&&(state.pending?.stage!==stage||call.attemptId!==state.pending.attemptId
    ||call.inputDigest!==state.pending.inputDigest||call.checkOutputDigest!==state.pending.checkOutputDigest))fail();
  const before=hash(context.journal.stream('release').events());
  const checked=await observe();
  if(checked?.status!=='MIXED_N8N_CARRYOVER_VERIFIED'||checked.mutationSent!==false
   ||checked.workflowActive!==true||checked.workflowState!=='CANDIDATE'
   ||!['workflowDigest','priorProofDigest'].every(k=>checked[k]===MIXED_N8N_HISTORY[k]))fail();
  if(stage==='n8n_migration')await verifyInstalled();
  if(hash(context.journal.stream('release').events())!==before)fail();
  return {status:'PASS',evidence:{stage,releaseSha:P.successorReleaseSha,operationId:P.successorOperationId,
   workflowState:'CANDIDATE',workflowActive:true,workflowDigest:checked.workflowDigest,priorProofDigest:checked.priorProofDigest,
   publishedCandidateCarried:true,workflowMutationSent:false,...(stage==='n8n_migration'?{transitionConfirmed:true,installedWriterVerified:true}:{originalBackupRetained:true})}};
 };
 return Object.fromEntries(['n8n_backup_check','n8n_migration'].map(stage=>[stage,{
  check:call=>run(stage,call,false),execute:call=>run(stage,call,true),
  reconcile:call=>run(stage,call,true),observe:call=>run(stage,call,true),
 }]));
}
