import {createHash} from 'node:crypto';
import {N8N_REASSERTION} from './owned-n8n-credential-reassertion.js';
export const cloudProofDigest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=()=>{throw Error('Owned n8n cloud credential proof refused; do not repeat execution');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hex=v=>/^[a-f0-9]{64}$/.test(v??'');
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.split(',').sort().join(',');
export function validateOwnedN8nCloudPlan(p){
 if(p?.version!==1||p.kind!=='owned-n8n-cloud-proof-plan'||p.releaseSha!==N8N_REASSERTION.releaseSha||p.operationId!==N8N_REASSERTION.operationId||p.stageAttemptId!=='f163d812-3711-471b-863a-038e85d59137'||!/^[a-f0-9]{40}$/.test(p.operatorSha??'')||p.credentialId!==N8N_REASSERTION.credentialId||!hex(p.challenge)||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(p.receiptId??'')||p.origin!=='https://jarvis.blackspirehelix.com'||p.path!=='/__zola_credential_proof/'+p.challenge)fail();
 for(const key of ['authorityDigest','originalIntentDigest','reassertionIntentDigest','reassertionAckDigest','sourceDigest','profileDigest','ingressDigest','proxyBeforeDigest','proxyCandidateDigest'])if(!hex(p[key]))fail();
 const start=Date.parse(p.createdAt),end=Date.parse(p.expiresAt);if(!Number.isFinite(start)||!Number.isFinite(end)||end-start!==15*60*1000)fail();return p;
}
export function buildOwnedN8nCloudWorkflow(plan){
 const p=validateOwnedN8nCloudPlan(plan);
 return {name:'Zola credential proof '+p.challenge,nodes:[
 {parameters:{},id:'owned-proof-manual',name:'Manual Trigger',type:'n8n-nodes-base.manualTrigger',typeVersion:1,position:[0,0]},
 {parameters:{method:'GET',url:p.origin+p.path,authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',options:{redirect:{redirect:{followRedirects:false}},timeout:40000,response:{response:{responseFormat:'json'}}}},id:'owned-proof-request',name:'Verify stored credential',type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position:[240,0],credentials:{httpHeaderAuth:{id:p.credentialId,name:'ZOLA Buyer writer'}},retryOnFail:false,onError:'stopWorkflow'}
 ],connections:{'Manual Trigger':{main:[[{node:'Verify stored credential',type:'main',index:0}]]}},settings:{executionOrder:'v1',saveDataSuccessExecution:'all',saveDataErrorExecution:'all',saveManualExecutions:true,executionTimeout:60}};
}
export function normalizeOwnedN8nCloudWorkflow(plan,raw){
 const expected=buildOwnedN8nCloudWorkflow(plan);
 if(!id(raw?.id)||!id(raw.versionId)||raw.active!==false||raw.activeVersionId!=null||raw.pinData&&Object.keys(raw.pinData).length||raw.staticData!=null||raw.isArchived===true)fail();
 for(const key of ['name','nodes','connections','settings'])if(!same(raw[key],expected[key]))fail();
 return {id:raw.id,versionId:raw.versionId,...expected,active:false};
}
export function validateOwnedN8nCloudWorkflowCreated(plan,created){
 if(!exact(created,'version,planDigest,workflow')||created.version!==1||created.planDigest!==cloudProofDigest(validateOwnedN8nCloudPlan(plan)))fail();
 const value=normalizeOwnedN8nCloudWorkflow(plan,created.workflow);if(!same(value,created.workflow))fail();return value;
}
export function validateOwnedN8nCloudWorkflowCurrent(plan,created,raw){
 const expected=validateOwnedN8nCloudWorkflowCreated(plan,created),observed=normalizeOwnedN8nCloudWorkflow(plan,raw);
 if(!same(expected,observed))fail();return observed;
}
export function validateOwnedN8nCloudWorkflowDeletion(plan,created,executionProof,deleteIntent,deleted){
 const workflow=validateOwnedN8nCloudWorkflowCreated(plan,created);
 const intent={version:1,planDigest:cloudProofDigest(plan),workflowId:workflow.id,executionProofDigest:cloudProofDigest(executionProof)};
 const cleanup={version:1,planDigest:cloudProofDigest(plan),workflowId:workflow.id,deleted:true};
 if(!same(deleteIntent,intent)||!same(deleted,cleanup))fail();return cleanup;
}
async function getWorkflow(plan,request,workflowId){const r=await request('GET','/api/v1/workflows/'+workflowId);if(r?.status!==200)fail();return normalizeOwnedN8nCloudWorkflow(plan,r.body);}
export async function prepareOwnedN8nCloudWorkflow(plan,{request,store,fence,now=()=>Date.now()}){
 validateOwnedN8nCloudPlan(plan);await fence();if(now()<Date.parse(plan.createdAt)||now()>=Date.parse(plan.expiresAt))fail();
 const intent={version:1,planDigest:cloudProofDigest(plan),workflow:buildOwnedN8nCloudWorkflow(plan)};
 const prior=store.value('workflow-intent',true),created=store.value('workflow-created',true);
 if(prior&&!same(prior,intent)||created&&!prior)fail();
 if(created){const w=validateOwnedN8nCloudWorkflowCreated(plan,created),observed=await getWorkflow(plan,request,w.id);if(!same(w,observed))fail();await fence();store.record('workflow-intent',intent);store.record('workflow-created',created);return created;}
 if(prior)fail(); // Unknown create acknowledgment is never another create.
 store.record('workflow-intent',intent);await fence();
 const r=await request('POST','/api/v1/workflows',intent.workflow);
 if(r?.status!==200&&r?.status!==201)fail();
 const workflow=normalizeOwnedN8nCloudWorkflow(plan,r.body),result={version:1,planDigest:cloudProofDigest(plan),workflow};
 store.record('workflow-created',result);
 if(!same(await getWorkflow(plan,request,workflow.id),workflow))fail();await fence();return result;
}
export function validateOwnedN8nCloudExecution({plan,workflow,execution,serverReceipt}){
 validateOwnedN8nCloudPlan(plan);const w=normalizeOwnedN8nCloudWorkflow(plan,workflow),r=serverReceipt,e=execution;
 if(!exact(r,'version,kind,planDigest,challenge,receiptId,receivedAt,authenticated')||r.version!==1||r.kind!=='owned-n8n-cloud-authenticated'||r.planDigest!==cloudProofDigest(plan)||r.challenge!==plan.challenge||r.receiptId!==plan.receiptId||r.authenticated!==true)fail();
 const at=Date.parse(r.receivedAt),start=Date.parse(e?.startedAt),stop=Date.parse(e?.stoppedAt);
 if(!Number.isFinite(at)||at<Date.parse(plan.createdAt)||at>=Date.parse(plan.expiresAt)||!Number.isFinite(start)||!Number.isFinite(stop)||start<Date.parse(plan.createdAt)||stop<start||at<start||at>stop||stop>Date.parse(plan.expiresAt)+60000)fail();
 if(!id(e.id)||e.workflowId!==w.id||e.mode!=='manual'||e.usedPrivateCredentials!==false||e.status!=='success'||e.finished!==true||e.retryOf!=null||e.retrySuccessId!=null||e.waitTill!=null||e.data?.resultData?.error||e.workflowVersionId!==w.versionId||!same(normalizeOwnedN8nCloudWorkflow(plan,e.workflowData),w))fail();
 const result=e.data.resultData,run=result.runData;
 if(!exact(run,'Manual Trigger,Verify stored credential')||result.lastNodeExecuted!=='Verify stored credential')fail();
 for(const name of ['Manual Trigger','Verify stored credential']){
  const rows=run[name];if(!Array.isArray(rows)||rows.length!==1||rows[0]?.error||rows[0]?.executionStatus!=='success'||!Number.isFinite(rows[0].startTime)||!Number.isFinite(rows[0].executionTime))fail();
 }
 const output=run['Verify stored credential'][0].data;
 if(!exact(output,'main')||!Array.isArray(output.main)||output.main.length!==1||!Array.isArray(output.main[0])||output.main[0].length!==1)fail();
 const item=output.main[0][0],expected={version:1,status:'CREDENTIAL_POSSESSION_VERIFIED',challenge:plan.challenge,receiptId:plan.receiptId};
 if(!same(item.json,expected)||item.binary!==undefined)fail();
 return {version:1,kind:'owned-n8n-cloud-execution-proof',planDigest:cloudProofDigest(plan),workflowId:w.id,workflowVersionId:w.versionId,workflowDigest:cloudProofDigest(w),executionId:e.id,executionDigest:cloudProofDigest(e),serverReceiptDigest:cloudProofDigest(r),challenge:plan.challenge,receiptId:plan.receiptId,credentialId:plan.credentialId};
}
export function validateOwnedN8nCloudWorkflowProof({plan,workflowCreated,execution,serverReceipt,workflowProof}){
 const workflow=validateOwnedN8nCloudWorkflowCreated(plan,workflowCreated);
 const expected={...validateOwnedN8nCloudExecution({plan,workflow,execution,serverReceipt}),kind:'owned-n8n-cloud-workflow-proof',workflowDeleted:true,originalOutcome:'UNKNOWN',administrativeReassertionStatus:405};
 if(!same(workflowProof,expected))fail();return expected;
}
export async function completeOwnedN8nCloudWorkflow({plan,executionId,serverReceipt},{request,store,fence}){
 await fence();const created=store.value('workflow-created',true),workflow=validateOwnedN8nCloudWorkflowCreated(plan,created);
 if(!id(executionId))fail();
 const retained=store.value('execution-proof',true),deletion=store.value('workflow-delete-intent',true),deleted=store.value('workflow-deleted',true);
 if(deletion&&!retained||deleted&&!deletion)fail();
 let proof;
 if(retained){
  const observed=store.value('execution-observed',true);
  proof=validateOwnedN8nCloudExecution({plan,workflow,execution:observed,serverReceipt});
  if(proof.executionId!==executionId||!same(proof,retained))fail();
  store.record('execution-observed',observed);store.record('execution-proof',proof);
 }else{
  if(!same(await getWorkflow(plan,request,workflow.id),workflow))fail();
  const response=await request('GET','/api/v1/executions/'+executionId+'?includeData=true');if(response?.status!==200)fail();
  proof=validateOwnedN8nCloudExecution({plan,workflow,execution:response.body,serverReceipt});store.record('execution-observed',response.body);store.record('execution-proof',proof);
 }
 const intent={version:1,planDigest:cloudProofDigest(plan),workflowId:workflow.id,executionProofDigest:cloudProofDigest(proof)};
 if(deletion&&!same(deletion,intent))fail();
 await fence();const existing=await request('GET','/api/v1/workflows/'+workflow.id);
 if(existing?.status===404){if(!deletion)fail();}
 else{
  if(existing?.status!==200||!same(normalizeOwnedN8nCloudWorkflow(plan,existing.body),workflow)||deletion)fail();
  store.record('workflow-delete-intent',intent);await fence();
  const response=await request('DELETE','/api/v1/workflows/'+workflow.id);if(response?.status!==200&&response?.status!==204)fail();
  const absent=await request('GET','/api/v1/workflows/'+workflow.id);if(absent?.status!==404)fail();
 }
 const cleanup={version:1,planDigest:cloudProofDigest(plan),workflowId:workflow.id,deleted:true};
 if(deleted&&!same(deleted,cleanup))fail();
 store.record('workflow-delete-intent',intent);store.record('workflow-deleted',cleanup);
 const result={...proof,kind:'owned-n8n-cloud-workflow-proof',workflowDeleted:true,originalOutcome:'UNKNOWN',administrativeReassertionStatus:405};
 store.record('workflow-proof',result);await fence();return result;
}
