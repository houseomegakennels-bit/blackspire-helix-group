import {hash} from './commander-journal.js';
import {MIXED_RETIREMENT as P,validateMixedRetirementPrefix,validateMixedRetirementEvent,partitionMixedRetirement} from './mixed-retirement-history.js';
const fail=()=>{throw Error('MIXED_RELEASE_RETIREMENT_REFUSED');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.split(',').sort().join(',');
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function validateMixedRetirementSnapshot(before){
 if(!exact(before,'version,retainedEvidenceDigest,protectedStateDigest,lifecycleDigest,artifactDigest,bindingRetained,authorityInactive')
  ||before.version!==1||before.artifactDigest!==P.artifactDigest||before.retainedEvidenceDigest!==P.retainedEvidenceDigest||before.bindingRetained!==true||before.authorityInactive!==true
  ||!['protectedStateDigest','lifecycleDigest','artifactDigest'].every(k=>digest(before[k])))fail();
 return before;
}
export function validateMixedRetirementStopped(stopped,before){
 validateMixedRetirementSnapshot(before);
 if(!exact(stopped,'version,hostStopped,noDetachedSurvivors,bindingRetained,authorityInactive,currentSha,protectedStateDigest,artifactDigest,retainedEvidenceDigest')
  ||stopped.version!==1||stopped.currentSha!==P.releaseSha
  ||['hostStopped','noDetachedSurvivors','bindingRetained','authorityInactive'].some(k=>stopped[k]!==true)
  ||['protectedStateDigest','artifactDigest','retainedEvidenceDigest'].some(k=>stopped[k]!==before[k]))fail();
 return stopped;
}
// The caller owns the global release journal; this function additionally holds
// the admission exclusion lease throughout stop observation and final append.
export async function retireMixedReadRelease({successorOperationId,journal},{host,store,uid=process.getuid()}={}){
 if(uid!==0||!uuid(successorOperationId)||successorOperationId!==P.successorOperationId||!host||!store)fail();
 const input={successorReleaseSha:P.successorReleaseSha,successorOperationId},stream=journal.stream('release');let lease;
 const stable=()=>validateMixedRetirementPrefix(stream.events());
 try{
  const events=stream.events();
  if(events.length>P.eventCount){
   const r=partitionMixedRetirement(events).retired;
   if(r.successorOperationId!==successorOperationId)fail();
   return {status:'MIXED_RELEASE_ALREADY_RETIRED',...input,productionOpen:false};
  }
  stable();await host.verifySuccessor(input);lease=await host.lease();lease.assertIdentity();
  let plan=store.read('plan');
  if(!plan){const before=validateMixedRetirementSnapshot(await host.observeRunning());stable();lease.assertIdentity();
   plan={version:1,input,prefixDigest:P.prefixDigest,before};store.retain('plan',plan);}
  if(!exact(plan,'version,input,prefixDigest,before')||plan.version!==1||!same(plan.input,input)||plan.prefixDigest!==P.prefixDigest)fail();
  validateMixedRetirementSnapshot(plan.before);
  const planDigest=hash(plan),wantedIntent={version:1,planDigest};
  let intent=store.read('stop-intent'),result=store.read('stop-result');
  if(result&&!intent)fail();
  if(!intent){
   if(!same(await host.observeRunning(),plan.before))fail();
   stable();await host.verifySuccessor(input);lease.assertIdentity();
   store.retain('stop-intent',wantedIntent);intent=wantedIntent;
   await host.stop();
  }
  if(!same(intent,wantedIntent))fail();
  const stopped=validateMixedRetirementStopped(await host.observeStopped(plan.before),plan.before);
  stable();lease.assertIdentity();const wantedResult={version:1,planDigest,stopped};
  if(result&&!same(result,wantedResult))fail();
  if(!result){store.retain('stop-result',wantedResult);result=wantedResult;}
  await host.verifySuccessor(input);
  if(!same(await host.observeStopped(plan.before),stopped))fail();
  stable();lease.assertIdentity();
  const proof={version:1,runId:P.runId,currentSha:P.releaseSha,hostStopped:true,noDetachedSurvivors:true,
   authorityInactive:true,bindingRetained:true,retainedEffects:true,
   retainedEvidenceDigest:P.retainedEvidenceDigest,acceptanceDigest:P.acceptanceDigest,collectorDigest:P.collectorDigest,
   transitionDigest:P.transitionDigest,stopPlanDigest:planDigest,stopResultDigest:hash(result),
   protectedStateDigest:plan.before.protectedStateDigest,successorArtifactDigest:P.successorArtifactDigest,lineageDigest:P.lineageDigest};
  const event={schema:6,type:'sequence_retired',operationId:P.operationId,releaseSha:P.releaseSha,attemptId:P.attemptId,
   ordinal:13,stage:'six_reads',prefixDigest:P.prefixDigest,segmentDigest:P.segmentDigest,
   ...input,backendProfile:'owned-postgres-v1',profileDigest:P.profileDigest,proof,proofDigest:hash(proof)};
  validateMixedRetirementEvent(event);store.retain('retirement',event);stable();lease.assertIdentity();stream.append(event);
  return {status:'MIXED_RELEASE_RETIRED',...input,proofDigest:event.proofDigest,productionOpen:false};
 }finally{lease?.close();}
}
