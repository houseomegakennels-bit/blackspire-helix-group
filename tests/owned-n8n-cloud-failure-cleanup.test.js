import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOwnedN8nCloudWorkflow,cloudProofDigest} from '../packages/zola-release/owned-n8n-cloud-workflow.js';
import {cleanupOwnedN8nCloudFailure,validateOwnedN8nCloudFailureCleanup} from '../packages/zola-release/owned-n8n-cloud-failure-cleanup.js';
function fixture(){
 const plan={version:1,kind:'owned-n8n-cloud-proof-plan',releaseSha:'a8e05ef40e44b6695df5b30356af0e411fe36f1a',operationId:'c8b00904-7017-434a-918e-8aaadbae82fd',stageAttemptId:'f163d812-3711-471b-863a-038e85d59137',operatorSha:'b'.repeat(40),credentialId:'RzOyDmXYmx58yZHi',challenge:'c'.repeat(64),receiptId:'11111111-1111-4111-8111-111111111111',origin:'https://jarvis.blackspirehelix.com',path:'/__zola_credential_proof/'+'c'.repeat(64),createdAt:'2026-09-21T20:00:00.000Z',expiresAt:'2026-09-21T20:15:00.000Z'};
 for(const k of ['authorityDigest','originalIntentDigest','reassertionIntentDigest','reassertionAckDigest','sourceDigest','profileDigest','ingressDigest','proxyBeforeDigest','proxyCandidateDigest'])plan[k]='d'.repeat(64);
 const workflow={id:'JjlvgzqIgFQSWOM7',versionId:'fixed-version',...buildOwnedN8nCloudWorkflow(plan),active:false};
 const created={version:1,planDigest:cloudProofDigest(plan),workflow};
 const adoption={version:1,kind:'owned-n8n-cloud-workflow-adoption',planDigest:cloudProofDigest(plan),originOperatorSha:plan.operatorSha,repairOperatorSha:'e'.repeat(40),workflowDigest:cloudProofDigest(workflow),workflowId:workflow.id,workflowVersionId:workflow.versionId,creationOutcome:'OBSERVED_EXISTING',postRepeated:false};
 const input={plan,created,adoption,executionId:'1',operatorSha:'f'.repeat(40)};
 const execution={id:'1',workflowId:workflow.id,workflowVersionId:workflow.versionId,mode:'manual',status:'error',finished:false,usedPrivateCredentials:false,startedAt:'2026-09-21T20:01:00Z',stoppedAt:'2026-09-21T20:01:01Z',workflowData:{nodes:[{parameters:{notice:'UI default'}}]},data:{resultData:{error:{message:'404'}}}};
 const records=new Map(),calls=[];let exists=true,unknownDelete=false,otherExecution=false;
 const store={value:n=>records.get(n)??null,record:(n,v)=>{if(records.has(n))assert.deepEqual(records.get(n),v);records.set(n,structuredClone(v));}};
 const request=async(method,path)=>{calls.push({method,path});if(method==='DELETE'){exists=false;if(unknownDelete)throw Error('lost acknowledgment');return{status:200};}assert.equal(method,'GET');
 if(path.includes('/executions?'))return{status:200,body:{data:otherExecution?[execution,{id:'2',status:'running'}]:[execution]}};
 if(path.includes('/executions/'))return{status:200,body:structuredClone(execution)};
 return exists?{status:200,body:structuredClone(workflow)}:{status:404};};
 return{input,execution,workflow,records,calls,store,request,fence:async()=>{},closure:async()=>{},loseDelete:()=>{unknownDelete=true;},addExecution:()=>{otherExecution=true;}};
}
test('exact inactive failed diagnostic deleted once; failure evidence never becomes positive proof',async()=>{
 const f=fixture(),r=await cleanupOwnedN8nCloudFailure(f.input,f);
 assert.equal(r.workflowDeleted,true);assert.equal(r.positiveProof,false);assert.equal(r.executionGraphAcceptance,'UNVERIFIED');assert.equal(r.originalOutcome,'UNKNOWN');
 assert.equal(f.records.has('workflow-proof'),false);assert.equal(f.records.has('failure-execution-observed'),true);
 assert.deepEqual(f.calls.filter(c=>c.method!=='GET').map(c=>c.method),['DELETE']);
});
test('uncertain delete adopts only absence without another DELETE',async()=>{
 const f=fixture();f.loseDelete();await assert.rejects(cleanupOwnedN8nCloudFailure(f.input,f));
 assert.equal((await cleanupOwnedN8nCloudFailure(f.input,f)).workflowDeleted,true);
 assert.equal(f.calls.filter(c=>c.method==='DELETE').length,1);
});
test('changed current graph, other execution, success or positive receipt refuses before delete',async()=>{
 for(const change of [
  f=>{f.workflow.nodes[1].parameters.method='POST';},
  f=>{f.addExecution();},
  f=>{f.execution.status='success';f.execution.finished=true;},
  f=>{f.records.set('server-receipt',{authenticated:true});},
  f=>{f.execution.workflowVersionId='wrong';},
  f=>{f.input.adoption.postRepeated=true;},
 ]){
  const f=fixture();change(f);await assert.rejects(cleanupOwnedN8nCloudFailure(f.input,f));assert.equal(f.calls.filter(c=>c.method==='DELETE').length,0);
 }
});
test('pending cleanup with still existing workflow never redispatches DELETE',async()=>{
 const f=fixture();const request=f.request;f.request=async(method,path)=>{if(method==='DELETE')throw Error('unknown before effect');return request(method,path);};
 await assert.rejects(cleanupOwnedN8nCloudFailure(f.input,f));let writes=0;
 f.request=async(method,path)=>{if(method!=='GET')writes++;return request(method,path);};
 await assert.rejects(cleanupOwnedN8nCloudFailure(f.input,f));assert.equal(writes,0);
});

test('pure predecessor cleanup validation rejects forged success or wrong evidence',async()=>{
 const f=fixture();await cleanupOwnedN8nCloudFailure(f.input,f);const proof={observation:f.records.get('failure-execution-observed'),intent:f.records.get('failure-cleanup-intent'),result:f.records.get('failure-cleanup-result')};
 assert.deepEqual(validateOwnedN8nCloudFailureCleanup(f.input,proof),proof.result);
 assert.throws(()=>validateOwnedN8nCloudFailureCleanup(f.input,{...proof,result:{...proof.result,positiveProof:true}}));
 assert.throws(()=>validateOwnedN8nCloudFailureCleanup(f.input,{...proof,observation:{...proof.observation,id:'2'}}));
});
