import test from 'node:test';
import assert from 'node:assert/strict';
import {ADMITTED_READ_RECOVERY as p,recoveryDigest as hash,readRecoveryJournal,classifyAdmittedReadRecovery} from '../packages/zola-release/admitted-read-recovery.js';
const snapshot=()=>({
 releaseDigest:p.releaseDigest,collectorDigest:p.collectorDigest,configDigest:p.configDigest,taskDigest:p.taskDigest,providerAttemptDigest:p.providerAttemptDigest,inputDigest:p.inputDigest,
 releaseSha:p.releaseSha,operationId:p.operationId,runId:p.runId,stageAttemptId:p.attemptId,stage:'six_reads',ordinal:13,admissionMode:'held',
 activePermit:false,collectorRunning:false,permitExpired:true,taskId:p.taskId,providerAttemptId:p.providerAttemptId,taskStatus:'outcome_unknown',
 providerAttemptStatus:'outcome_unknown',executionIntent:'read_only',capability:'seller.opportunities.search',provider:'blackspire-capability',
 taskCount:1,attemptCount:1,otherReadTasks:0,otherReadInputs:0,collectedCount:0,admittedCount:1,baselineComplete:true,denialConfirmed:true,
 oldOrigin:p.oldOrigin,newOrigin:p.newOrigin,newDeploymentId:p.newDeploymentId,newDeploymentVerified:true,retainedOldArchiveVerified:true
});
test('reconciliation never turns uncertainty into acceptance or authorizes a retry',()=>{
 const r=classifyAdmittedReadRecovery(snapshot());
 assert.equal(r.outcome,'UNKNOWN');assert.equal(r.automaticReplayAllowed,false);assert.equal(r.acceptancePassed,false);
 assert.equal(r.productionOpen,false);assert.equal(r.requiredTransition,'NEW_HELD_EPOCH_WITH_FRESH_ACCEPTANCE');
 assert.equal(Object.isFrozen(r),true);
 assert.equal(Object.hasOwn(r,'claims'),false);
});
for(const [field,value] of Object.entries({
 activePermit:true,collectorRunning:true,permitExpired:false,admissionMode:'open',otherReadTasks:1,otherReadInputs:1,
 attemptCount:2,taskCount:2,collectedCount:1,admittedCount:0,baselineComplete:false,denialConfirmed:false,
 taskStatus:'completed',providerAttemptStatus:'failed',executionIntent:'write',capability:'buyer.profiles.search',
 newDeploymentVerified:false,retainedOldArchiveVerified:false,newOrigin:p.oldOrigin,newDeploymentId:p.oldDeploymentId,
 runId:'00000000-0000-0000-0000-000000000000',stage:'six_live_reads',ordinal:14,
 taskDigest:'0'.repeat(64),providerAttemptDigest:'0'.repeat(64),releaseDigest:'0'.repeat(64),inputDigest:'0'.repeat(64)
})) test('refuses '+field+' drift',()=>assert.throws(()=>classifyAdmittedReadRecovery({...snapshot(),[field]:value}),/RECOVERY_REFUSED/));
function journal(events){
 let previous='0'.repeat(64);return Buffer.from(events.map((event,sequence)=>{
  const row={sequence,previous,event};const digest=hash(row);previous=digest;return JSON.stringify({...row,digest})+'\n';
 }).join(''));
}
test('verifies every envelope as well as exact retained bytes',()=>{
 const b=journal([{type:'intent'},{type:'retired',outcome:'UNKNOWN'}]);
 assert.equal(readRecoveryJournal(b,hash(b))[1].outcome,'UNKNOWN');
 const changed=Buffer.from(b.toString().replace('UNKNOWN','PASS'));
 assert.throws(()=>readRecoveryJournal(changed,hash(changed)));
});
test('rejects truncation even when caller supplies its matching raw digest',()=>{
 const b=journal([{type:'intent'}]).subarray(0,-1);assert.throws(()=>readRecoveryJournal(b,hash(b)));
});
test('rejects reordered, missing and duplicated rows even with matching raw digests',()=>{
 const lines=journal([{type:'intent'},{type:'retired'}]).toString().trimEnd().split('\n');
 for(const rows of [[lines[1],lines[0]],[lines[1]],[lines[0],lines[0]]]){
  const b=Buffer.from(rows.join('\n')+'\n');assert.throws(()=>readRecoveryJournal(b,hash(b)));
 }
});
