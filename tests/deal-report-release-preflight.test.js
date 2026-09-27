import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../packages/zola-release/commander-journal.js';
import {FEATURE_STEPS} from '../packages/zola-release/feature-release.js';
import {validateDealReportPredecessor,DEAL_REPORT_PREDECESSOR_SHA} from '../packages/zola-release/deal-report-release-preflight.js';
function fixture() {
 const plan={version:1,operationId:'operation',candidateSha:DEAL_REPORT_PREDECESSOR_SHA,runId:'epoch',
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
test('accepts only the completed exact active feature predecessor',()=>assert.equal(validateDealReportPredecessor(fixture()),true));
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
 for(const mutate of mutations){const v=fixture();mutate(v);assert.throws(()=>validateDealReportPredecessor(v));}
});

