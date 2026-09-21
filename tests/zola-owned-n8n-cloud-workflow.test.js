import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOwnedN8nCloudWorkflow,cloudProofDigest,prepareOwnedN8nCloudWorkflow,completeOwnedN8nCloudWorkflow,validateOwnedN8nCloudExecution,validateOwnedN8nCloudWorkflowProof} from '../packages/zola-release/owned-n8n-cloud-workflow.js';
const copy=v=>structuredClone(v);
function fixture(){
 const plan={version:1,kind:'owned-n8n-cloud-proof-plan',releaseSha:'a8e05ef40e44b6695df5b30356af0e411fe36f1a',operationId:'c8b00904-7017-434a-918e-8aaadbae82fd',stageAttemptId:'f163d812-3711-471b-863a-038e85d59137',operatorSha:'b'.repeat(40),credentialId:'RzOyDmXYmx58yZHi',challenge:'c'.repeat(64),receiptId:'11111111-1111-4111-8111-111111111111',origin:'https://jarvis.blackspirehelix.com',path:'/__zola_credential_proof/'+'c'.repeat(64),createdAt:'2026-09-21T20:00:00.000Z',expiresAt:'2026-09-21T20:15:00.000Z'};
 for(const k of ['authorityDigest','originalIntentDigest','reassertionIntentDigest','reassertionAckDigest','sourceDigest','profileDigest','ingressDigest','proxyBeforeDigest','proxyCandidateDigest'])plan[k]='d'.repeat(64);
 const workflow={id:'ProofWorkflow',versionId:'proof-version-1',...buildOwnedN8nCloudWorkflow(plan),active:false};
 const serverReceipt={version:1,kind:'owned-n8n-cloud-authenticated',planDigest:cloudProofDigest(plan),challenge:plan.challenge,receiptId:plan.receiptId,receivedAt:'2026-09-21T20:01:01.000Z',authenticated:true};
 const response={version:1,status:'CREDENTIAL_POSSESSION_VERIFIED',challenge:plan.challenge,receiptId:plan.receiptId};
 const row=data=>({startTime:Date.parse('2026-09-21T20:01:00.000Z'),executionTime:2000,executionStatus:'success',data:{main:[[{json:data}]]}});
 const execution={id:'Execution1',workflowId:workflow.id,mode:'manual',usedPrivateCredentials:false,status:'success',finished:true,startedAt:'2026-09-21T20:01:00.000Z',stoppedAt:'2026-09-21T20:01:02.000Z',workflowVersionId:workflow.versionId,workflowData:copy(workflow),data:{resultData:{lastNodeExecuted:'Verify stored credential',runData:{'Manual Trigger':[row({})],'Verify stored credential':[row(response)]}}}};
 const records=new Map(),calls=[];let exists=false,unknownCreate=false,unknownDelete=false;
 const store={value:n=>records.has(n)?copy(records.get(n)):null,record:(n,v)=>{if(records.has(n))assert.deepEqual(records.get(n),v);records.set(n,copy(v));}};
 const request=async(method,path,body)=>{calls.push({method,path,body});
  if(method==='POST'){exists=true;if(unknownCreate)throw Error('lost create');return{status:200,body:copy(workflow)};}
  if(method==='DELETE'){exists=false;if(unknownDelete)throw Error('lost delete');return{status:200,body:{}};}
  if(path.startsWith('/api/v1/executions/'))return{status:200,body:copy(execution)};
  return exists?{status:200,body:copy(workflow)}:{status:404,body:{}};
 };
 return {plan,workflow,execution,serverReceipt,records,calls,store,request,fence:async()=>{},now:()=>Date.parse(plan.createdAt)+1000,setUnknownCreate:()=>{unknownCreate=true;},setUnknownDelete:()=>{unknownDelete=true;}};
}
test('minimal graph references stored credential and exact GET endpoint without secret, retry or redirect',()=>{
 const f=fixture(),w=buildOwnedN8nCloudWorkflow(f.plan);assert.equal(w.nodes.length,2);assert.deepEqual(w.nodes[1].credentials,{httpHeaderAuth:{id:f.plan.credentialId,name:'ZOLA Buyer writer'}});assert.equal(w.nodes[1].parameters.method,'GET');assert.equal(w.nodes[1].retryOnFail,false);assert.equal(w.nodes[1].parameters.options.redirect.redirect.followRedirects,false);assert.equal(JSON.stringify(w).includes('writerCredential'),false);
 for(const patch of [{origin:'https://foreign.example'},{path:'/wrong'},{credentialId:'foreign'},{stageAttemptId:'different'},{expiresAt:'2026-09-21T21:00:00Z'}])assert.throws(()=>buildOwnedN8nCloudWorkflow({...f.plan,...patch}));
});
test('prepare then explicit execution proof and exact workflow cleanup produce distinct possession receipt',async()=>{
 const f=fixture();const created=await prepareOwnedN8nCloudWorkflow(f.plan,f);
 const proof=await completeOwnedN8nCloudWorkflow({...f,executionId:f.execution.id},f);
 assert.equal(proof.originalOutcome,'UNKNOWN');assert.equal(proof.administrativeReassertionStatus,405);assert.equal(proof.workflowDeleted,true);
 assert.deepEqual(validateOwnedN8nCloudWorkflowProof({...f,workflowCreated:created,workflowProof:proof}),proof);
 assert.deepEqual(f.calls.filter(c=>c.method!=='GET').map(c=>c.method),['POST','DELETE']);
 assert.equal(f.calls.some(c=>/run|activate|publish/.test(c.path)),false);
});
test('lost create acknowledgment never creates again',async()=>{
 const f=fixture();f.setUnknownCreate();await assert.rejects(prepareOwnedN8nCloudWorkflow(f.plan,f));await assert.rejects(prepareOwnedN8nCloudWorkflow(f.plan,f));assert.equal(f.calls.filter(c=>c.method==='POST').length,1);
});
test('lost deletion acknowledgment is adopted read-only; no repeated DELETE',async()=>{
 const f=fixture();await prepareOwnedN8nCloudWorkflow(f.plan,f);f.setUnknownDelete();
 await assert.rejects(completeOwnedN8nCloudWorkflow({...f,executionId:f.execution.id},f));
 const proof=await completeOwnedN8nCloudWorkflow({...f,executionId:f.execution.id},f);assert.equal(proof.workflowDeleted,true);assert.equal(f.calls.filter(c=>c.method==='DELETE').length,1);
});
test('wrong credential, hidden extra node, active graph, altered URL and output cannot prove possession',()=>{
 for(const mutate of [
  f=>{f.execution.workflowData.nodes[1].credentials.httpHeaderAuth.id='foreign';},
  f=>{f.execution.workflowData.nodes.push(copy(f.workflow.nodes[0]));},
  f=>{f.execution.workflowData.active=true;},
  f=>{f.execution.workflowData.nodes[1].parameters.url+='?leak';},
  f=>{f.execution.data.resultData.runData['Verify stored credential'][0].data.main[0][0].json.receiptId='foreign';},
  f=>{f.execution.data.resultData.runData['Verify stored credential'].push(copy(f.execution.data.resultData.runData['Verify stored credential'][0]));},
  f=>{f.execution.usedPrivateCredentials=true;},f=>{f.execution.retryOf='prior';},f=>{f.execution.mode='webhook';},
  f=>{f.serverReceipt.receivedAt='2026-09-21T19:00:00Z';},
  f=>{f.serverReceipt.authenticated=false;},
 ]){const f=fixture();mutate(f);assert.throws(()=>validateOwnedN8nCloudExecution(f));}
});
test('failed or unknown execution never deletes workflow or dispatches an execution',async()=>{
 const f=fixture();await prepareOwnedN8nCloudWorkflow(f.plan,f);f.execution.status='error';
 await assert.rejects(completeOwnedN8nCloudWorkflow({...f,executionId:f.execution.id},f));
 assert.equal(f.calls.filter(c=>c.method==='DELETE').length,0);assert.equal(f.records.has('execution-proof'),false);
});
test('retained proof tamper fails before cleanup, exact result replay stays read-only',async()=>{
 const f=fixture();await prepareOwnedN8nCloudWorkflow(f.plan,f);
 const result=await completeOwnedN8nCloudWorkflow({...f,executionId:f.execution.id},f);
 const before=f.calls.filter(c=>c.method!=='GET').length;
 assert.deepEqual(await completeOwnedN8nCloudWorkflow({...f,executionId:f.execution.id},f),result);
 assert.equal(f.calls.filter(c=>c.method!=='GET').length,before);
 f.records.get('execution-observed').data.resultData.runData['Verify stored credential'][0].data.main[0][0].json.challenge='wrong';
 await assert.rejects(completeOwnedN8nCloudWorkflow({...f,executionId:f.execution.id},f));
});
