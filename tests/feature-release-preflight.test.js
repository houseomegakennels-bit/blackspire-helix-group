import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {hash} from '../packages/zola-release/commander-journal.js';
import {validateFeaturePredecessor,validateFeatureAuthoritySnapshot} from '../packages/zola-release/feature-release-preflight.js';
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
