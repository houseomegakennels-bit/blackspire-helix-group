import {cloudProofDigest as hash,validateOwnedN8nCloudPlan,validateOwnedN8nCloudWorkflowCreated,validateOwnedN8nCloudWorkflowAcknowledgment,validateOwnedN8nCloudWorkflowCurrent,buildOwnedN8nCloudWorkflow} from './owned-n8n-cloud-workflow.js';
import {cloudProofHash,renderOwnedN8nCloudProxy} from './owned-n8n-cloud-verifier.js';
import {ownedN8nAttempt6SupervisorArguments} from './owned-n8n-cloud-attempt6-supervisor.js';
export const EXPIRED6_OPERATOR='1d329762ee2c90c1b18f1518fb299789d2dad124',EXPIRED6_WORKFLOW='Sx1U1E7g7K2UWH9B';
export const EXPIRED6_NAMES=['supervisor-intent','supervisor-result','plan','proxy-bytes','serve-intent','proxy-intent','proxy-result','server-receipt','server-rejection','server-ready','cleanup-intent','cleanup-result','workflow-intent','workflow-adoption','workflow-create-ack','workflow-created','execution-observed','execution-proof','workflow-delete-intent','workflow-deleted','workflow-proof'];
const root='/var/lib/blackspire-operator/preparation/owned-n8n-cloud-proof/a8e05ef40e44b6695df5b30356af0e411fe36f1a-c8b00904-7017-434a-918e-8aaadbae82fd-attempt6';
const operatorRoot='/mnt/blackspire-builds/development-cache/0/workspaces/zola-owned-cloud-attempt6-20260922';
const fail=()=>{throw Error('Not-ready attempt6 retirement refused; preserve raw evidence');},same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
export function validateExpired6OwnedN8nAttempt(records){
 if(!exact(records,EXPIRED6_NAMES))fail();const p=validateOwnedN8nCloudPlan(records.plan),w=validateOwnedN8nCloudWorkflowCreated(p,records['workflow-created']),proxy=records['proxy-bytes'];
 if(p.attempt!==6||p.operatorSha!==EXPIRED6_OPERATOR||p.createdAt!=='2026-09-22T19:51:21.580Z'||p.expiresAt!=='2026-09-22T20:06:21.580Z'||w.id!==EXPIRED6_WORKFLOW||w.versionId!=='e309f33f-07e9-4651-83b0-027d4fd639e8'
 ||!same(validateOwnedN8nCloudWorkflowAcknowledgment(p,records['workflow-create-ack']),w)||!same(records['workflow-intent'],{version:1,planDigest:hash(p),workflow:buildOwnedN8nCloudWorkflow(p)})
 ||proxy?.version!==1||cloudProofHash(proxy.before)!==p.proxyBeforeDigest||cloudProofHash(proxy.candidate)!==p.proxyCandidateDigest||renderOwnedN8nCloudProxy(proxy.before,p)!==proxy.candidate)fail();
 for(const n of ['serve-intent','proxy-intent','proxy-result','cleanup-intent'])if(!same(records[n],{version:1,planDigest:hash(p)}))fail();
 if(!same(records['cleanup-result'],{version:1,planDigest:hash(p),proxyRestored:true,listenerClosed:true})||!same(records['server-ready'],{version:1,attempt:6,planDigest:hash(p),expiresAt:p.expiresAt}))fail();
 for(const n of ['server-receipt','server-rejection','workflow-adoption','execution-observed','execution-proof','workflow-delete-intent','workflow-deleted','workflow-proof'])if(records[n]!==null)fail();
 const unit='zola-n8n-cloud-proof-attempt6.service',intent={version:1,planDigest:hash(p),unit,argumentsDigest:hash(ownedN8nAttempt6SupervisorArguments({operatorRoot,root}))},result=records['supervisor-result'],s=result?.supervisor;
 if(!same(records['supervisor-intent'],intent)||!exact(s,['invocationId','pid','startTime'])||s.invocationId!=='2faa804748db45be8dc0d4100257a2b1'||!Number.isSafeInteger(s.pid)||s.pid<2||!(/^[0-9]+$/).test(s.startTime??'')||!same(result,{version:1,planDigest:hash(p),unit,started:true,supervisor:s}))fail();
 return {version:1,attempt:6,planDigest:hash(p),recordsDigest:hash(records),workflowId:w.id,workflowVersionId:w.versionId,classification:'EXPIRED_WITH_ZERO_EXECUTIONS',positiveProof:false};
}

function local(records,value){if(!exact(value,['proxy','listenerAbsent','temporaryAbsent','supervisorExitedAt'])||value.proxy!==records['proxy-bytes'].before||value.listenerAbsent!==true||value.temporaryAbsent!==true||!Number.isFinite(Date.parse(value.supervisorExitedAt))||Date.parse(value.supervisorExitedAt)!==Date.parse('2026-09-22T20:06:22.000Z'))fail();return value;}
function empty(value){if(value?.status!==200||!Array.isArray(value.body?.data)||value.body.data.length!==0||value.body.nextCursor!=null&&value.body.nextCursor!=='')fail();return {status:200,data:[],nextCursor:null};}
function observation(records,o){if(!exact(o,['workflow','executionInventory','local']))fail();validateOwnedN8nCloudWorkflowCurrent(records.plan,records['workflow-created'],o.workflow);if(!same(o.executionInventory,{status:200,data:[],nextCursor:null}))fail();local(records,o.local);return o;}
function proofs(records,o){const binding=validateExpired6OwnedN8nAttempt(records);observation(records,o);const intent={version:1,kind:'owned-n8n-expired6-retirement-intent',binding,observationDigest:hash(o)};const result={version:1,kind:'owned-n8n-expired6-retirement-result',binding,intentDigest:hash(intent),classification:'EXPIRED_WITH_ZERO_EXECUTIONS',workflowDeleted:true,zeroExecutions:true,proxyUnchanged:true,listenerAbsent:true,temporaryAbsent:true,positiveProof:false,originalOutcome:'UNKNOWN',administrativeReassertionStatus:405};return {intent,result};}
export function validateExpired6OwnedN8nRetirement(records,{observation:o,intent,result}){const expected=proofs(records,o);if(!same(intent,expected.intent)||!same(result,expected.result))fail();return expected.result;}
export async function retireExpired6OwnedN8nAttempt(records,{request,store,fence,observeLocal}){
 if(Date.now()<Date.parse(records.plan.expiresAt))fail();
 const binding=validateExpired6OwnedN8nAttempt(records),path='/api/v1/workflows/'+binding.workflowId,index='/api/v1/executions?workflowId='+binding.workflowId+'&limit=100&includeData=false';
 const guarded=async()=>{await fence();const v=local(records,await observeLocal());await fence();return v;};
 await guarded();let o=store.value('observation'),intent=store.value('intent'),result=store.value('result');if((intent||result)&&!o||result&&!intent)fail();
 if(!intent){const w=await request('GET',path);if(w?.status!==200)fail();const current={workflow:w.body,executionInventory:empty(await request('GET',index)),local:await guarded()};observation(records,current);if(o&&!same(o,current))fail();o=current;store.record('observation',o);intent=proofs(records,o).intent;store.record('intent',intent);await guarded();const fresh=await request('GET',path);if(fresh?.status!==200)fail();validateOwnedN8nCloudWorkflowCurrent(records.plan,records['workflow-created'],fresh.body);empty(await request('GET',index));await guarded();const deleted=await request('DELETE',path);if(![200,204].includes(deleted?.status))fail();
 }else if(!same(intent,proofs(records,o).intent))fail();
 // Unknown DELETE can only reconcile authenticated absence, never redispatch.
 if((await request('GET',path))?.status!==404)fail();empty(await request('GET',index));await guarded();const expected=proofs(records,o).result;if(result&&!same(result,expected))fail();validateExpired6OwnedN8nRetirement(records,{observation:o,intent,result:expected});store.record('observation',o);store.record('intent',intent);store.record('result',expected);return expected;
}
