import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {hash} from '../packages/zola-release/commander-journal.js';
import {validateFeaturePredecessor,validateFeatureAuthoritySnapshot,validateFeatureRollbackPredecessor,validateFeatureStoreRollbackPredecessor} from '../packages/zola-release/feature-release-preflight.js';
function fixture() {
 const state={mode:'open',releaseSha:'a'.repeat(40),runId:'run',apiGeneration:'api',workerGeneration:'worker'};
 const plan={releaseSha:state.releaseSha,runId:state.runId,configurationDigest:'config',environmentDigest:'env'};
 const result={version:1,status:'OUTAGE_RECOVERED',releaseSha:state.releaseSha,planDigest:hash(plan),stateDigest:hash(state)};
 return {plan,result,state,retainedState:structuredClone(state),configurationDigest:'config',environmentDigest:'env',writer:{bindingDigest:'binding',commitDigest:'commit'},bindingDigest:'binding',commitDigest:'commit'};
}
test('feature preflight recognizes the latest recovered OPEN predecessor',()=>assert.equal(validateFeaturePredecessor(fixture()),true));
test('feature preflight rejects earlier maintenance and changed configuration, environment or bindings',()=>{
 for(const mutate of [v=>v.result.status='PASSWORD_ACTIVATED',v=>v.configurationDigest='changed',v=>v.environmentDigest='changed',v=>v.bindingDigest='changed',v=>v.commitDigest='changed',v=>v.plan.releaseSha='b'.repeat(40)]) {
  const v=fixture();mutate(v);assert.throws(()=>validateFeaturePredecessor(v));
 }
});
test('feature preflight rejects changed generation, retained state and admission mode',()=>{
 for(const mutate of [v=>v.state.apiGeneration='new',v=>v.retainedState.workerGeneration='old',v=>v.state.mode='held',v=>v.result.stateDigest='changed']) {
  const v=fixture();mutate(v);assert.throws(()=>validateFeaturePredecessor(v));
 }
});
function authority() {
 const digest=createHash('sha256').update('content').digest('hex');
 const files=['client','signer','gateway','dropin','unit','manifest'].map(name=>({name,filename:name,newBytes:Buffer.from('content').toString('base64')}));
 const dependencies=['a','b','c','d'].map(filename=>({filename,digest}));
 return {bundle:{schema:1,binding:{newMainSha:'a'.repeat(40),artifactDigest:'artifact',epochRunId:'run'},files,dependencies},options:{releaseSha:'a'.repeat(40),artifactDigest:'artifact',runId:'run',readDigest:()=>digest}};
}
test('installed postmerge receipt verifies all current files and retained dependencies',()=>{
 const {bundle,options}=authority();assert.equal(validateFeatureAuthoritySnapshot(bundle,options),true);
});
test('authority receipt rejects modified bytes, incomplete files and mismatched release',()=>{
 for(const mutate of [v=>v.bundle.files[0].newBytes=Buffer.from('different').toString('base64'),v=>v.bundle.files.pop(),v=>v.bundle.binding.newMainSha='b'.repeat(40),v=>v.bundle.dependencies[0].digest='changed']) {
  const v=authority();mutate(v);assert.throws(()=>validateFeatureAuthoritySnapshot(v.bundle,v.options));
 }
});

function rollbackFixture(){
 const v=fixture(),old=structuredClone(v.state);
 v.state={...v.state,apiGeneration:'new-api',workerGeneration:'new-worker'};
 const plan={version:1,previousRecoveryResultDigest:hash(v.result),oldState:old,
  previousSha:old.releaseSha,previousRunId:old.runId,candidateSha:'c9d6b01099b69ff1c6a1a5693650f363540c8090',
  operationId:'op',rollbackAttemptId:'rollback'};
 const release=(step,phase)=>({schema:1,type:'feature_release',operationId:'op',step,phase});
 const events=['hold','stop','prepare','install','switchRelease'].flatMap(step=>[release(step,'intent'),release(step,'complete')]);
 events.push(release('start','intent'));
 for(const step of ['retire_commit','retire_binding','publish'])for(const phase of ['intent','complete'])
  events.push({schema:1,type:'feature_writer',attemptId:'rollback',step,phase});
 events.push(release('rollback','complete'));
 const rollback={plan,result:{version:1,status:'FEATURE_RELEASE_ROLLED_BACK',planDigest:hash(plan),stateDigest:hash(v.state),releaseSha:old.releaseSha},writer:v.writer,events};
 return {v,rollback};
}
test('verified feature rollback is an explicit fresh-generation predecessor',()=>{
 const {v,rollback}=rollbackFixture();assert.equal(validateFeatureRollbackPredecessor(v,rollback),true);
 assert.throws(()=>validateFeaturePredecessor(v));
});
test('rollback predecessor rejects altered history, identity, configuration and bindings',()=>{
 for(const mutate of [
  x=>x.rollback.events.pop(),x=>x.rollback.events[10].phase='complete',
  x=>x.rollback.plan.previousRecoveryResultDigest='changed',x=>x.rollback.result.planDigest='changed',
  x=>x.v.state.apiGeneration='api',x=>x.v.configurationDigest='changed',
  x=>x.v.commitDigest='changed',x=>x.rollback.result.status='FEATURE_RELEASE_ACTIVE',
  x=>x.v.retainedState.runId='changed'
 ]){const x=rollbackFixture();mutate(x);assert.throws(()=>validateFeatureRollbackPredecessor(x.v,x.rollback));}
});

function storeRollbackFixture(){
 const {v,rollback:prior}=rollbackFixture();
 const oldState=structuredClone(v.state);
 v.state={...v.state,apiGeneration:'third-api',workerGeneration:'third-worker'};
 const plan={version:1,previousRecoveryResultDigest:hash(v.result),previousRollbackResultDigest:hash(prior.result),oldState,
  previousSha:oldState.releaseSha,previousRunId:oldState.runId,candidateSha:'a8727fc798654f4380c4fb17c67d312f2c55ac5f',
  operationId:'op2',rollbackAttemptId:'rollback2'};
 const release=(step,phase)=>({schema:1,type:'feature_release',operationId:'op2',step,phase});
 const events=['hold','stop','prepare','install','switchRelease','start'].flatMap(step=>[release(step,'intent'),release(step,'complete')]);
 events.push(release('store','intent'));
 for(const step of ['retire_commit','retire_binding','publish'])for(const phase of ['intent','complete'])
  events.push({schema:1,type:'feature_writer',attemptId:'rollback2',step,phase});
 events.push(release('rollback','complete'));
 const rollback={plan,result:{version:1,status:'FEATURE_RELEASE_ROLLED_BACK',planDigest:hash(plan),stateDigest:hash(v.state),releaseSha:oldState.releaseSha},writer:v.writer,events};
 return {v,prior,rollback};
}
test('store rollback retains the verified first rollback lineage and current generations',()=>{
 const x=storeRollbackFixture();assert.equal(validateFeatureStoreRollbackPredecessor(x.v,x.prior,x.rollback),true);
});
test('store rollback refuses missing ancestry, drift and incomplete store-attempt history',()=>{
 for(const mutate of [
  x=>x.rollback.plan.previousRollbackResultDigest='changed',x=>x.prior.events.pop(),
  x=>x.rollback.events[12].phase='complete',x=>x.rollback.events.pop(),
  x=>x.v.state.apiGeneration='new-api',x=>x.v.bindingDigest='changed',
  x=>x.v.configurationDigest='changed',x=>x.rollback.plan.oldState.workerGeneration='changed'
 ]){const x=storeRollbackFixture();mutate(x);assert.throws(()=>validateFeatureStoreRollbackPredecessor(x.v,x.prior,x.rollback));}
});
