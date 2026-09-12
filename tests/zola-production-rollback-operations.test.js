import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../packages/zola-release/commander-journal.js';
import {RELEASE_STAGES,MUTATING_STAGES,runReleaseSequence} from '../packages/zola-release/commander-sequence.js';
import {createRollbackProductionOperations} from '../packages/zola-release/production-rollback-operations.js';

const input={releaseSha:'a'.repeat(40),previousMainSha:'b'.repeat(40),recoverySha:'2c0b600c268faa0571f08322e16d7f81f37789be',
 protectedInputDigest:'c'.repeat(64),workspace:'zola-production',principal:'blackspire-release-root'};
input.inputDigest=hash(input);
function journal(events=[]){return{stream:()=>({events:()=>structuredClone(events),append:value=>events.push(structuredClone(value))}),events};}
function context(j){return{input,release:{...input,backupManifestFile:'/protected/backup/manifest.json'},journal:j};}
function generic(stage,stopAt){
 const blocked=()=>({status:'BLOCKED_EXTERNAL'}),pass=()=>({status:'PASS',evidence:{accepted:true,stage}});
 const operation={check:stage===stopAt?blocked:pass,observe:pass};
 if(MUTATING_STAGES.has(stage))Object.assign(operation,{execute:async()=>{},reconcile:pass});
 return operation;
}
function adapters(rollback,stopAt){return Object.fromEntries(RELEASE_STAGES.map(stage=>[stage,rollback[stage]??generic(stage,stopAt)]));}
const acceptanceProof={status:'PASS',artifactDigest:'d'.repeat(64),backupManifestDigest:'e'.repeat(64),backupSnapshotDigest:'f'.repeat(64),
 backupProofDigest:'6'.repeat(64),runtimeProofDigest:'1'.repeat(64),apiRecoveryCompatible:true,workerRecoveryCompatible:true,admissionCompatible:true,runtimeCompatible:true,journalResumable:true};
const verificationProof={status:'PASS',artifactDigest:'d'.repeat(64),backupManifestDigest:'e'.repeat(64),backupSnapshotDigest:'f'.repeat(64),
 backupProofDigest:'6'.repeat(64),rollbackJournalDigest:'2'.repeat(64),previousStateDigest:'3'.repeat(64),apiGeneration:'4'.repeat(32),workerGeneration:'5'.repeat(32),
 previousPointerRecoverable:true,rollbackExecutable:true,noAttemptMixing:true,noStaleGeneration:true};
const checks={checkAcceptance:async()=>({status:'PASS',rollbackCandidatePresent:true,protectedBackupPresent:true}),
 checkVerification:async()=>({status:'PASS',rollbackArtifactRetained:true,cutoverJournalComplete:true,heldGenerationsCurrent:true})};

test('rollback acceptance journals one exact attempt and reconciliation does not repeat its recovery probe',async()=>{
 const j=journal();let probes=0,integrity=0;
 const rollback=createRollbackProductionOperations(context(j),{...checks,observeAcceptance:async()=>{probes++;return acceptanceProof;},
  observeAcceptanceIntegrity:async(_context,_binding,proof)=>{integrity++;assert.equal(proof.runtimeProofDigest,acceptanceProof.runtimeProofDigest);return{status:'PASS'};},
  observeVerification:async()=>verificationProof,observeVerificationIntegrity:async()=>({status:'PASS'})});
 const result=await runReleaseSequence({input,journal:j,adapters:adapters(rollback,'ci_security')});
 assert.equal(result.releaseState,'BLOCKED_EXTERNAL');assert.equal(result.stage,'ci_security');assert.equal(probes,1);assert.equal(integrity,1);
 const intent=j.events.find(row=>row.type==='rollback_acceptance_probe_intent'),finished=j.events.find(row=>row.type==='rollback_acceptance_probe_result');
 assert.match(intent.attemptId,/^[a-f0-9-]{36}$/);assert.equal(finished.attemptId,intent.attemptId);
 assert.equal(finished.binding.releaseSha,input.releaseSha);assert.equal(finished.binding.rollbackSha,input.recoverySha);
 assert.equal(finished.proof.operationId,j.events[0].operationId);assert.equal(finished.proof.observationDigest,hash((({status,observationDigest,...core})=>core)(finished.proof)));
 const resumed=await runReleaseSequence({input,journal:j,adapters:adapters(rollback,'ci_security')});
 assert.equal(resumed.stage,'ci_security');assert.equal(probes,1);
});

test('unavailable rollback proof stops truthfully as BLOCKED_EXTERNAL and remains observation-only on resume',async()=>{
 const j=journal();let probes=0;
 const rollback=createRollbackProductionOperations(context(j),{...checks,observeAcceptance:async()=>{probes++;return{status:'BLOCKED_EXTERNAL'};},
  observeAcceptanceIntegrity:async()=>{throw new Error('not reached');},observeVerification:async()=>verificationProof,
  observeVerificationIntegrity:async()=>({status:'PASS'})});
 let result=await runReleaseSequence({input,journal:j,adapters:adapters(rollback,'ci_security')});
 assert.equal(result.releaseState,'BLOCKED_EXTERNAL');assert.equal(result.stage,'rollback_acceptance');assert.equal(result.mutationSent,null);
 result=await runReleaseSequence({input,journal:j,adapters:adapters(rollback,'ci_security')});
 assert.equal(result.stage,'rollback_acceptance');assert.equal(probes,1);
});

test('rollback verification binds post-cutover proof to the same outer operation and exact stage attempt',async()=>{
 const j=journal();let verificationCalls=0;
 const rollback=createRollbackProductionOperations(context(j),{...checks,observeAcceptance:async()=>acceptanceProof,
  observeAcceptanceIntegrity:async()=>({status:'PASS'}),observeVerification:async(_context,binding,ids)=>{
   verificationCalls++;assert.equal(binding.rollbackSha,input.recoverySha);assert.match(ids.attemptId,/^[a-f0-9-]{36}$/);return verificationProof;
  },observeVerificationIntegrity:async(_context,_binding,proof)=>{assert.equal(proof.rollbackExecutable,true);return{status:'PASS'};}});
 const result=await runReleaseSequence({input,journal:j,adapters:adapters(rollback,'final_release_record')});
 assert.equal(result.releaseState,'BLOCKED_EXTERNAL');assert.equal(result.stage,'final_release_record');assert.equal(verificationCalls,1);
 const accepted=j.events.find(row=>row.type==='rollback_acceptance_probe_result'),verified=j.events.find(row=>row.type==='rollback_verification_probe_result');
 assert.equal(verified.proof.rollbackExecutable,true);assert.equal(verified.proof.noAttemptMixing,true);assert.equal(verified.proof.noStaleGeneration,true);
 assert.equal(verified.operationId,accepted.operationId);assert.notEqual(verified.attemptId,accepted.attemptId);
});

test('changed attempt, operation or proof bytes fail closed during rollback reconciliation',async()=>{
 for(const mutate of [
  rows=>{rows.find(row=>row.type==='rollback_acceptance_probe_result').attemptId='9'.repeat(8)+'-9999-4999-8999-'+'9'.repeat(12);},
  rows=>{rows.find(row=>row.type==='rollback_acceptance_probe_result').operationId='9'.repeat(8)+'-9999-4999-8999-'+'9'.repeat(12);},
  rows=>{rows.find(row=>row.type==='rollback_acceptance_probe_result').proof.artifactDigest='0'.repeat(64);},
 ]){
  const j=journal();const rollback=createRollbackProductionOperations(context(j),{...checks,observeAcceptance:async()=>acceptanceProof,
   observeAcceptanceIntegrity:async()=>({status:'PASS'}),observeVerification:async()=>verificationProof,observeVerificationIntegrity:async()=>({status:'PASS'})});
  await runReleaseSequence({input,journal:j,adapters:adapters(rollback,'ci_security')});mutate(j.events);
  // Remove the outer confirmation so resume is forced through the retained intent and subordinate proof.
  const index=j.events.findIndex(row=>row.type==='sequence_stage_confirmed'&&row.stage==='rollback_acceptance');j.events.splice(index,1);
  const result=await runReleaseSequence({input,journal:j,adapters:adapters(rollback,'ci_security')});
  assert.equal(result.releaseState,'FAIL_CLOSED');assert.equal(result.reason,'RELEASE_SEQUENCE_REJECTED');
 }
});
