import {PARTIAL_RELEASE} from './partial-retirement-history.js';
import {hash} from './commander-journal.js';
import {BLOCKED_RELEASE,partitionRetiredReleaseHistory,assertRetiredReleaseSuccessor} from './retired-release-history.js';
import {inspectReleaseSequenceHistory} from './commander-sequence.js';
import {ownedReleaseOperationId} from './owned-release-input-preparation.js';
const fail=()=>{throw new Error('Owned n8n retired observation boundary rejected');};
const keys=v=>Object.keys(v??{}).sort().join(',');
// This view retains every physical hashchain row. Only the exact six already
// retired GET observations are outside the successor transition's logical view.
export function createOwnedN8nRetiredJournalView({journal,release,plan}){
 const raw=journal.stream('n8n'),operationId=ownedReleaseOperationId(release);
 if(!operationId||release.releaseSha!==plan.releaseSha)fail();
 const validate=rows=>{
  const all=journal.stream('release').events(),partition=partitionRetiredReleaseHistory(all);
  assertRetiredReleaseSuccessor(all,release);const state=inspectReleaseSequenceHistory(all);
  const boundary=partition.retired?.schema===5?PARTIAL_RELEASE:BLOCKED_RELEASE,count=partition.retired?.schema===5?PARTIAL_RELEASE.n8nEventCount:6;
  if(!partition.retired||partition.retired.proof.n8nJournalDigest!==boundary.n8nJournalDigest
   ||state.started&&(state.context.releaseSha!==release.releaseSha||state.context.operationId!==operationId))fail();
  const prefix=rows.slice(0,count);
  if(prefix.length!==count||hash(prefix)!==boundary.n8nJournalDigest||prefix.some(e=>keys(e)!=='namespace,releaseSha,state,type'||e.type!=='observation'
   ||keys(e.state)!=='active,definitionDigest,kind,versionId'||e.state.kind!=='BASELINE'||e.state.active!==true
   ||e.state.definitionDigest!==plan.baselineDigest||e.state.versionId!==plan.baselineVersion))fail();
  const current=rows.slice(count),attempts=partition.current.filter(e=>e.type==='sequence_stage_intent'&&e.stage==='n8n_migration');
  if(attempts.length>1)fail();const attempt=attempts[0];
  for(const row of current){
   if(row.namespace!==plan.namespace||row.releaseSha!==release.releaseSha)fail();
   if(row.type==='observation'){if(keys(row)!=='namespace,releaseSha,state,type')fail();continue;}
   if(!attempt||row.operationId!==operationId||row.stageAttemptId!==attempt.attemptId||!['deactivate','update','publish','rollback'].includes(row.operation))fail();
   const base=['namespace','releaseSha','type','operation','operationId','stageAttemptId'];
   const extra=row.type==='intent'?['before','target']:row.type==='response'?['acknowledged']:row.type==='unknown'?[]:row.type==='confirmed'?['state',...(Object.hasOwn(row,'reconciled')?['reconciled']:[])]:null;
   if(!extra||keys(row)!==[...base,...extra].sort().join(',')||Object.hasOwn(row,'reconciled')&&row.reconciled!==true)fail();
  }
  return structuredClone(current);
 };
 const stream=Object.freeze({events:()=>validate(raw.events()),append:event=>{
  const before=raw.events();validate([...before,event]);raw.append(event);validate(raw.events());
 }});
 validate(raw.events());
 return Object.freeze({stream:name=>name==='n8n'?stream:journal.stream(name)});
}
