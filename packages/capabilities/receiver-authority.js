import crypto from 'node:crypto';
import {get,run,transaction} from '../task-engine/db.js';
import {getFlag} from '../task-engine/tasks.js';
import {activeGrant,hasCurrentWorkspacePermission,resolveAdminBearer} from '../shared/authorization.js';
import {currentReleaseAdmissionContext} from '../shared/release-admission.js';
import {workerRuntimeStatus} from '../task-engine/runtime-status.js';

export const RECEIVER_AUTHORITY_HEADER='x-blackspire-receiver-authority';
export const RECEIVER_AUTHORITY_REQUIRED=Symbol.for('blackspire.receiver-authority-required');
const ID=/^[A-Za-z0-9._:-]{1,256}$/;
const SHA=/^[a-f0-9]{64}$/;
const GEN=/^[a-f0-9]{32}$/;
const COMMIT=/^[a-f0-9]{40}$/;
const PROOF=/^[A-Za-z0-9_-]{43}$/;
const routes=Object.freeze({
 'seller.opportunities.search':'/api/internal/capabilities/seller-opportunities',
 'buyer.profiles.search':'/api/internal/capabilities/buyer-profiles',
 'buyer.matches.search':'/api/internal/capabilities/buyer-profiles',
 'deal.records.search':'/api/internal/capabilities/deal-records',
 'deal.analysis.get':'/api/internal/capabilities/deal-analysis',
 'nexus.enrichment.status':'/api/internal/capabilities/nexus-enrichment',
});
const permissions=Object.freeze({
 'seller.opportunities.search':'seller.opportunities.read','buyer.profiles.search':'buyer.profiles.read',
 'buyer.matches.search':'buyer.matches.read','deal.records.search':'deal.records.read',
 'deal.analysis.get':'deal.analysis.read','nexus.enrichment.status':'nexus.enrichment.read',
});
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=()=>{const error=new Error('Receiver authority refused');error.code='RECEIVER_AUTHORITY_REFUSED';throw error;};

export function receiverRequest(capabilityId,workspaceId,input){
 if(!Object.hasOwn(routes,capabilityId)||typeof workspaceId!=='string'||!ID.test(workspaceId)||!input||typeof input!=='object'||Array.isArray(input))fail();
 const body={workspaceId};
 if(capabilityId==='seller.opportunities.search'||capabilityId==='deal.records.search')body.limit=input.limit;
 else if(capabilityId==='deal.analysis.get')body.dealId=input.dealId;
 else if(capabilityId==='nexus.enrichment.status'){
  for(const key of ['ownerName','propertyAddress','sellerLeadId','dealId'])if(input[key])body[key]=input[key];
 }
 else {
  Object.assign(body,input);
  if(capabilityId==='buyer.matches.search')body.matchesOnly=true;
 }
 const bodyBytes=JSON.stringify(body),path=routes[capabilityId];
 if(Buffer.byteLength(bodyBytes)>32768)fail();
 return Object.freeze({method:'POST',path,body,bodyBytes,bodySha256:hash(bodyBytes)});
}

export function issueReceiverAuthority({task,attemptId,capability,workspace,principal,ownership,request},{
 context=currentReleaseAdmissionContext,now=Date.now,random=()=>crypto.randomBytes(32).toString('base64url'),
}={}){
 try{
  const release=context();
  const grant=activeGrant(principal.principalId,workspace.id),permission=permissions[capability.id],issuedAt=now();
  if(release.role!=='worker'||!grant||!permission||!hasCurrentWorkspacePermission(principal,workspace.id,permission)
   ||task.workspace_id!==workspace.id||task.actor_id!==principal.principalId||!ownership?.workerId||!ownership?.claimToken
   ||request.path!==routes[capability.id]||request.method!=='POST'||!SHA.test(request.bodySha256))fail();
  const proof=random();if(!PROOF.test(proof))fail();
  const authority={version:1,releaseSha:release.releaseSha,releaseRunId:release.runId,apiGeneration:release.apiGeneration,
   workerGeneration:release.workerGeneration,workspaceId:workspace.id,principalId:principal.principalId,
   principalSecurityVersion:principal.securityVersion,grantId:grant.id,grantVersion:grant.version,
   grantSecurityVersion:grant.security_version,capabilityId:capability.id,permission,taskId:task.id,attemptId,
   workerId:ownership.workerId,claimDigest:hash(ownership.claimToken),method:request.method,path:request.path,
   bodySha256:request.bodySha256,issuedAt,expiresAt:issuedAt+15000};
  validateReceiverAuthority({...authority,proof},{now:()=>issuedAt});
  return Object.freeze({envelope:Object.freeze({...authority,proof}),persisted:Object.freeze({...authority,proofDigest:hash(proof)})});
 }catch{fail();}
}

export function validateReceiverAuthority(value,{now=Date.now}={}){
 const expected=['version','releaseSha','releaseRunId','apiGeneration','workerGeneration','workspaceId','principalId','principalSecurityVersion',
  'grantId','grantVersion','grantSecurityVersion','capabilityId','permission','taskId','attemptId','workerId','claimDigest','method','path','bodySha256','issuedAt','expiresAt','proof'];
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==expected.sort().join(',')||value.version!==1
  ||!COMMIT.test(value.releaseSha??'')||!ID.test(value.releaseRunId??'')||!GEN.test(value.apiGeneration??'')||!GEN.test(value.workerGeneration??'')
  ||!['workspaceId','principalId','grantId','capabilityId','permission','taskId','attemptId','workerId'].every(k=>ID.test(value[k]??''))
  ||![value.principalSecurityVersion,value.grantVersion,value.grantSecurityVersion].every(n=>Number.isSafeInteger(n)&&n>=1)
  ||!SHA.test(value.claimDigest??'')||value.method!=='POST'||value.path!==routes[value.capabilityId]||value.permission!==permissions[value.capabilityId]
  ||!SHA.test(value.bodySha256??'')||!PROOF.test(value.proof??'')||!Number.isSafeInteger(value.issuedAt)||!Number.isSafeInteger(value.expiresAt)
  ||value.expiresAt-value.issuedAt!==15000||value.issuedAt>now()+1000||value.expiresAt<=now())fail();
 return structuredClone(value);
}

export function receiverAuthorityBindingDigest(value){
 const authority=validateReceiverAuthority(value);
 const {proof,...claims}=authority;
 return hash(JSON.stringify({...claims,proofDigest:hash(proof)}));
}

// Valid authority is consumed once with a final compare-and-swap. Every denial
// performs reads only and leaves the attempt, task, grants and runtime untouched.
export function consumeReceiverAuthority(value,{context=currentReleaseAdmissionContext,workerStatus=workerRuntimeStatus,now=Date.now}={}){
 try{
  const authority=validateReceiverAuthority(value,{now}),release=context();
  if(release.role!=='api'||!['releaseSha','runId','apiGeneration','workerGeneration'].every((key,index)=>
    release[key]===[authority.releaseSha,authority.releaseRunId,authority.apiGeneration,authority.workerGeneration][index]))fail();
  return transaction(()=>{
   const worker=workerStatus({workerId:authority.workerId,required:true});
   if(!worker.ok||worker.generationId!==authority.workerGeneration||worker.state!=='working'||worker.activeTask!==true)fail();
   const task=get('SELECT * FROM tasks WHERE id=?',[authority.taskId]);
   const attempt=get('SELECT * FROM provider_attempts WHERE id=?',[authority.attemptId]);
   const principal=resolveAdminBearer(authority.principalId),grant=activeGrant(authority.principalId,authority.workspaceId);
   let packet;try{packet=JSON.parse(attempt?.request_packet||'null');}catch{fail();}
   const {proof,...claims}=authority,persisted={...claims,proofDigest:hash(proof)};
   if(!task||task.status!=='running'||task.workspace_id!==authority.workspaceId||task.actor_id!==authority.principalId
    ||task.worker_id!==authority.workerId||hash(task.claim_token??'')!==authority.claimDigest
    ||!principal||principal.securityVersion!==authority.principalSecurityVersion||!grant||grant.id!==authority.grantId
    ||grant.version!==authority.grantVersion||grant.security_version!==authority.grantSecurityVersion
    ||!hasCurrentWorkspacePermission(principal,authority.workspaceId,authority.permission)
    ||!attempt||attempt.task_id!==authority.taskId||attempt.provider!=='blackspire-capability'||attempt.mode!==authority.capabilityId
    ||attempt.status!=='dispatching'||!same(packet?.receiverAuthority,persisted)||getFlag('emergency_stop')==='active')fail();
   const updated=run("UPDATE provider_attempts SET status='started' WHERE id=? AND status='dispatching'",[authority.attemptId]);
   if(Number(updated.changes)!==1)fail();
   return Object.freeze({ok:true,bindingDigest:hash(JSON.stringify(persisted))});
  });
 }catch{fail();}
}
