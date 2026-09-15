import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'blackspire-receiver-authority-'));
process.env.BLACKSPIRE_DATA_DIR=root;
process.env.BLACKSPIRE_DB_PATH=path.join(root,'authority.sqlite');
process.env.BLACKSPIRE_RUNTIME_MODE='test';
const {prepareDisposableDatabase}=await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const {run,get,all}=await import('../packages/task-engine/db.js');
const {upsertWorkspace,getWorkspace}=await import('../packages/workspace-registry/workspaces.js');
const {createUnifiedInput}=await import('../packages/unified-input/unified.js');
const {getTask,setFlag,prepareCapabilityDispatch,capabilityAttemptId}=await import('../packages/task-engine/tasks.js');
const {resolveAdminBearer}=await import('../packages/shared/authorization.js');
const {sellerOpportunityCapability}=await import('../packages/capabilities/seller-opportunities.js');
const {issueReceiverAuthority,consumeReceiverAuthority,receiverRequest}=await import('../packages/capabilities/receiver-authority.js');

const now=Date.now(), release={releaseSha:'a'.repeat(40),runId:'11111111-1111-4111-8111-111111111111',apiGeneration:'b'.repeat(32),workerGeneration:'c'.repeat(32)};
upsertWorkspace({id:'authority-ws',name:'authority-ws',githubRepository:'owner/repo',rootPath:'.',providerPolicy:{preferred:['mock']},budgetCents:1});
run('INSERT INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',['authority-admin','admin','authority-admin','bearer',null,'active',now,null,null,null,1,now]);
run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',['authority-grant','authority-admin','authority-ws','service',JSON.stringify(['seller.opportunities.read','task.create','task.execute','task.read','workspace.read']),'active',1,null,now,null,null,'test',1,now]);
setFlag('emergency_stop','inactive');

function fixture(){
 const created=createUnifiedInput({channel:'jarvis',actorId:'authority-admin',channelKey:`authority-${crypto.randomUUID()}`,workspaceId:'authority-ws',text:'Show seller opportunities',idempotencyKey:crypto.randomUUID(),authority:'authenticated_admin',executionIntent:'read_only'});
 const claim='claim-value',workerId='worker-authority';
 run("UPDATE tasks SET status='running',worker_id=?,claim_token=? WHERE id=?",[workerId,claim,created.taskId]);
 const task=getTask(created.taskId),attemptId=capabilityAttemptId(task.id,sellerOpportunityCapability.id),request=receiverRequest(sellerOpportunityCapability.id,'authority-ws',{limit:5});
 const issued=issueReceiverAuthority({task,attemptId,capability:sellerOpportunityCapability,workspace:getWorkspace('authority-ws'),principal:resolveAdminBearer('authority-admin'),ownership:{workerId,claimToken:claim},request},{context:()=>({role:'worker',...release}),random:()=> 'd'.repeat(43)});
 prepareCapabilityDispatch(task.id,sellerOpportunityCapability.id,{workspaceId:'authority-ws',principalId:'authority-admin',workerId,claimDigest:issued.persisted.claimDigest,input:{_limit:5},receiverAuthority:issued.persisted});
 return {task,attemptId,issued};
}

const apiContext=()=>({role:'api',...release});
const workerStatus=()=>({ok:true,state:'working',activeTask:true,generationId:release.workerGeneration});

function durableSnapshot(attemptId){
 return JSON.stringify({attempt:get('SELECT * FROM provider_attempts WHERE id=?',[attemptId]),usage:all('SELECT * FROM provider_usage ORDER BY id')});
}

function deniedWithoutMutation(issued,attemptId,options={}){
 const before=durableSnapshot(attemptId);
 assert.throws(()=>consumeReceiverAuthority(issued,{context:apiContext,workerStatus,...options}),/Receiver authority refused/);
 assert.equal(durableSnapshot(attemptId),before);
}

test('receiver authority is bound, single-use, and consumed before dispatch',()=>{
 const {attemptId,issued}=fixture();
 const result=consumeReceiverAuthority(issued.envelope,{context:apiContext,workerStatus});
 assert.equal(result.ok,true);assert.match(result.bindingDigest,/^[a-f0-9]{64}$/);
 assert.equal(get('SELECT status FROM provider_attempts WHERE id=?',[attemptId]).status,'started');
 assert.throws(()=>consumeReceiverAuthority(issued.envelope,{context:apiContext,workerStatus}),/Receiver authority refused/);
});

test('substitution, stale generation, malformed and missing authority deny without dispatch',()=>{
 for(const mutate of [
  a=>({...a,workspaceId:'other-ws'}),a=>({...a,principalId:'other-admin'}),a=>({...a,capabilityId:'buyer.profiles.search'}),
  a=>({...a,taskId:'other-task'}),a=>({...a,attemptId:'other-attempt'}),a=>({...a,workerGeneration:'e'.repeat(32)}),
  a=>({...a,permission:'workspace.manage'}),a=>({...a,principalSecurityVersion:2}),a=>({...a,grantId:'other-grant'}),
  a=>({...a,grantVersion:2}),a=>({...a,grantSecurityVersion:2}),a=>({...a,workerId:'other-worker'}),
  a=>({...a,claimDigest:'f'.repeat(64)}),a=>({...a,releaseSha:'f'.repeat(40)}),a=>({...a,releaseRunId:'other-run'}),
  a=>({...a,apiGeneration:'f'.repeat(32)}),a=>({...a,method:'GET'}),a=>({...a,path:'/api/internal/capabilities/deal-records'}),
  a=>({...a,bodySha256:'f'.repeat(64)}),a=>({...a,proof:'bad'}),a=>({...a,extra:'field'}),a=>{const {proof,...rest}=a;return rest;},
  a=>{const issuedAt=Date.now()-15001;return {...a,issuedAt,expiresAt:issuedAt+15000};},
  a=>{const issuedAt=Date.now()+1001;return {...a,issuedAt,expiresAt:issuedAt+15000};},
 ]){
  const {attemptId,issued}=fixture();
  deniedWithoutMutation(mutate(issued.envelope),attemptId);
 }
});

test('runtime fencing and emergency stop deny without consuming authority',()=>{
 for(const status of [
  {ok:false,state:'missing',activeTask:false,generationId:null},{ok:true,state:'draining',activeTask:true,generationId:release.workerGeneration},
  {ok:true,state:'idle',activeTask:false,generationId:release.workerGeneration},{ok:true,state:'working',activeTask:false,generationId:release.workerGeneration},
  {ok:true,state:'stopped',activeTask:false,generationId:'f'.repeat(32)},{ok:true,state:'working',activeTask:true,generationId:'f'.repeat(32)},
 ]){
  const {attemptId,issued}=fixture();
  deniedWithoutMutation(issued.envelope,attemptId,{workerStatus:()=>status});
 }
 const {attemptId,issued}=fixture();setFlag('emergency_stop','active');
 try{deniedWithoutMutation(issued.envelope,attemptId);}finally{setFlag('emergency_stop','inactive');}
});

test('changed durable principal, grant, task, attempt, and packet state deny without consume-side mutation',()=>{
 const cases=[
  {sql:"UPDATE auth_principals SET security_version=2 WHERE id='authority-admin'",restore:"UPDATE auth_principals SET security_version=1 WHERE id='authority-admin'"},
  {sql:"UPDATE auth_workspace_grants SET permissions='[\"task.read\"]' WHERE id='authority-grant'",restore:`UPDATE auth_workspace_grants SET permissions='["seller.opportunities.read","task.create","task.execute","task.read","workspace.read"]' WHERE id='authority-grant'`},
  {sql:"UPDATE auth_workspace_grants SET version=2 WHERE id='authority-grant'",restore:"UPDATE auth_workspace_grants SET version=1 WHERE id='authority-grant'"},
 ];
 for(const row of cases){const {attemptId,issued}=fixture();run(row.sql);try{deniedWithoutMutation(issued.envelope,attemptId);}finally{run(row.restore);}}
 for(const [column,value] of [['actor_id','other-admin'],['workspace_id','other-ws'],['worker_id','other-worker'],['claim_token','other-claim'],['status','cancelled']]){
  const {attemptId,issued,task}=fixture();run(`UPDATE tasks SET ${column}=? WHERE id=?`,[value,task.id]);deniedWithoutMutation(issued.envelope,attemptId);
 }
 for(const [column,value] of [['provider','other-provider'],['mode','buyer.profiles.search'],['status','completed'],['task_id','other-task']]){
  const {attemptId,issued}=fixture();run(`UPDATE provider_attempts SET ${column}=? WHERE id=?`,[value,attemptId]);deniedWithoutMutation(issued.envelope,attemptId);
 }
 const {attemptId,issued}=fixture();const packet=JSON.parse(get('SELECT request_packet FROM provider_attempts WHERE id=?',[attemptId]).request_packet);
 packet.receiverAuthority.bodySha256='f'.repeat(64);run('UPDATE provider_attempts SET request_packet=? WHERE id=?',[JSON.stringify(packet),attemptId]);deniedWithoutMutation(issued.envelope,attemptId);
});
