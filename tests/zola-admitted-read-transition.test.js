import test from 'node:test';
import assert from 'node:assert/strict';
import {ADMITTED_READ_RECOVERY as P,recoveryDigest as hash} from '../packages/zola-release/admitted-read-recovery.js';
import {prepareReadRecoveryPlan,inspectReadRecoveryTransition,runReadRecoveryTransition,READ_RECOVERY_STEPS} from '../packages/zola-release/admitted-read-transition.js';
const inspection={version:1,status:'ADMITTED_READ_RECONCILED_UNKNOWN',releaseSha:P.releaseSha,operationId:P.operationId,runId:P.runId,stageAttemptId:P.attemptId,taskId:P.taskId,providerAttemptId:P.providerAttemptId,retainedEvidenceDigest:hash({release:P.releaseDigest,collector:P.collectorDigest,task:P.taskDigest,attempt:P.providerAttemptDigest,input:P.inputDigest}),oldDeploymentId:P.oldDeploymentId,newDeploymentId:P.newDeploymentId,outcome:'UNKNOWN',automaticReplayAllowed:false,acceptancePassed:false,productionOpen:false,requiredTransition:'NEW_HELD_EPOCH_WITH_FRESH_ACCEPTANCE'};
const plan=()=>prepareReadRecoveryPlan({inspection,snapshotDigest:'a'.repeat(64),newRunId:'90a95d08-e9a4-4440-8251-477f0c319c27'});
function fixture({crashAfter=null,dropIntent=false}={}){
 const p=plan(),events=[],calls=[],effects=new Set();let crash=crashAfter,closed=0;
 const store={events:async()=>structuredClone(events),append:async e=>{if(!(dropIntent&&e.type==='step_intent'))events.push(structuredClone(e));}};
 const host={acquire:async()=>({close:async()=>closed++}),fence:async()=>{},
  execute:async step=>{calls.push(step);effects.add(step);if(crash===step){crash=null;throw Error('simulated lost response');}},
  observe:async step=>{if(!effects.has(step))throw Error('effect absent');return {step,planDigest:hash(p),status:'VERIFIED',evidenceDigest:hash(step)};},
  verifyComplete:async()=>{assert.equal(effects.size,READ_RECOVERY_STEPS.length);}};
 return {p,events,calls,effects,host,store,closed:()=>closed};
}
test('completed transition stays HELD and cannot attest acceptance',async()=>{
 const f=fixture(),r=await runReadRecoveryTransition(f.p,f);
 assert.equal(r.productionOpen,false);assert.equal(r.acceptancePassed,false);assert.equal(r.outcomeOfPriorRead,'UNKNOWN');
 assert.deepEqual(f.calls,[...READ_RECOVERY_STEPS]);assert.equal(f.closed(),1);
 await runReadRecoveryTransition(f.p,f);assert.equal(f.calls.length,READ_RECOVERY_STEPS.length);
});
for(const step of READ_RECOVERY_STEPS)test('lost response at '+step+' is observed without dispatching twice',async()=>{
 const f=fixture({crashAfter:step});await assert.rejects(runReadRecoveryTransition(f.p,f));
 assert.equal(inspectReadRecoveryTransition(f.p,f.events).pending,step);
 await runReadRecoveryTransition(f.p,f);
 assert.deepEqual(f.calls,[...READ_RECOVERY_STEPS]);assert.equal(f.closed(),2);
});
test('unpersisted intent cannot trigger execution',async()=>{
 const f=fixture({dropIntent:true});await assert.rejects(runReadRecoveryTransition(f.p,f));assert.deepEqual(f.calls,[]);
});
test('unknown effect that cannot be observed is never retried',async()=>{
 const f=fixture({crashAfter:'publish_receivers'});await assert.rejects(runReadRecoveryTransition(f.p,f));
 f.effects.delete('publish_receivers');const before=[...f.calls];
 await assert.rejects(runReadRecoveryTransition(f.p,f));assert.deepEqual(f.calls,before);
});
test('live fence failure aborts before mutation and releases lock',async()=>{
 const f=fixture();f.host.fence=async()=>{throw Error('changed binding');};
 await assert.rejects(runReadRecoveryTransition(f.p,f));assert.deepEqual(f.calls,[]);assert.equal(f.closed(),1);
});
test('old epoch or a claimed PASS cannot authorize fresh transition',()=>{
 assert.throws(()=>prepareReadRecoveryPlan({inspection,snapshotDigest:'a'.repeat(64),newRunId:P.runId}));
 assert.throws(()=>prepareReadRecoveryPlan({inspection:{...inspection,outcome:'PASS'},snapshotDigest:'a'.repeat(64)}));
});
test('tampered or reordered durable result stops before another step',async()=>{
 const f=fixture({crashAfter:'prepare_bindings'});await assert.rejects(runReadRecoveryTransition(f.p,f));
 const before=[...f.calls];f.events[1].proof.status='PASS';
 await assert.rejects(runReadRecoveryTransition(f.p,f));assert.deepEqual(f.calls,before);
});
