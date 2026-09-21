import {cloudProofDigest as hash,validateOwnedN8nCloudPlan,validateOwnedN8nCloudWorkflowCreated,validateOwnedN8nCloudWorkflowAcknowledgment,validateOwnedN8nCloudWorkflowCurrent,buildOwnedN8nCloudWorkflow} from './owned-n8n-cloud-workflow.js';
import {cloudProofHash,renderOwnedN8nCloudProxy} from './owned-n8n-cloud-verifier.js';
const fail=()=>{throw Error('Interrupted cloud attempt refused; preserve records');},same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export const INTERRUPTED_OPERATOR='c06793415c546b779fda36447f9ab23cfd87ac10',INTERRUPTED_WORKFLOW='BJOFn01xn6KSKGlg';
export const INTERRUPTED_NAMES=['plan','proxy-bytes','workflow-intent','workflow-create-ack','workflow-created','serve-intent','proxy-intent','proxy-result','server-receipt','server-rejection','server-ready','cleanup-intent','cleanup-result','workflow-adoption','execution-observed','execution-proof','workflow-delete-intent','workflow-deleted','workflow-proof'];
export function validateInterruptedOwnedN8nAttempt(records){
 if(!records||Object.keys(records).sort().join(',')!==[...INTERRUPTED_NAMES].sort().join(','))fail();
 const p=validateOwnedN8nCloudPlan(records.plan),created=records['workflow-created'],w=validateOwnedN8nCloudWorkflowCreated(p,created),proxy=records['proxy-bytes'];
 if(p.attempt!==2||p.operatorSha!==INTERRUPTED_OPERATOR||w.id!==INTERRUPTED_WORKFLOW||!same(validateOwnedN8nCloudWorkflowAcknowledgment(p,records['workflow-create-ack']),w)
 ||!same(records['workflow-intent'],{version:1,planDigest:hash(p),workflow:buildOwnedN8nCloudWorkflow(p)})||!same(records['serve-intent'],{version:1,planDigest:hash(p)})
 ||proxy?.version!==1||cloudProofHash(proxy.before)!==p.proxyBeforeDigest||cloudProofHash(proxy.candidate)!==p.proxyCandidateDigest||renderOwnedN8nCloudProxy(proxy.before,p)!==proxy.candidate)fail();
 for(const n of INTERRUPTED_NAMES.slice(6).filter(n=>!['cleanup-intent','cleanup-result'].includes(n)))if(records[n]!==null)fail();
 if(!same(records['cleanup-intent'],{version:1,planDigest:hash(p)})||!same(records['cleanup-result'],{version:1,planDigest:hash(p),proxyRestored:true,listenerClosed:true}))fail();
 return {version:1,attempt:2,planDigest:hash(p),recordsDigest:hash(records),workflowId:w.id,workflowVersionId:w.versionId,classification:'INTERRUPTED_BEFORE_READY',positiveProof:false};
}
const empty=r=>{if(r?.status!==200||!Array.isArray(r.body?.data)||r.body.data.length!==0||r.body.nextCursor!=null&&r.body.nextCursor!=='')fail();return {status:200,data:[],nextCursor:null};};
export function validateInterruptedOwnedN8nAbandonment(records,{observation,intent,result}){
 const binding=validateInterruptedOwnedN8nAttempt(records);if(!observation||Object.keys(observation).sort().join(',')!=='executionInventory,workflow')fail();
 validateOwnedN8nCloudWorkflowCurrent(records.plan,records['workflow-created'],observation.workflow);if(!same(observation.executionInventory,{status:200,data:[],nextCursor:null}))fail();
 const expected={version:1,kind:'owned-n8n-interrupted-abandonment-intent',binding,observationDigest:hash(observation)};
 const outcome={version:1,kind:'owned-n8n-interrupted-abandonment-result',binding,intentDigest:hash(expected),workflowDeleted:true,zeroExecutions:true,proxyUnchanged:true,listenerAbsent:true,temporaryAbsent:true,positiveProof:false};
 if(!same(intent,expected)||!same(result,outcome))fail();return outcome;
}
export async function abandonInterruptedOwnedN8nAttempt(records,{request,store,fence,observeLocal}){
 const binding=validateInterruptedOwnedN8nAttempt(records),inventory='/api/v1/executions?workflowId='+binding.workflowId+'&limit=100&includeData=false',workflow='/api/v1/workflows/'+binding.workflowId;
 const guarded=async()=>{await fence();const p=await observeLocal();if(p.proxy!==records['proxy-bytes'].before||p.listenerAbsent!==true||p.temporaryAbsent!==true)fail();await fence();};
 await guarded();let observation=store.value('observation'),intent=store.value('intent'),result=store.value('result');if((intent||result)&&!observation||result&&!intent)fail();
 if(!intent){
  const w=await request('GET',workflow);if(w?.status!==200)fail();validateOwnedN8nCloudWorkflowCurrent(records.plan,records['workflow-created'],w.body);
  const observed={workflow:w.body,executionInventory:empty(await request('GET',inventory))};if(observation&&!same(observation,observed))fail();observation=observed;store.record('observation',observation);
  intent={version:1,kind:'owned-n8n-interrupted-abandonment-intent',binding,observationDigest:hash(observation)};
  await guarded();store.record('intent',intent);await guarded();
  const fresh=await request('GET',workflow);if(fresh?.status!==200)fail();validateOwnedN8nCloudWorkflowCurrent(records.plan,records['workflow-created'],fresh.body);empty(await request('GET',inventory));await guarded();
  const response=await request('DELETE',workflow);if(![200,204].includes(response?.status))fail();
 }else{
  const expected={version:1,kind:'owned-n8n-interrupted-abandonment-intent',binding,observationDigest:hash(observation)};if(!same(intent,expected))fail();validateOwnedN8nCloudWorkflowCurrent(records.plan,records['workflow-created'],observation.workflow);if(!same(observation.executionInventory,{status:200,data:[],nextCursor:null}))fail();
 }
 // An ambiguous DELETE is never repeated. Only authenticated absence is adopted.
 if((await request('GET',workflow))?.status!==404)fail();empty(await request('GET',inventory));await guarded();
 const outcome={version:1,kind:'owned-n8n-interrupted-abandonment-result',binding,intentDigest:hash(intent),workflowDeleted:true,zeroExecutions:true,proxyUnchanged:true,listenerAbsent:true,temporaryAbsent:true,positiveProof:false};
 validateInterruptedOwnedN8nAbandonment(records,{observation,intent,result:outcome});if(result&&!same(result,outcome))fail();
 store.record('observation',observation);store.record('intent',intent);store.record('result',outcome);return outcome;
}
