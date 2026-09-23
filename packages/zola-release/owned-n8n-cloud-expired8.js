import {cloudProofDigest as hash,validateOwnedN8nCloudPlan,validateOwnedN8nCloudWorkflowCreated,validateOwnedN8nCloudWorkflowAcknowledgment,validateOwnedN8nCloudWorkflowCurrent,normalizeOwnedN8nCloudExecutionWorkflow,buildOwnedN8nCloudWorkflow} from './owned-n8n-cloud-workflow.js';
import {cloudProofHash,renderOwnedN8nCloudProxy} from './owned-n8n-cloud-verifier.js';
import {ownedN8nAttempt8SupervisorArguments} from './owned-n8n-cloud-attempt8-supervisor.js';
export const EXPIRED8_OPERATOR='a2d904ba454471f3bcef67431be900f287ce9c19',EXPIRED8_WORKFLOW='oHwmQO5Z0WWZfgaO';
export const EXPIRED8_NAMES=['supervisor-intent','supervisor-result','plan','proxy-bytes','serve-intent','proxy-intent','proxy-result','server-receipt','server-rejection','server-ready','cleanup-intent','cleanup-result','workflow-intent','workflow-adoption','workflow-create-ack','workflow-created','execution-observed','execution-proof','workflow-delete-intent','workflow-deleted','workflow-proof'];
const root='/var/lib/blackspire-operator/preparation/owned-n8n-cloud-proof/a8e05ef40e44b6695df5b30356af0e411fe36f1a-c8b00904-7017-434a-918e-8aaadbae82fd-attempt8';
const operatorRoot='/mnt/blackspire-builds/development-cache/0/workspaces/zola-owned-cloud-attempt8-20260922';
const fail=()=>{throw Error('Expired attempt8 retirement refused; preserve raw evidence');},same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
export function validateExpired8OwnedN8nAttempt(records){
 if(!exact(records,EXPIRED8_NAMES))fail();const p=validateOwnedN8nCloudPlan(records.plan),w=validateOwnedN8nCloudWorkflowCreated(p,records['workflow-created']),proxy=records['proxy-bytes'];
 if(p.attempt!==8||p.operatorSha!==EXPIRED8_OPERATOR||p.createdAt!=='2026-09-23T01:13:54.021Z'||p.expiresAt!=='2026-09-23T01:28:54.021Z'||w.id!==EXPIRED8_WORKFLOW||w.versionId!=='3895f9aa-8681-4cd2-adc0-391fe024624a'
 ||!same(validateOwnedN8nCloudWorkflowAcknowledgment(p,records['workflow-create-ack']),w)||!same(records['workflow-intent'],{version:1,planDigest:hash(p),workflow:buildOwnedN8nCloudWorkflow(p)})
 ||proxy?.version!==1||cloudProofHash(proxy.before)!==p.proxyBeforeDigest||cloudProofHash(proxy.candidate)!==p.proxyCandidateDigest||renderOwnedN8nCloudProxy(proxy.before,p)!==proxy.candidate)fail();
 for(const n of ['serve-intent','proxy-intent','proxy-result','cleanup-intent'])if(!same(records[n],{version:1,planDigest:hash(p)}))fail();
 if(!same(records['cleanup-result'],{version:1,planDigest:hash(p),proxyRestored:true,listenerClosed:true})||!same(records['server-ready'],{version:1,attempt:8,planDigest:hash(p),expiresAt:p.expiresAt}))fail();
 for(const n of ['server-receipt','server-rejection','workflow-adoption','execution-observed','execution-proof','workflow-delete-intent','workflow-deleted','workflow-proof'])if(records[n]!==null)fail();
 const unit='zola-n8n-cloud-proof-attempt8.service',intent={version:1,planDigest:hash(p),unit,argumentsDigest:hash(ownedN8nAttempt8SupervisorArguments({operatorRoot,root}))},result=records['supervisor-result'],s=result?.supervisor;
 if(!same(records['supervisor-intent'],intent)||!exact(s,['invocationId','pid','startTime'])||s.invocationId!=='eb5d841c23b84f5da454b9b958c3ad98'||!Number.isSafeInteger(s.pid)||s.pid<2||!(/^[0-9]+$/).test(s.startTime??'')||!same(result,{version:1,planDigest:hash(p),unit,started:true,supervisor:s}))fail();
 return {version:1,attempt:8,planDigest:hash(p),recordsDigest:hash(records),workflowId:w.id,workflowVersionId:w.versionId,classification:'EXPIRED8_BEFORE_REQUEST',positiveProof:false};
}
const expectedExecutions={4:['2026-09-23T02:17:21.536Z','2026-09-23T02:17:22.157Z'],5:['2026-09-23T02:17:57.713Z','2026-09-23T02:17:57.921Z']};
const executionKeys=['id','workflowId','workflowVersionId','mode','status','finished','usedPrivateCredentials','retryOf','retrySuccessId','waitTill','startedAt','stoppedAt','workflowData','lastNodeExecuted','errorName','httpCode','manualStatus','requestStatus','requestHttpCode','requestHasData','rawDigest'];
function execution(records,e){
 const p=records.plan,w=records['workflow-created'].workflow;
 if(!exact(e,executionKeys)||!Object.hasOwn(expectedExecutions,e.id)||e.workflowId!==w.id||e.workflowVersionId!==w.versionId||e.mode!=='manual'||e.status!=='error'||e.finished!==false||e.usedPrivateCredentials!==false||e.retryOf!==null||e.retrySuccessId!==null||e.waitTill!==null||e.startedAt!==expectedExecutions[e.id][0]||e.stoppedAt!==expectedExecutions[e.id][1]||Date.parse(e.startedAt)<=Date.parse(p.expiresAt))fail();
 normalizeOwnedN8nCloudExecutionWorkflow(p,w,e.workflowData);
 if(e.lastNodeExecuted!=='Verify stored credential'||e.errorName!=='NodeApiError'||e.httpCode!=='401'||e.manualStatus!=='success'||e.requestStatus!=='error'||e.requestHttpCode!=='401'||e.requestHasData!==false||!/^[a-f0-9]{64}$/.test(e.rawDigest??''))fail();return e;
}
export function projectExpired8OwnedN8nExecution(records,e){
 if(!e||Buffer.byteLength(JSON.stringify(e))>2*1024*1024)fail();
 const r=e.data?.resultData,run=r?.runData;
 if(!exact(run,['Manual Trigger','Verify stored credential'])||!Array.isArray(run['Manual Trigger'])||run['Manual Trigger'].length!==1||!Array.isArray(run['Verify stored credential'])||run['Verify stored credential'].length!==1)fail();
 const value=Object.fromEntries(executionKeys.slice(0,13).map(k=>[k,e[k]]));
 Object.assign(value,{lastNodeExecuted:r.lastNodeExecuted,errorName:r.error?.name,httpCode:r.error?.httpCode,manualStatus:run['Manual Trigger'][0]?.executionStatus,requestStatus:run['Verify stored credential'][0]?.executionStatus,requestHttpCode:run['Verify stored credential'][0]?.error?.httpCode,requestHasData:run['Verify stored credential'][0]?.data!==undefined,rawDigest:hash(e)});
 return execution(records,value);
}

function inventory(value,executions){
 if(value?.status!==200||!Array.isArray(value.body?.data)||value.body.data.length!==2||value.body.nextCursor!=null&&value.body.nextCursor!=='')fail();
 if(!same([...value.body.data.map(e=>e.id)].sort(),['4','5']))fail();
 for(const row of value.body.data){const e=executions.find(e=>e.id===row.id);for(const k of ['id','workflowId','mode','status','finished','startedAt','stoppedAt'])if(row?.[k]!==e[k])fail();}return value;
}
function executions(records,values){if(!Array.isArray(values)||values.length!==2||!same(values.map(e=>e?.id),['4','5']))fail();for(const e of values)execution(records,e);return values;}
function observation(records,o){
 if(!exact(o,['workflow','executionInventory','executions','local']))fail();validateOwnedN8nCloudWorkflowCurrent(records.plan,records['workflow-created'],o.workflow);executions(records,o.executions);inventory(o.executionInventory,o.executions);local(records,o.local);return o;
}
function local(records,value){
 if(!exact(value,['proxy','listenerAbsent','temporaryAbsent','supervisorExitedAt'])||value.proxy!==records['proxy-bytes'].before||value.listenerAbsent!==true||value.temporaryAbsent!==true||!Number.isFinite(Date.parse(value.supervisorExitedAt))||value.supervisorExitedAt!=='2026-09-23T01:28:54.000Z')fail();return value;
}
function proofs(records,o){const binding=validateExpired8OwnedN8nAttempt(records);observation(records,o);
 const intent={version:1,kind:'owned-n8n-expired8-retirement-intent',binding,observationDigest:hash(o),executionsDigest:hash(o.executions)};
 const result={version:1,kind:'owned-n8n-expired8-retirement-result',binding,intentDigest:hash(intent),executionsDigest:hash(o.executions),classification:'EXPIRED_AND_CLEANED_BEFORE_TWO_LATE_EXECUTIONS',workflowDeleted:true,proxyUnchanged:true,listenerAbsent:true,positiveProof:false,originalOutcome:'UNKNOWN',administrativeReassertionStatus:405};return {intent,result};}
export function validateExpired8OwnedN8nRetirement(records,{observation:o,intent,result}){const expected=proofs(records,o);if(!same(intent,expected.intent)||!same(result,expected.result))fail();return expected.result;}
export async function retireExpired8OwnedN8nAttempt(records,{request,store,fence,observeLocal}){
 if(Date.now()<Date.parse(records.plan.expiresAt))fail();
 const binding=validateExpired8OwnedN8nAttempt(records),path='/api/v1/workflows/'+binding.workflowId,index='/api/v1/executions?workflowId='+binding.workflowId+'&limit=100&includeData=false';
 const guarded=async()=>{await fence();const value=local(records,await observeLocal());await fence();return value;};
 await guarded();let o=store.value('observation'),intent=store.value('intent'),result=store.value('result');if((intent||result)&&!o||result&&!intent)fail();
 if(!intent){const w=await request('GET',path),e4=await request('GET','/api/v1/executions/4?includeData=true'),e5=await request('GET','/api/v1/executions/5?includeData=true');if(w?.status!==200||e4?.status!==200||e5?.status!==200)fail();const current={workflow:w.body,executionInventory:await request('GET',index),executions:[e4.body,e5.body].map(e=>projectExpired8OwnedN8nExecution(records,e)),local:await guarded()};observation(records,current);if(o&&!same(o,current))fail();o=current;store.record('observation',o);intent=proofs(records,o).intent;store.record('intent',intent);await guarded();
 const fresh=await request('GET',path),fresh4=await request('GET','/api/v1/executions/4?includeData=true'),fresh5=await request('GET','/api/v1/executions/5?includeData=true'),freshInventory=await request('GET',index);if(fresh?.status!==200||fresh4?.status!==200||fresh5?.status!==200)fail();validateOwnedN8nCloudWorkflowCurrent(records.plan,records['workflow-created'],fresh.body);if(!same([fresh4.body,fresh5.body].map(e=>projectExpired8OwnedN8nExecution(records,e)),o.executions)||!same(freshInventory,o.executionInventory))fail();await guarded();const deleted=await request('DELETE',path);if(![200,204].includes(deleted?.status))fail();
 }else if(!same(intent,proofs(records,o).intent))fail();
 // DELETE uncertainty is resolved only by authenticated absence; execution can
 // disappear with the deleted workflow, so retained safe projection and raw digests is used.
 if((await request('GET',path))?.status!==404)fail();await guarded();const expected=proofs(records,o).result;if(result&&!same(result,expected))fail();validateExpired8OwnedN8nRetirement(records,{observation:o,intent,result:expected});store.record('observation',o);store.record('intent',intent);store.record('result',expected);return expected;
}
