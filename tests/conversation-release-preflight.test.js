import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../packages/zola-release/commander-journal.js';
import {FEATURE_STEPS} from '../packages/zola-release/feature-release.js';
import {validateConversationPredecessor,validateUnstartedConversationAttempt,CONVERSATION_PREDECESSOR_SHA} from '../packages/zola-release/conversation-release-preflight.js';
function fixture() {
 const plan={version:1,operationId:'operation',candidateSha:CONVERSATION_PREDECESSOR_SHA,runId:'epoch',
 configurationDigest:'config',runtimeDigest:'runtime',apiEnvironmentDigest:'api'};
 const state={version:1,mode:'open',releaseSha:plan.candidateSha,runId:plan.runId,apiGeneration:'api-generation',workerGeneration:'worker-generation'};
 const result={version:1,status:'FEATURE_RELEASE_ACTIVE',releaseSha:plan.candidateSha,planDigest:hash(plan),stateDigest:hash(state)};
 const events=[];
 for(const step of FEATURE_STEPS){
  events.push({schema:1,type:'feature_release',operationId:plan.operationId,step,phase:'intent'});
  if(step==='writer')for(const item of ['retire_commit','retire_binding','publish'])for(const phase of ['intent','complete'])
   events.push({schema:1,type:'feature_writer',attemptId:plan.operationId,step:item,phase});
  events.push({schema:1,type:'feature_release',operationId:plan.operationId,step,phase:'complete'});
 }
 return {plan,result,state,retainedState:structuredClone(state),configurationDigest:'config',runtimeDigest:'runtime',environmentDigest:'api',
 writer:{bindingDigest:'binding',commitDigest:'commit'},bindingDigest:'binding',commitDigest:'commit',events};
}
test('accepts only the completed exact active feature predecessor',()=>assert.equal(validateConversationPredecessor(fixture()),true));
test('rejects altered receipts, generation, config, bindings and unfinished or reordered journal',()=>{
 const mutations=[
 v=>{v.result.status='FEATURE_RELEASE_ROLLED_BACK';},
 v=>{v.plan.candidateSha='a'.repeat(40);v.result.planDigest=hash(v.plan);},
 v=>{v.state.apiGeneration='other';},
 v=>{v.retainedState.workerGeneration='other';},
 v=>{v.configurationDigest='changed';},
 v=>{v.runtimeDigest='changed';},
 v=>{v.environmentDigest='changed';},
 v=>{v.bindingDigest='changed';},
 v=>{v.commitDigest='changed';},
 v=>{v.events.pop();},
 v=>{v.events.reverse();},
 v=>{v.events[0].operationId='other';},
 ];
 for(const mutate of mutations){const v=fixture();mutate(v);assert.throws(()=>validateConversationPredecessor(v));}
});

test('unstarted retry accepts only one retained hold intent and unchanged protected state/config',()=>{
 const state={mode:'open',releaseSha:CONVERSATION_PREDECESSOR_SHA,runId:'old'};
 const plan={version:1,candidateSha:'a'.repeat(40),previousSha:CONVERSATION_PREDECESSOR_SHA,oldState:state,operationId:'intent',apiEnvironmentDigest:'api'};
 const v={plan,state,candidateSha:plan.candidateSha,events:[{schema:1,type:'feature_release',operationId:'intent',step:'hold',phase:'intent'}],
 configurationDigest:'config',backupConfigurationDigest:'config',runtimeDigest:'runtime',backupRuntimeDigest:'runtime',environmentDigest:'api'};
 assert.equal(validateUnstartedConversationAttempt(v),true);
 for(const mutate of [x=>x.events.push({...x.events[0],phase:'complete'}),x=>{x.state.mode='held';},x=>{x.configurationDigest='changed';},x=>{x.runtimeDigest='changed';},x=>{x.environmentDigest='changed';},x=>{x.candidateSha='b'.repeat(40);}]){
  const copy=structuredClone(v);mutate(copy);assert.throws(()=>validateUnstartedConversationAttempt(copy));
 }
});
