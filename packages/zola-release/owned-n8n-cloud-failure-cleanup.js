import {isDeepStrictEqual} from 'node:util';
import {cloudProofDigest,validateOwnedN8nCloudWorkflowAdoption,validateOwnedN8nCloudPlan,validateOwnedN8nCloudWorkflowCreated,validateOwnedN8nCloudWorkflowCurrent} from './owned-n8n-cloud-workflow.js';
const WORKFLOW='JjlvgzqIgFQSWOM7',EXECUTION='1';
const fail=()=>{throw Error('Owned n8n failed diagnostic cleanup refused; preserve evidence');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const validateOwnedN8nCloudFailedWorkflow=(plan,created,raw)=>validateOwnedN8nCloudWorkflowCurrent(plan,created,raw);
function binding({plan,created,adoption,executionId,operatorSha}){
 validateOwnedN8nCloudPlan(plan);const w=validateOwnedN8nCloudWorkflowCreated(plan,created);
 if(w.id!==WORKFLOW||executionId!==EXECUTION||!/^[a-f0-9]{40}$/.test(operatorSha??'')||adoption?.workflowId!==w.id||adoption.workflowVersionId!==w.versionId||adoption.planDigest!==cloudProofDigest(plan)||adoption.postRepeated!==false)fail();
 validateOwnedN8nCloudWorkflowAdoption(plan,created,adoption,adoption.repairOperatorSha);
 return {version:1,planDigest:cloudProofDigest(plan),createdDigest:cloudProofDigest(created),adoptionDigest:cloudProofDigest(adoption),operatorSha,workflowId:w.id,workflowVersionId:w.versionId,executionId};
}
function failedExecution(input,e){
 const b=binding(input),p=input.plan;
 if(e?.id!==EXECUTION||e.workflowId!==WORKFLOW||e.workflowVersionId!==b.workflowVersionId||e.mode!=='manual'||e.status!=='error'||e.finished!==false||e.usedPrivateCredentials!==false||e.retryOf!=null||e.retrySuccessId!=null||e.waitTill!=null)fail();
 const start=Date.parse(e.startedAt),stop=Date.parse(e.stoppedAt);
 if(!Number.isFinite(start)||!Number.isFinite(stop)||start<Date.parse(p.createdAt)||start>=Date.parse(p.expiresAt)||stop<start||stop>Date.parse(p.expiresAt)+60000)fail();
 // Execution snapshot UI differences are retained as evidence, not normalized into acceptance.
 return b;
}
export async function cleanupOwnedN8nCloudFailure(input,{request,store,fence,closure}){
 const b=binding(input);await fence();
 for(const name of ['server-receipt','execution-proof','workflow-proof'])if(store.value(name,true))fail();
 let intent=store.value('failure-cleanup-intent',true),result=store.value('failure-cleanup-result',true),observation=store.value('failure-execution-observed',true);
 if((intent||result)&&!observation||result&&!intent)fail();
 if(observation)failedExecution(input,observation);
 if(!intent){
  await closure();const rows=[];let cursor=null;const cursors=new Set();
  for(let page=0;page<100;page++){
   const r=await request('GET','/api/v1/executions?workflowId='+WORKFLOW+'&limit=100&includeData=false'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
   if(r?.status!==200||!Array.isArray(r.body?.data)||r.body.data.length>100)fail();rows.push(...r.body.data);
   const next=r.body.nextCursor;if(next==null||next===''){cursor=null;break;}if(typeof next!=='string'||next.length>2048||cursors.has(next))fail();cursors.add(next);cursor=next;
  }
  if(cursor||rows.length!==1||rows[0].id!==EXECUTION||rows[0].status!=='error'||rows[0].mode!=='manual'||rows[0].finished!==false||!Number.isFinite(Date.parse(rows[0].stoppedAt)))fail();
  const r=await request('GET','/api/v1/executions/'+EXECUTION+'?includeData=true');if(r?.status!==200)fail();failedExecution(input,r.body);
  if(observation&&!isDeepStrictEqual(observation,r.body))fail();observation=r.body;store.record('failure-execution-observed',observation);
  const w=await request('GET','/api/v1/workflows/'+WORKFLOW);if(w?.status!==200)fail();validateOwnedN8nCloudFailedWorkflow(input.plan,input.created,w.body);await fence();
  intent={version:1,kind:'owned-n8n-failed-workflow-cleanup-intent',binding:b,failedExecutionDigest:cloudProofDigest(observation),positiveProof:false,executionGraphAcceptance:'UNVERIFIED',originalOutcome:'UNKNOWN'};
  store.record('failure-cleanup-intent',intent);await fence();
  const response=await request('DELETE','/api/v1/workflows/'+WORKFLOW);if(response?.status!==200&&response?.status!==204)fail();
 }else{
  const expected={version:1,kind:'owned-n8n-failed-workflow-cleanup-intent',binding:b,failedExecutionDigest:cloudProofDigest(observation),positiveProof:false,executionGraphAcceptance:'UNVERIFIED',originalOutcome:'UNKNOWN'};
  if(!same(intent,expected))fail();
 }
 // No second DELETE after any ambiguous acknowledgment. Only exact absence is adopted.
 const absent=await request('GET','/api/v1/workflows/'+WORKFLOW);if(absent?.status!==404)fail();
 await closure();await fence();
 const expected={version:1,kind:'owned-n8n-failed-workflow-cleanup-result',binding:b,intentDigest:cloudProofDigest(intent),failedExecutionDigest:cloudProofDigest(observation),workflowDeleted:true,positiveProof:false,executionGraphAcceptance:'UNVERIFIED',originalOutcome:'UNKNOWN',administrativeReassertionStatus:405};
 if(result&&!same(result,expected))fail();
 store.record('failure-execution-observed',observation);store.record('failure-cleanup-intent',intent);store.record('failure-cleanup-result',expected);return expected;
}
