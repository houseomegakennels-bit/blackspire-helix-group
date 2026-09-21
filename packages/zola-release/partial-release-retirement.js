import {hash} from './commander-journal.js';
import {PARTIAL_RELEASE,validatePartialReleasePrefix,validatePartialRetirementEvent} from './partial-retirement-history.js';
import {partitionRetiredReleaseHistory} from './retired-release-history.js';
const fail=()=>{throw new Error('Partial release retirement refused; retain all state');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const exact=(v,keys)=>v&&Object.keys(v).sort().join(',')===keys.split(',').sort().join(',');
const sha=v=>/^[a-f0-9]{40}$/.test(v??'');
const uuid=v=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v??'');
export async function retirePartialRelease({successorReleaseSha,successorOperationId,journal},{host,store,uid=process.getuid()}={}){
 if(uid!==0||!sha(successorReleaseSha)||successorReleaseSha===PARTIAL_RELEASE.releaseSha||!uuid(successorOperationId)||successorOperationId===PARTIAL_RELEASE.operationId||!host||!store)fail();
 const input={successorReleaseSha,successorOperationId},stream=journal.stream('release');let lease;
 const running=async()=>{const before=await host.observeRunning(),record=stream.events().filter(e=>e.type==='release_lifecycle_result'&&e.releaseSha===PARTIAL_RELEASE.releaseSha).at(-1);
  const hold=stream.events().filter(e=>e.type==='release_hold_result'&&e.releaseSha===PARTIAL_RELEASE.releaseSha).at(-1);
  if(!record||!hold||record.runId!==PARTIAL_RELEASE.runId||!same(before.lifecycle,record.proof)||before.admissionStateDigest!==hold.stateDigest)fail();
  const {type:ignored,...marker}=hold;if(before.pendingMarkerDigest!==hash(marker))fail();return before;};
 const stable=()=>{validatePartialReleasePrefix(stream.events());if(hash(journal.stream('n8n').events())!==PARTIAL_RELEASE.n8nJournalDigest)fail();};
 try{
  const partition=partitionRetiredReleaseHistory(stream.events());
  if(partition.retired?.releaseSha===PARTIAL_RELEASE.releaseSha){
   if(partition.retired.successorReleaseSha!==successorReleaseSha||partition.retired.successorOperationId!==successorOperationId)fail();
   return {status:'PARTIAL_RELEASE_ALREADY_RETIRED',releaseSha:PARTIAL_RELEASE.releaseSha,successorReleaseSha,successorOperationId};
  }
  stable();await host.verifySuccessor(input);const lineage=await host.lineage(input);
  lease=await host.lease();
  let plan=store.read('plan');
  if(!plan){const before=await running();stable();
   plan={version:1,input,prefixDigest:PARTIAL_RELEASE.prefixDigest,n8nJournalDigest:PARTIAL_RELEASE.n8nJournalDigest,lineageDigest:lineage.lineageDigest,before};
   store.retain('plan',plan);
  }
  if(!exact(plan,'version,input,prefixDigest,n8nJournalDigest,lineageDigest,before')||plan.version!==1||!same(plan.input,input)||plan.prefixDigest!==PARTIAL_RELEASE.prefixDigest||plan.n8nJournalDigest!==PARTIAL_RELEASE.n8nJournalDigest||plan.lineageDigest!==lineage.lineageDigest)fail();
  const planDigest=hash(plan),wantedIntent={version:1,planDigest};
  let intent=store.read('stop-intent'),result=store.read('stop-result');
  if(result&&!intent)fail();
  if(!intent){
   if(!same(await running(),plan.before))fail();stable();lease.assertIdentity();
   store.retain('stop-intent',wantedIntent);intent=wantedIntent;
   // This is the only stop invocation. A retained intent never repeats it.
   await host.stop();
  }
  if(!same(intent,wantedIntent))fail();
  const stopped=await host.observeStopped(plan.before);lease.assertIdentity();stable();
  const wantedResult={version:1,planDigest,stopped};
  if(result&&!same(result,wantedResult))fail();
  if(!result){store.retain('stop-result',wantedResult);result=wantedResult;}
  await host.verifySuccessor(input);if(!same(await host.lineage(input),lineage))fail();
  if(!same(await host.observeStopped(plan.before),stopped))fail();stable();lease.assertIdentity();
  const proof={version:1,runId:PARTIAL_RELEASE.runId,currentSha:PARTIAL_RELEASE.releaseSha,hostStopped:true,bindingAbsent:true,retainedEffects:true,
   n8nJournalDigest:PARTIAL_RELEASE.n8nJournalDigest,stopPlanDigest:planDigest,stopResultDigest:hash(result),lineageDigest:lineage.lineageDigest};
  const event={schema:5,type:'sequence_retired',operationId:PARTIAL_RELEASE.operationId,releaseSha:PARTIAL_RELEASE.releaseSha,attemptId:PARTIAL_RELEASE.attemptId,
   ordinal:5,stage:'admission_lease',prefixDigest:PARTIAL_RELEASE.prefixDigest,segmentDigest:PARTIAL_RELEASE.segmentDigest,successorReleaseSha,successorOperationId,
   backendProfile:'owned-postgres-v1',profileDigest:PARTIAL_RELEASE.profileDigest,proof,proofDigest:hash(proof)};
  validatePartialRetirementEvent(event,stream.events());store.retain('retirement',event);stable();stream.append(event);
  return {status:'PARTIAL_RELEASE_RETIRED',releaseSha:PARTIAL_RELEASE.releaseSha,successorReleaseSha,successorOperationId,proofDigest:event.proofDigest,retainedEffects:true};
 }finally{lease?.close();}
}
