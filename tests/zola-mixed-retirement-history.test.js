import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {hash} from '../packages/zola-release/commander-journal.js';
import {MIXED_RETIREMENT as P,validateMixedRetirementEvent,validateMixedRetirementPrefix,partitionMixedRetirement} from '../packages/zola-release/mixed-retirement-history.js';
import {partitionRetiredReleaseHistory,assertRetiredReleaseSuccessor} from '../packages/zola-release/retired-release-history.js';
function event(){
 const proof={version:1,runId:P.runId,currentSha:P.releaseSha,hostStopped:true,noDetachedSurvivors:true,
  authorityInactive:true,bindingRetained:true,retainedEffects:true,
  ...Object.fromEntries(['retainedEvidenceDigest','acceptanceDigest','collectorDigest','transitionDigest','successorArtifactDigest'].map(k=>[k,P[k]])),
  stopPlanDigest:'a'.repeat(64),stopResultDigest:'b'.repeat(64),protectedStateDigest:'c'.repeat(64)};
 return {schema:6,type:'sequence_retired',operationId:P.operationId,releaseSha:P.releaseSha,attemptId:P.attemptId,
  ordinal:13,stage:'six_reads',prefixDigest:P.prefixDigest,segmentDigest:P.segmentDigest,
  successorReleaseSha:P.successorReleaseSha,successorOperationId:'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
  backendProfile:'owned-postgres-v1',profileDigest:P.profileDigest,proof,proofDigest:hash(proof)};
}
test('mixed retirement binds exact predecessor, repaired artifact and unknown history',()=>{
 assert.equal(validateMixedRetirementEvent(event()),true);
 assert.equal(P.retainedEvidenceDigest,'3069c5440095c4d8e363758e367f8050fe6601570efd864ef68fb76ddd92b348');
});
test('every authority and evidence field fails closed, even with recomputed proof hash',()=>{
 const base=event();
 for(const key of Object.keys(base)){
  const e=structuredClone(base);delete e[key];assert.throws(()=>validateMixedRetirementEvent(e),key);
 }
 for(const key of Object.keys(base.proof)){
  const e=structuredClone(base);e.proof[key]=typeof e.proof[key]==='boolean'?false:'wrong';e.proofDigest=hash(e.proof);
  assert.throws(()=>validateMixedRetirementEvent(e),key);
 }
 for(const key of ['schema','ordinal','stage','releaseSha','operationId','attemptId','prefixDigest','segmentDigest','profileDigest','successorReleaseSha','backendProfile']){
  const e=event();e[key]='wrong';assert.throws(()=>validateMixedRetirementEvent(e),key);
 }
 for(const change of [e=>e.extra=true,e=>{e.proof.extra=true;e.proofDigest=hash(e.proof);},
  e=>e.successorOperationId=P.operationId,e=>e.successorOperationId='invalid',
  e=>e.proofDigest='d'.repeat(64)]){
  const e=event();change(e);assert.throws(()=>validateMixedRetirementEvent(e));
 }
});
test('a structurally valid retirement cannot authorize truncated, invented or previous history',()=>{
 const older=JSON.parse(fs.readFileSync(new URL('./fixtures/zola-release/retired-release-2636.json',import.meta.url)));
 for(const rows of [[],older,Array.from({length:P.eventCount},()=>({type:'invented'}))]){
  assert.throws(()=>validateMixedRetirementPrefix(rows));
  assert.throws(()=>partitionMixedRetirement([...rows,event()]));
  assert.throws(()=>assertRetiredReleaseSuccessor([...rows,event()],{releaseSha:P.successorReleaseSha}));
 }
});
test('existing retired history remains governed by its original validators',()=>{
 const rows=JSON.parse(fs.readFileSync(new URL('./fixtures/zola-release/retired-release-2636.json',import.meta.url)));
 assert.equal(partitionRetiredReleaseHistory(rows).retired.schema,4);
 const unretired=[{type:'unrelated'}];assert.deepEqual(partitionRetiredReleaseHistory(unretired).current,unretired);
});
