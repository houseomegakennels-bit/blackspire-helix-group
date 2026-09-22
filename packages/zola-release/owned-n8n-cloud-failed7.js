import {cloudProofDigest as hash,validateOwnedN8nCloudPlan,validateOwnedN8nCloudWorkflowCreated,validateOwnedN8nCloudWorkflowAcknowledgment,validateOwnedN8nCloudWorkflowCurrent,normalizeOwnedN8nCloudExecutionWorkflow,buildOwnedN8nCloudWorkflow} from './owned-n8n-cloud-workflow.js';
import {cloudProofHash,renderOwnedN8nCloudProxy} from './owned-n8n-cloud-verifier.js';
import {ownedN8nAttempt7SupervisorArguments} from './owned-n8n-cloud-attempt7-supervisor.js';
export const FAILED7_OPERATOR='d7c88809de24ec6f43ecaccce07d47881baa5c82',FAILED7_WORKFLOW='D1xx9Mal5UA9iLsb';
export const FAILED7_NAMES=['supervisor-intent','supervisor-result','plan','proxy-bytes','serve-intent','proxy-intent','proxy-result','server-receipt','server-rejection','server-ready','cleanup-intent','cleanup-result','workflow-intent','workflow-adoption','workflow-create-ack','workflow-created','execution-observed','execution-proof','workflow-delete-intent','workflow-deleted','workflow-proof'];
const root='/var/lib/blackspire-operator/preparation/owned-n8n-cloud-proof/a8e05ef40e44b6695df5b30356af0e411fe36f1a-c8b00904-7017-434a-918e-8aaadbae82fd-attempt7';
const operatorRoot='/mnt/blackspire-builds/development-cache/0/workspaces/zola-owned-cloud-attempt7-20260922';
const fail=()=>{throw Error('Failed7 attempt7 retirement refused; preserve raw evidence');},same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
export function validateFailed7OwnedN8nAttempt(records){
 if(!exact(records,FAILED7_NAMES))fail();const p=validateOwnedN8nCloudPlan(records.plan),w=validateOwnedN8nCloudWorkflowCreated(p,records['workflow-created']),proxy=records['proxy-bytes'];
 if(p.attempt!==7||p.operatorSha!==FAILED7_OPERATOR||p.createdAt!=='2026-09-22T21:49:35.051Z'||p.expiresAt!=='2026-09-22T22:04:35.051Z'||w.id!==FAILED7_WORKFLOW||w.versionId!=='512c83d0-1bae-4f21-87c1-f2967a07a3f2'
 ||!same(validateOwnedN8nCloudWorkflowAcknowledgment(p,records['workflow-create-ack']),w)||!same(records['workflow-intent'],{version:1,planDigest:hash(p),workflow:buildOwnedN8nCloudWorkflow(p)})
 ||proxy?.version!==1||cloudProofHash(proxy.before)!==p.proxyBeforeDigest||cloudProofHash(proxy.candidate)!==p.proxyCandidateDigest||renderOwnedN8nCloudProxy(proxy.before,p)!==proxy.candidate)fail();
 for(const n of ['serve-intent','proxy-intent','proxy-result','cleanup-intent'])if(!same(records[n],{version:1,planDigest:hash(p)}))fail();
 if(!same(records['cleanup-result'],{version:1,planDigest:hash(p),proxyRestored:true,listenerClosed:true})||!same(records['server-ready'],{version:1,attempt:7,planDigest:hash(p),expiresAt:p.expiresAt}))fail();
 for(const n of ['server-receipt','workflow-adoption','execution-observed','execution-proof','workflow-delete-intent','workflow-deleted','workflow-proof'])if(records[n]!==null)fail();
 if(!same(records['server-rejection'],{version:1,kind:'owned-n8n-cloud-rejection',attempt:7,planDigest:hash(p),code:'AUTH_LENGTH_MISMATCH',receivedAt:'2026-09-22T21:52:51.031Z'}))fail();
 const unit='zola-n8n-cloud-proof-attempt7.service',intent={version:1,planDigest:hash(p),unit,argumentsDigest:hash(ownedN8nAttempt7SupervisorArguments({operatorRoot,root}))},result=records['supervisor-result'],s=result?.supervisor;
 if(!same(records['supervisor-intent'],intent)||!exact(s,['invocationId','pid','startTime'])||s.invocationId!=='2d95885cda4e4863ac784188d87cf56f'||!Number.isSafeInteger(s.pid)||s.pid<2||!(/^[0-9]+$/).test(s.startTime??'')||!same(result,{version:1,planDigest:hash(p),unit,started:true,supervisor:s}))fail();
 return {version:1,attempt:7,planDigest:hash(p),recordsDigest:hash(records),workflowId:w.id,workflowVersionId:w.versionId,classification:'AUTH_LENGTH_MISMATCH',positiveProof:false};
}
const executionKeys=['id','workflowId','workflowVersionId','mode','status','finished','usedPrivateCredentials','retryOf','retrySuccessId','waitTill','startedAt','stoppedAt','workflowData','lastNodeExecuted','errorName','httpCode','manualStatus','requestStatus','requestHttpCode','requestHasData','rawDigest'];
function execution(records,e){
 const p=records.plan,w=records['workflow-created'].workflow;
 if(!exact(e,executionKeys)||e.id!=='3'||e.workflowId!==w.id||e.workflowVersionId!==w.versionId||e.mode!=='manual'||e.status!=='error'||e.finished!==false||e.usedPrivateCredentials!==false||e.retryOf!==null||e.retrySuccessId!==null||e.waitTill!==null||e.startedAt!=='2026-09-22T21:52:50.724Z'||e.stoppedAt!=='2026-09-22T21:52:51.219Z'||Date.parse(e.startedAt)<Date.parse(p.createdAt)||Date.parse(e.stoppedAt)>=Date.parse(p.expiresAt))fail();
 normalizeOwnedN8nCloudExecutionWorkflow(p,w,e.workflowData);
 if(e.lastNodeExecuted!=='Verify stored credential'||e.errorName!=='NodeApiError'||e.httpCode!=='404'||e.manualStatus!=='success'||e.requestStatus!=='error'||e.requestHttpCode!=='404'||e.requestHasData!==false||!/^[a-f0-9]{64}$/.test(e.rawDigest??''))fail();return e;
}
export function projectFailed7OwnedN8nExecution(records,e){
 if(!e||Buffer.byteLength(JSON.stringify(e))>2*1024*1024)fail();
 const r=e.data?.resultData,run=r?.runData;
 if(!exact(run,['Manual Trigger','Verify stored credential'])||!Array.isArray(run['Manual Trigger'])||run['Manual Trigger'].length!==1||!Array.isArray(run['Verify stored credential'])||run['Verify stored credential'].length!==1)fail();
 const value=Object.fromEntries(executionKeys.slice(0,13).map(k=>[k,e[k]]));
 Object.assign(value,{lastNodeExecuted:r.lastNodeExecuted,errorName:r.error?.name,httpCode:r.error?.httpCode,manualStatus:run['Manual Trigger'][0]?.executionStatus,requestStatus:run['Verify stored credential'][0]?.executionStatus,requestHttpCode:run['Verify stored credential'][0]?.error?.httpCode,requestHasData:run['Verify stored credential'][0]?.data!==undefined,rawDigest:hash(e)});
 return execution(records,value);
}

function inventory(value,e){
 if(value?.status!==200||!Array.isArray(value.body?.data)||value.body.data.length!==1||value.body.nextCursor!=null&&value.body.nextCursor!=='')fail();
 const row=value.body.data[0];for(const k of ['id','workflowId','mode','status','finished','startedAt','stoppedAt'])if(row?.[k]!==e[k])fail();return value;
}
function observation(records,o){
 if(!exact(o,['workflow','executionInventory','execution','local']))fail();validateOwnedN8nCloudWorkflowCurrent(records.plan,records['workflow-created'],o.workflow);execution(records,o.execution);inventory(o.executionInventory,o.execution);local(records,o.local);return o;
}
function local(records,value){
 if(!exact(value,['proxy','listenerAbsent','temporaryAbsent','supervisorExitedAt'])||value.proxy!==records['proxy-bytes'].before||value.listenerAbsent!==true||value.temporaryAbsent!==true||!Number.isFinite(Date.parse(value.supervisorExitedAt))||value.supervisorExitedAt!=='2026-09-22T21:52:51.000Z')fail();return value;
}
function proofs(records,o){const binding=validateFailed7OwnedN8nAttempt(records);observation(records,o);
 const intent={version:1,kind:'owned-n8n-failed7-retirement-intent',binding,observationDigest:hash(o),executionDigest:hash(o.execution)};
 const result={version:1,kind:'owned-n8n-failed7-retirement-result',binding,intentDigest:hash(intent),executionDigest:hash(o.execution),classification:'AUTH_LENGTH_MISMATCH_AND_CLEANED',workflowDeleted:true,proxyUnchanged:true,listenerAbsent:true,positiveProof:false,originalOutcome:'UNKNOWN',administrativeReassertionStatus:405};return {intent,result};}
export function validateFailed7OwnedN8nRetirement(records,{observation:o,intent,result}){const expected=proofs(records,o);if(!same(intent,expected.intent)||!same(result,expected.result))fail();return expected.result;}
export async function retireFailed7OwnedN8nAttempt(records,{request,store,fence,observeLocal}){
 const binding=validateFailed7OwnedN8nAttempt(records),path='/api/v1/workflows/'+binding.workflowId,index='/api/v1/executions?workflowId='+binding.workflowId+'&limit=100&includeData=false';
 const guarded=async()=>{await fence();const value=local(records,await observeLocal());await fence();return value;};
 await guarded();let o=store.value('observation'),intent=store.value('intent'),result=store.value('result');if((intent||result)&&!o||result&&!intent)fail();
 if(!intent){const w=await request('GET',path),e=await request('GET','/api/v1/executions/3?includeData=true');if(w?.status!==200||e?.status!==200)fail();const current={workflow:w.body,executionInventory:await request('GET',index),execution:projectFailed7OwnedN8nExecution(records,e.body),local:await guarded()};observation(records,current);if(o&&!same(o,current))fail();o=current;store.record('observation',o);intent=proofs(records,o).intent;store.record('intent',intent);await guarded();
  const fresh=await request('GET',path),freshExecution=await request('GET','/api/v1/executions/3?includeData=true'),freshInventory=await request('GET',index);if(fresh?.status!==200||freshExecution?.status!==200)fail();validateOwnedN8nCloudWorkflowCurrent(records.plan,records['workflow-created'],fresh.body);if(!same(projectFailed7OwnedN8nExecution(records,freshExecution.body),o.execution)||!same(freshInventory,o.executionInventory))fail();await guarded();const deleted=await request('DELETE',path);if(![200,204].includes(deleted?.status))fail();
 }else if(!same(intent,proofs(records,o).intent))fail();
 // DELETE uncertainty is resolved only by authenticated absence; execution can
 // disappear with the deleted workflow, so the retained safe projection/digest is used.
 if((await request('GET',path))?.status!==404)fail();await guarded();const expected=proofs(records,o).result;if(result&&!same(result,expected))fail();validateFailed7OwnedN8nRetirement(records,{observation:o,intent,result:expected});store.record('observation',o);store.record('intent',intent);store.record('result',expected);return expected;
}
