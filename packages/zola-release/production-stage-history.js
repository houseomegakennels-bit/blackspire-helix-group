import {isProductionAcceptanceIdentity} from './production-runtime-identity.js';
import {inspectReleaseSequenceHistory} from './commander-sequence.js';
import {inspectHeldAcceptanceHistory} from './held-acceptance-authority.js';
const reject=()=>{throw new Error('Production stage history rejected');};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
export function inspectCandidateSixReadsHistory(events){
 let intent=null,result=null;
 for(let index=0;index<events.length;index++){
  const row=events[index];if(!['candidate_six_reads_intent','candidate_six_reads_result'].includes(row?.type))continue;
  const isIntent=row.type==='candidate_six_reads_intent';
  if(!exact(row,['schema','type','attemptId','releaseSha',...(isIntent?[]:row.status==='PASS'?['status','reportDigest']:['status'])])||row.schema!==1)reject();
  const state=inspectReleaseSequenceHistory(events.slice(0,index));
  if(state.pending?.stage!=='candidate_six_reads'||row.attemptId!==state.pending.attemptId||row.releaseSha!==state.context.releaseSha)reject();
  if(isIntent){if(intent)reject();intent=row;}
  else{
   if(!intent||result||!['PASS','BLOCKED_EXTERNAL'].includes(row.status)||row.attemptId!==intent.attemptId)reject();
   if(row.status==='PASS'&&!/^[a-f0-9]{64}$/.test(row.reportDigest??''))reject();result=row;
  }
 }
 return {intent,result};
}
export function inspectSequencedHeldAcceptanceHistory(events){
 const observed=inspectHeldAcceptanceHistory(events);
 for(let index=0;index<events.length;index++){
  const row=events[index];if(!String(row?.type??'').startsWith('held_acceptance_'))continue;
  const stage=['held_acceptance_mint_intent','held_acceptance_minted'].includes(row.type)?'mint_acceptance_permit'
   :row.type==='held_acceptance_consume_intent'?'api_health':row.type==='held_acceptance_consumed'?'rollback_verification':row.operation;
  const state=inspectReleaseSequenceHistory(events.slice(0,index));
  if(state.pending?.stage!==stage||observed.claims.commanderRunId!==state.context.operationId
   ||observed.claims.mergeMainSha!==state.outputs.capture_new_main_sha?.newMainSha
   ||!isProductionAcceptanceIdentity(observed.claims))reject();
 }
 return observed;
}
