import {cloudProofDigest as hash,validateOwnedN8nCloudPlan,validateOwnedN8nCloudWorkflowCreated,validateOwnedN8nCloudWorkflowAcknowledgment,validateOwnedN8nCloudWorkflowCurrent,normalizeOwnedN8nCloudExecutionWorkflow,buildOwnedN8nCloudWorkflow} from './owned-n8n-cloud-workflow.js';
import {cloudProofHash,renderOwnedN8nCloudProxy} from './owned-n8n-cloud-verifier.js';
import {ownedN8nAttempt3SupervisorArguments} from './owned-n8n-cloud-supervisor.js';
export const EXPIRED_OPERATOR='5368f5136707eb3b889009d1d7959e920b0ba6ba',EXPIRED_WORKFLOW='wd0cXma1Y9P3FtFg';
export const EXPIRED_NAMES=['supervisor-intent','supervisor-result','plan','proxy-bytes','serve-intent','proxy-intent','proxy-result','server-receipt','server-rejection','server-ready','cleanup-intent','cleanup-result','workflow-intent','workflow-adoption','workflow-create-ack','workflow-created','execution-observed','execution-proof','workflow-delete-intent','workflow-deleted','workflow-proof'];
const root='/var/lib/blackspire-operator/preparation/owned-n8n-cloud-proof/a8e05ef40e44b6695df5b30356af0e411fe36f1a-c8b00904-7017-434a-918e-8aaadbae82fd-attempt3';
const operatorRoot='/mnt/blackspire-builds/development-cache/0/workspaces/zola-owned-cloud-attempt3-20260921';
const fail=()=>{throw Error('Expired attempt3 retirement refused; preserve raw evidence');},same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
export function validateExpiredOwnedN8nAttempt(records){
 if(!exact(records,EXPIRED_NAMES))fail();const p=validateOwnedN8nCloudPlan(records.plan),w=validateOwnedN8nCloudWorkflowCreated(p,records['workflow-created']),proxy=records['proxy-bytes'];
 if(p.attempt!==3||p.operatorSha!==EXPIRED_OPERATOR||p.createdAt!=='2026-09-21T23:56:43.850Z'||p.expiresAt!=='2026-09-22T00:11:43.850Z'||w.id!==EXPIRED_WORKFLOW||w.versionId!=='d5f4f9d8-5737-4b59-ad08-6fa2d83f04c2'
 ||!same(validateOwnedN8nCloudWorkflowAcknowledgment(p,records['workflow-create-ack']),w)||!same(records['workflow-intent'],{version:1,planDigest:hash(p),workflow:buildOwnedN8nCloudWorkflow(p)})
 ||proxy?.version!==1||cloudProofHash(proxy.before)!==p.proxyBeforeDigest||cloudProofHash(proxy.candidate)!==p.proxyCandidateDigest||renderOwnedN8nCloudProxy(proxy.before,p)!==proxy.candidate)fail();
 for(const n of ['serve-intent','proxy-intent','proxy-result','cleanup-intent'])if(!same(records[n],{version:1,planDigest:hash(p)}))fail();
 if(!same(records['cleanup-result'],{version:1,planDigest:hash(p),proxyRestored:true,listenerClosed:true})||!same(records['server-ready'],{version:1,attempt:3,planDigest:hash(p),expiresAt:p.expiresAt}))fail();
 for(const n of ['server-receipt','server-rejection','workflow-adoption','execution-observed','execution-proof','workflow-delete-intent','workflow-deleted','workflow-proof'])if(records[n]!==null)fail();
 const unit='zola-n8n-cloud-proof-attempt3.service',intent={version:1,planDigest:hash(p),unit,argumentsDigest:hash(ownedN8nAttempt3SupervisorArguments({operatorRoot,root}))},result=records['supervisor-result'],s=result?.supervisor;
 if(!same(records['supervisor-intent'],intent)||!exact(s,['invocationId','pid','startTime'])||!/^[a-f0-9]{32}$/.test(s.invocationId)||!Number.isSafeInteger(s.pid)||s.pid<2||!(/^[0-9]+$/).test(s.startTime??'')||!same(result,{version:1,planDigest:hash(p),unit,started:true,supervisor:s}))fail();
 return {version:1,attempt:3,planDigest:hash(p),recordsDigest:hash(records),workflowId:w.id,workflowVersionId:w.versionId,classification:'EXPIRED_BEFORE_REQUEST',positiveProof:false};
}
function execution(records,e){
 const p=records.plan,w=records['workflow-created'].workflow;
 if(!e||Buffer.byteLength(JSON.stringify(e))>2*1024*1024||e.id!=='2'||e.workflowId!==w.id||e.workflowVersionId!==w.versionId||e.mode!=='manual'||e.status!=='error'||e.finished!==false||e.usedPrivateCredentials!==false||e.retryOf!==null||e.retrySuccessId!==null||e.waitTill!==null||e.startedAt!=='2026-09-22T00:32:28.394Z'||e.stoppedAt!=='2026-09-22T00:32:28.689Z'||Date.parse(e.startedAt)<=Date.parse(p.expiresAt))fail();
 normalizeOwnedN8nCloudExecutionWorkflow(p,w,e.workflowData);const r=e.data?.resultData;
 if(r?.error?.httpCode!=='401'||r.error.name!=='NodeApiError'||r.lastNodeExecuted!=='Verify stored credential'||!exact(r.runData,['Manual Trigger','Verify stored credential'])||r.runData['Manual Trigger']?.length!==1||r.runData['Verify stored credential']?.length!==1||r.runData['Verify stored credential'][0]?.error?.httpCode!=='401')fail();return e;
}
function inventory(value,e){
 if(value?.status!==200||!Array.isArray(value.body?.data)||value.body.data.length!==1||value.body.nextCursor!=null&&value.body.nextCursor!=='')fail();
 const row=value.body.data[0];for(const k of ['id','workflowId','mode','status','finished','startedAt','stoppedAt'])if(row?.[k]!==e[k])fail();return value;
}
function observation(records,o){
 if(!exact(o,['workflow','executionInventory','execution','local']))fail();validateOwnedN8nCloudWorkflowCurrent(records.plan,records['workflow-created'],o.workflow);execution(records,o.execution);inventory(o.executionInventory,o.execution);local(records,o.local);return o;
}
function local(records,value){
 if(!exact(value,['proxy','listenerAbsent','temporaryAbsent','supervisorExitedAt'])||value.proxy!==records['proxy-bytes'].before||value.listenerAbsent!==true||value.temporaryAbsent!==true||!Number.isFinite(Date.parse(value.supervisorExitedAt))||Date.parse(value.supervisorExitedAt)<Date.parse(records.plan.expiresAt)||Date.parse(value.supervisorExitedAt)>=Date.parse('2026-09-22T00:32:28.394Z'))fail();return value;
}
function proofs(records,o){const binding=validateExpiredOwnedN8nAttempt(records);observation(records,o);
 const intent={version:1,kind:'owned-n8n-expired-retirement-intent',binding,observationDigest:hash(o),executionDigest:hash(o.execution)};
 const result={version:1,kind:'owned-n8n-expired-retirement-result',binding,intentDigest:hash(intent),executionDigest:hash(o.execution),classification:'EXPIRED_AND_CLEANED_BEFORE_LATE_EXECUTION',workflowDeleted:true,proxyUnchanged:true,listenerAbsent:true,positiveProof:false,originalOutcome:'UNKNOWN',administrativeReassertionStatus:405};return {intent,result};}
export function validateExpiredOwnedN8nRetirement(records,{observation:o,intent,result}){const expected=proofs(records,o);if(!same(intent,expected.intent)||!same(result,expected.result))fail();return expected.result;}
export async function retireExpiredOwnedN8nAttempt(records,{request,store,fence,observeLocal}){
 const binding=validateExpiredOwnedN8nAttempt(records),path='/api/v1/workflows/'+binding.workflowId,index='/api/v1/executions?workflowId='+binding.workflowId+'&limit=100&includeData=false';
 const guarded=async()=>{await fence();const value=local(records,await observeLocal());await fence();return value;};
 await guarded();let o=store.value('observation'),intent=store.value('intent'),result=store.value('result');if((intent||result)&&!o||result&&!intent)fail();
 if(!intent){const w=await request('GET',path),e=await request('GET','/api/v1/executions/2?includeData=true');if(w?.status!==200||e?.status!==200)fail();const current={workflow:w.body,executionInventory:await request('GET',index),execution:e.body,local:await guarded()};observation(records,current);if(o&&!same(o,current))fail();o=current;store.record('observation',o);intent=proofs(records,o).intent;store.record('intent',intent);await guarded();
  const fresh=await request('GET',path),freshExecution=await request('GET','/api/v1/executions/2?includeData=true'),freshInventory=await request('GET',index);if(fresh?.status!==200||freshExecution?.status!==200)fail();validateOwnedN8nCloudWorkflowCurrent(records.plan,records['workflow-created'],fresh.body);if(!same(freshExecution.body,o.execution)||!same(freshInventory,o.executionInventory))fail();await guarded();const deleted=await request('DELETE',path);if(![200,204].includes(deleted?.status))fail();
 }else if(!same(intent,proofs(records,o).intent))fail();
 // DELETE uncertainty is resolved only by authenticated absence; execution can
 // disappear with the deleted workflow, so retained bounded raw evidence is used.
 if((await request('GET',path))?.status!==404)fail();await guarded();const expected=proofs(records,o).result;if(result&&!same(result,expected))fail();validateExpiredOwnedN8nRetirement(records,{observation:o,intent,result:expected});store.record('observation',o);store.record('intent',intent);store.record('result',expected);return expected;
}
