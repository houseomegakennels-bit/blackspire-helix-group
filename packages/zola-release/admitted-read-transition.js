import {randomUUID} from 'node:crypto';
import {ADMITTED_READ_RECOVERY as P,recoveryDigest as hash} from './admitted-read-recovery.js';

const fail=()=>{throw Error('ADMITTED_READ_TRANSITION_REFUSED');};
const exact=(v,k)=>v&&Object.keys(v).sort().join(',')===k.split(',').sort().join(',');
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const READ_RECOVERY_STEPS=Object.freeze([
 'stop_services','archive_permit','prepare_bindings','publish_held_epoch',
 'publish_receivers','publish_owned_store','reload_services','start_services',
 'publish_store_manifest','start_owned_store','prepare_writer_binding',
 'archive_writer_commit','archive_writer_binding','publish_writer_binding',
 'prepare_collector'
]);
export function validateReadRecoveryPlan(p){
 if(!exact(p,'version,kind,releaseSha,operationId,stageAttemptId,oldRunId,newRunId,oldDeploymentId,newDeploymentId,oldOrigin,newOrigin,inspectionDigest,snapshotDigest')
 ||p.version!==1||p.kind!=='admitted-read-held-transition'
 ||p.releaseSha!==P.releaseSha||p.operationId!==P.operationId||p.stageAttemptId!==P.attemptId||p.oldRunId!==P.runId
 ||!uuid(p.newRunId)||p.newRunId===p.oldRunId
 ||['oldDeploymentId','newDeploymentId','oldOrigin','newOrigin'].some(k=>p[k]!==P[k])
 ||!digest(p.inspectionDigest)||!digest(p.snapshotDigest))fail();
 return structuredClone(p);
}
export function prepareReadRecoveryPlan({inspection,snapshotDigest,newRunId=randomUUID()}){
 if(!inspection||inspection.status!=='ADMITTED_READ_RECONCILED_UNKNOWN'
 ||inspection.releaseSha!==P.releaseSha||inspection.operationId!==P.operationId||inspection.stageAttemptId!==P.attemptId
 ||inspection.runId!==P.runId||inspection.taskId!==P.taskId||inspection.providerAttemptId!==P.providerAttemptId
 ||inspection.outcome!=='UNKNOWN'||inspection.automaticReplayAllowed!==false||inspection.acceptancePassed!==false
 ||inspection.productionOpen!==false||inspection.requiredTransition!=='NEW_HELD_EPOCH_WITH_FRESH_ACCEPTANCE'
 ||inspection.oldDeploymentId!==P.oldDeploymentId||inspection.newDeploymentId!==P.newDeploymentId
 ||inspection.retainedEvidenceDigest!==hash({release:P.releaseDigest,collector:P.collectorDigest,task:P.taskDigest,attempt:P.providerAttemptDigest,input:P.inputDigest}))fail();
 return validateReadRecoveryPlan({version:1,kind:'admitted-read-held-transition',releaseSha:P.releaseSha,operationId:P.operationId,
 stageAttemptId:P.attemptId,oldRunId:P.runId,newRunId,oldDeploymentId:P.oldDeploymentId,newDeploymentId:P.newDeploymentId,
 oldOrigin:P.oldOrigin,newOrigin:P.newOrigin,inspectionDigest:hash(inspection),snapshotDigest});
}
export function inspectReadRecoveryTransition(plan,events){
 validateReadRecoveryPlan(plan);if(!Array.isArray(events)||events.length>2*READ_RECOVERY_STEPS.length+1)fail();
 let next=0,pending=null,completed=false;const proofs={};
 for(const e of events){
  if(completed||e?.version!==1||e.planDigest!==hash(plan))fail();
  if(e.type==='step_intent'){
   if(!exact(e,'version,type,planDigest,step')||pending||e.step!==READ_RECOVERY_STEPS[next])fail();
   pending=e.step;
  }else if(e.type==='step_result'){
   if(!exact(e,'version,type,planDigest,step,proofDigest,proof')||!pending||e.step!==pending
    ||e.proofDigest!==hash(e.proof)||!exact(e.proof,'step,planDigest,status,evidenceDigest')
    ||e.proof.step!==pending||e.proof.planDigest!==hash(plan)||e.proof.status!=='VERIFIED'||!digest(e.proof.evidenceDigest))fail();
   proofs[pending]=structuredClone(e.proof);pending=null;next++;
  }else if(e.type==='transition_result'){
   if(!exact(e,'version,type,planDigest,outcome,proofsDigest')||pending||next!==READ_RECOVERY_STEPS.length
    ||e.outcome!=='HELD_AWAITING_FRESH_ACCEPTANCE'||e.proofsDigest!==hash(proofs))fail();
   completed=true;
  }else fail();
 }
 return {next,pending,completed,proofs};
}
// A retained intent is observation-only on resume. The host never receives a
// second execution request for a step whose first outcome was uncertain.
export async function runReadRecoveryTransition(plan,{host,store}){
 validateReadRecoveryPlan(plan);
 if(!host||!store)fail();const release=await host.acquire(plan);
 try{
  await host.fence(plan);
  let state=inspectReadRecoveryTransition(plan,await store.events());
  for(let index=state.next;index<READ_RECOVERY_STEPS.length;index++){
   const step=READ_RECOVERY_STEPS[index];
   await host.fence(plan);
   if(!state.pending){
    await store.append({version:1,type:'step_intent',planDigest:hash(plan),step});
    // Verify durable intent before dispatch, including stores that acknowledge
    // an append without persisting its bytes.
    state=inspectReadRecoveryTransition(plan,await store.events());
    if(state.pending!==step||state.next!==index)fail();
    await host.execute(step,plan);
   }
   const proof=await host.observe(step,plan);
   const event={version:1,type:'step_result',planDigest:hash(plan),step,proofDigest:hash(proof),proof};
   inspectReadRecoveryTransition(plan,[...await store.events(),event]);
   await host.fence(plan);await store.append(event);
   state=inspectReadRecoveryTransition(plan,await store.events());
  }
  await host.verifyComplete(plan,state.proofs);
  if(!state.completed){
   await store.append({version:1,type:'transition_result',planDigest:hash(plan),outcome:'HELD_AWAITING_FRESH_ACCEPTANCE',proofsDigest:hash(state.proofs)});
   state=inspectReadRecoveryTransition(plan,await store.events());
  }
  if(!state.completed)fail();
  return {status:'HELD_AWAITING_FRESH_ACCEPTANCE',releaseSha:plan.releaseSha,runId:plan.newRunId,
   deploymentId:plan.newDeploymentId,planDigest:hash(plan),outcomeOfPriorRead:'UNKNOWN',acceptancePassed:false,productionOpen:false};
 }finally{await release.close();}
}
