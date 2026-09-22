import {isDeepStrictEqual} from 'node:util';
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
 if(p.attempt!==undefined&&(![2,3,4,5,6,7,8].includes(p.attempt)||!hex(p.predecessorFailureDigest)))fail();
 if(p.attempt===undefined&&p.predecessorFailureDigest!==undefined)fail();
 if([3,4,5,6,7,8].includes(p.attempt)?!hex(p.predecessorInterruptionDigest):p.predecessorInterruptionDigest!==undefined)fail();
 if([4,5,6,7,8].includes(p.attempt)?!hex(p.predecessorExpiryDigest):p.predecessorExpiryDigest!==undefined)fail();
 if([5,6,7,8].includes(p.attempt)?!hex(p.predecessorNotReadyDigest):p.predecessorNotReadyDigest!==undefined)fail();
 if([6,7,8].includes(p.attempt)?!hex(p.predecessorFifthExpiryDigest):p.predecessorFifthExpiryDigest!==undefined)fail();
 if([7,8].includes(p.attempt)?!hex(p.predecessorSixthExpiryDigest):p.predecessorSixthExpiryDigest!==undefined)fail();
 if(p.attempt===8?(!hex(p.predecessorSeventhFailureDigest)||!hex(p.credentialSaveDigest)):p.predecessorSeventhFailureDigest!==undefined||p.credentialSaveDigest!==undefined)fail();
 const start=Date.parse(p.createdAt),end=Date.parse(p.expiresAt);if(!Number.isFinite(start)||!Number.isFinite(end)||end-start!==15*60*1000)fail();return p;
}
export function buildOwnedN8nCloudWorkflow(plan){
 const p=validateOwnedN8nCloudPlan(plan);
 return {name:([3,4,5,6,7,8].includes(p.attempt)?'Zola credential proof attempt'+p.attempt+' ':'Zola credential proof ')+p.challenge,nodes:[
 {parameters:{},id:'owned-proof-manual',name:'Manual Trigger',type:'n8n-nodes-base.manualTrigger',typeVersion:1,position:[0,0]},
 {parameters:{method:'GET',url:p.origin+p.path,authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',options:{redirect:{redirect:{followRedirects:false}},timeout:[5,6,7,8].includes(p.attempt)?70000:40000,response:{response:{responseFormat:'json'}}}},id:'owned-proof-request',name:'Verify stored credential',type:'n8n-nodes-base.httpRequest',typeVersion:4.2,position:[240,0],credentials:{httpHeaderAuth:{id:p.credentialId,name:'ZOLA Buyer writer'}},retryOnFail:false,onError:'stopWorkflow'}
 ],connections:{'Manual Trigger':{main:[[{node:'Verify stored credential',type:'main',index:0}]]}},settings:{executionOrder:'v1',saveDataSuccessExecution:'all',saveDataErrorExecution:'all',saveManualExecutions:true,executionTimeout:[5,6,7,8].includes(p.attempt)?90:60}};
}
export function normalizeOwnedN8nCloudWorkflow(plan,raw){
 const expected=buildOwnedN8nCloudWorkflow(plan);
 if(!id(raw?.id)||!id(raw.versionId)||raw.active!==false||raw.activeVersionId!=null||raw.pinData&&Object.keys(raw.pinData).length||raw.staticData!=null||raw.isArchived===true)fail();
 for(const key of ['name','nodes','connections','settings'])if(!isDeepStrictEqual(raw[key],expected[key]))fail();
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
export function validateOwnedN8nCloudWorkflowAcknowledgment(plan,ack){
 if(!exact(ack,'version,planDigest,status,responseDigest,body')||ack.version!==1||ack.planDigest!==cloudProofDigest(plan)||(ack.status!==200&&ack.status!==201)||ack.responseDigest!==cloudProofDigest(ack.body))fail();
 return normalizeOwnedN8nCloudWorkflow(plan,ack.body);
}
export async function prepareOwnedN8nCloudWorkflow(plan,{request,store,fence,now=()=>Date.now()}){
 validateOwnedN8nCloudPlan(plan);await fence();if(now()<Date.parse(plan.createdAt)||now()>=Date.parse(plan.expiresAt))fail();
 const intent={version:1,planDigest:cloudProofDigest(plan),workflow:buildOwnedN8nCloudWorkflow(plan)};
 const prior=store.value('workflow-intent',true),created=store.value('workflow-created',true);
 let ack=store.value('workflow-create-ack',true);
 if(prior&&!same(prior,intent)||(created||ack)&&!prior)fail();
 if(created){
  const w=validateOwnedN8nCloudWorkflowCreated(plan,created);
  if([2,3,4,5,6,7,8].includes(plan.attempt)&&!same(validateOwnedN8nCloudWorkflowAcknowledgment(plan,ack),w))fail();
  if(!same(w,await getWorkflow(plan,request,w.id)))fail();await fence();
  store.record('workflow-intent',intent);if(ack)store.record('workflow-create-ack',ack);store.record('workflow-created',created);return created;
 }
 if(prior&&!ack)fail();
 if(!prior){
  store.record('workflow-intent',intent);await fence();
  const r=await request('POST','/api/v1/workflows',intent.workflow);
  if(!Number.isInteger(r?.status)||r.status<100||r.status>599)fail();
  ack={version:1,planDigest:cloudProofDigest(plan),status:r.status,responseDigest:cloudProofDigest(r.body??null),body:r.body??null};
  store.record('workflow-create-ack',ack);
 }
 const workflow=validateOwnedN8nCloudWorkflowAcknowledgment(plan,ack),result={version:1,planDigest:cloudProofDigest(plan),workflow};
 if(!same(await getWorkflow(plan,request,workflow.id),workflow))fail();await fence();
 store.record('workflow-intent',intent);store.record('workflow-create-ack',ack);store.record('workflow-created',result);return result;
}
export function normalizeOwnedN8nCloudExecutionWorkflow(plan,workflow,raw){
 if(![2,3,4,5,6,7,8].includes(plan.attempt))return normalizeOwnedN8nCloudWorkflow(plan,raw);
 const w=normalizeOwnedN8nCloudWorkflow(plan,workflow);
 if(!exact(raw,'id,name,nodes,connections,settings,nodeGroups')||raw.id!==w.id||!isDeepStrictEqual(raw.nodeGroups,[]))fail();
 const expected={id:w.id,name:w.name,nodes:structuredClone(w.nodes),connections:w.connections,settings:w.settings,nodeGroups:[]};
 expected.nodes[0].parameters.notice='';
 Object.assign(expected.nodes[1].parameters,{curlImport:'',provideSslCertificates:false,sendQuery:false,sendHeaders:false,sendBody:false,infoMessage:''});
 Object.assign(expected.nodes[1].parameters.options.response.response,{fullResponse:false,neverError:false});
 if(!isDeepStrictEqual(raw,expected))fail();return w;
}
export function validateOwnedN8nCloudExecution({plan,workflow,execution,serverReceipt}){
 validateOwnedN8nCloudPlan(plan);const w=normalizeOwnedN8nCloudWorkflow(plan,workflow),r=serverReceipt,e=execution;
 if(!exact(r,'version,kind,planDigest,challenge,receiptId,receivedAt,authenticated')||r.version!==1||r.kind!=='owned-n8n-cloud-authenticated'||r.planDigest!==cloudProofDigest(plan)||r.challenge!==plan.challenge||r.receiptId!==plan.receiptId||r.authenticated!==true)fail();
 const at=Date.parse(r.receivedAt),start=Date.parse(e?.startedAt),stop=Date.parse(e?.stoppedAt);
 if(!Number.isFinite(at)||at<Date.parse(plan.createdAt)||at>=Date.parse(plan.expiresAt)||!Number.isFinite(start)||!Number.isFinite(stop)||start<Date.parse(plan.createdAt)||stop<start||at<start||at>stop||stop>Date.parse(plan.expiresAt)+60000)fail();
 if(!id(e.id)||e.workflowId!==w.id||e.mode!=='manual'||e.usedPrivateCredentials!==false||e.status!=='success'||e.finished!==true||e.retryOf!=null||e.retrySuccessId!=null||e.waitTill!=null||e.data?.resultData?.error||e.workflowVersionId!==w.versionId||!same(normalizeOwnedN8nCloudExecutionWorkflow(plan,w,e.workflowData),w))fail();
 const result=e.data.resultData,run=result.runData;
 if(!exact(run,'Manual Trigger,Verify stored credential')||result.lastNodeExecuted!=='Verify stored credential')fail();
 for(const name of ['Manual Trigger','Verify stored credential']){
  const rows=run[name];if(!Array.isArray(rows)||rows.length!==1||rows[0]?.error||rows[0]?.executionStatus!=='success'||!Number.isFinite(rows[0].startTime)||!Number.isFinite(rows[0].executionTime))fail();
 }
 const output=run['Verify stored credential'][0].data;
 if(!exact(output,'main')||!Array.isArray(output.main)||output.main.length!==1||!Array.isArray(output.main[0])||output.main[0].length!==1)fail();
 const item=output.main[0][0],expected={version:1,status:'CREDENTIAL_POSSESSION_VERIFIED',challenge:plan.challenge,receiptId:plan.receiptId};
 if(!isDeepStrictEqual(item.json,expected)||item.binary!==undefined)fail();
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

export function validateOwnedN8nCloudWorkflowAdoption(plan,created,adoption,repairOperatorSha){
 const workflow=validateOwnedN8nCloudWorkflowCreated(plan,created);
 if(!/^[a-f0-9]{40}$/.test(repairOperatorSha??'')||repairOperatorSha===plan.operatorSha)fail();
 const expected={version:1,kind:'owned-n8n-cloud-workflow-adoption',planDigest:cloudProofDigest(plan),originOperatorSha:plan.operatorSha,repairOperatorSha,workflowDigest:cloudProofDigest(workflow),workflowId:workflow.id,workflowVersionId:workflow.versionId,creationOutcome:'OBSERVED_EXISTING',postRepeated:false};
 if(!same(adoption,expected))fail();return expected;
}
export async function adoptOwnedN8nCloudWorkflow(plan,{repairOperatorSha,workflowId},{request,store,fence,now=()=>Date.now()}){
 validateOwnedN8nCloudPlan(plan);await fence();
 if(!id(workflowId)||!/^[a-f0-9]{40}$/.test(repairOperatorSha??'')||repairOperatorSha===plan.operatorSha||now()<Date.parse(plan.createdAt)||now()>=Date.parse(plan.expiresAt))fail();
 const expectedIntent={version:1,planDigest:cloudProofDigest(plan),workflow:buildOwnedN8nCloudWorkflow(plan)};
 if(!same(store.value('workflow-intent',true),expectedIntent)||store.value('serve-intent',true)||store.value('workflow-delete-intent',true))fail();
 const matches=[],ids=new Set(),cursors=new Set();let cursor=null;
 for(let page=0;page<100;page++){
  const r=await request('GET','/api/v1/workflows?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
  if(r?.status!==200||!Array.isArray(r.body?.data)||r.body.data.length>100)fail();
  for(const row of r.body.data){if(!id(row?.id)||ids.has(row.id))fail();ids.add(row.id);if(row.name===expectedIntent.workflow.name)matches.push(row);}
  const next=r.body.nextCursor;
  if(next==null||next===''){cursor=null;break;}
  if(typeof next!=='string'||next.length>2048||cursors.has(next))fail();cursors.add(next);cursor=next;
 }
 if(cursor||matches.length!==1||matches[0].id!==workflowId)fail();
 const observe=async()=>{const r=await request('GET','/api/v1/workflows/'+workflowId);if(r?.status!==200)fail();const at=Date.parse(r.body.createdAt);if(!Number.isFinite(at)||at<Date.parse(plan.createdAt)||at>=Date.parse(plan.expiresAt)||r.body.sourceWorkflowId!=null)fail();return normalizeOwnedN8nCloudWorkflow(plan,r.body);};
 const workflow=await observe();await fence();if(!same(workflow,await observe()))fail();await fence();
 const created={version:1,planDigest:cloudProofDigest(plan),workflow};
 const prior=store.value('workflow-created',true),adoption=store.value('workflow-adoption',true);
 if(prior&&!same(prior,created))fail();
 const proof={version:1,kind:'owned-n8n-cloud-workflow-adoption',planDigest:cloudProofDigest(plan),originOperatorSha:plan.operatorSha,repairOperatorSha,workflowDigest:cloudProofDigest(workflow),workflowId,workflowVersionId:workflow.versionId,creationOutcome:'OBSERVED_EXISTING',postRepeated:false};
 if(adoption&&!same(adoption,proof))fail();validateOwnedN8nCloudWorkflowAdoption(plan,created,proof,repairOperatorSha);
 store.record('workflow-intent',expectedIntent);store.record('workflow-adoption',proof);store.record('workflow-created',created);await fence();return created;
}
