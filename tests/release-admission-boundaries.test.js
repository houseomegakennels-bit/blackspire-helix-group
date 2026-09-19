import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {once} from 'node:events';
process.env.BLACKSPIRE_DB_PATH='.blackspire-command/release-admission-boundaries.sqlite';
process.env.COMMAND_ADMIN_TOKEN='synthetic-release-admission-test';
fs.rmSync(process.env.BLACKSPIRE_DB_PATH,{force:true});
const {prepareDisposableDatabase}=await import('./helpers/prepare-disposable-database.js');prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const db=await import('../packages/task-engine/db.js');
const tasks=await import('../packages/task-engine/tasks.js');
const unified=await import('../packages/unified-input/unified.js');
const telegram=await import('../apps/telegram/bot.js');
const {processTask}=await import('../packages/hermes/hermes.js');
const {startWorker}=await import('../apps/worker/worker.js');
const {start,beginGracefulShutdown,readinessSnapshot}=await import('../apps/api/server.js');
const tables=['tasks','conversations','conversation_bindings','unified_inputs','approvals','audit_events','provider_attempts','provider_usage','channel_deliveries'];
const snapshot=()=>tables.map(table=>db.all(`SELECT * FROM ${table} ORDER BY rowid`));
const hold=t=>{process.env.BLACKSPIRE_RELEASE_RUN_ID='';t.after(()=>{delete process.env.BLACKSPIRE_RELEASE_RUN_ID;});};

test('held direct/nested admissions, stale claims and approvals cannot mutate durable state',t=>{
  const task=tasks.createTask({workspaceId:'blackspire-command',request:'Show seller opportunities',idempotencyKey:'held-queue'});
  tasks.createApproval(task.id,'review','fixture');
  const stale=tasks.createTask({workspaceId:'blackspire-command',request:'Show active deals',idempotencyKey:'held-stale'});
  db.run("UPDATE tasks SET status='running',heartbeat_at='2000-01-01T00:00:00.000Z',claim_token='old-claim' WHERE id=?",[stale.id]);
  hold(t);const before=snapshot();
  for(const invoke of [()=>tasks.createTask({workspaceId:'blackspire-command',request:'queued'}),
    ()=>unified.createUnifiedInput({channel:'api',actorId:'fixture',channelKey:'held',text:'Show active deals',idempotencyKey:'held-input'}),
    ()=>tasks.claimNext({workerId:'would-claim',staleAfterSeconds:1}),()=>tasks.decideApproval(task.id,'approved'),()=>tasks.transition(stale.id,'queued')]){
    assert.throws(invoke,error=>error.code==='RELEASE_ADMISSION_HELD');assert.deepEqual(snapshot(),before);
  }
});
test('held worker still reports heartbeats but never claims, dispatches or sends outbox',async t=>{
  hold(t);let claims=0,dispatches=0,sends=0,beats=0;const before=snapshot();
  await startWorker({once:true,claimNextImpl:()=>{claims++;return {id:'never'};},processTaskImpl:async()=>{dispatches++;},deliverEventsImpl:async()=>{sends++;},recordHeartbeatImpl:()=>{beats++;}});
  assert.ok(beats>=2);assert.deepEqual([claims,dispatches,sends],[0,0,0]);assert.deepEqual(snapshot(),before);
});
test('held direct provider/Telegram paths deny before attachments, dispatch and retry bookkeeping',async t=>{
  hold(t);let sends=0;const before=snapshot();
  for(const invoke of [()=>processTask({id:'never',workspace_id:'blackspire-command'}),()=>unified.drainTelegramOutbox(async()=>{sends++;}),
    ()=>telegram.handleTelegramUpdate({}),()=>telegram.handleTelegramAttachment({}),()=>telegram.telegramGetFile('unused','unused'),
    ()=>telegram.telegramDownloadFile('unused','unused'),()=>telegram.sendTelegramMessage('unused',1,'unused'),
    ()=>telegram.sendTelegramDocument('unused',1,'/not-accessed'),()=>telegram.dispatchReply('unused',{})]){
    await assert.rejects(invoke,error=>error.code==='RELEASE_ADMISSION_HELD');assert.deepEqual(snapshot(),before);
  }
  assert.equal(sends,0);
});
test('actual HTTP blocks alternate mutation intake before body parsing; observation remains available',async t=>{
  const server=start(0,'127.0.0.1',{exitOnListenError:false});await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await beginGracefulShutdown(server,{deadlineMs:1000});});
  hold(t);const base=`http://127.0.0.1:${server.address().port}`,before=snapshot();
  for(const route of ['/api/tasks','/api/unified-input','/telegram/webhook','/api/test-mode/queued-task','/api/tasks/anything/approve','/api/tasks/anything/resume','/api/internal/buyer-writer/v1/jobs/anything/operations']){
    const response=await fetch(base+route,{method:'POST',body:'{malformed',signal:AbortSignal.timeout(1000)});
    assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'release admission held'});
  }
  assert.deepEqual(snapshot(),before);
  assert.equal((await fetch(base+'/health')).status,200);
  assert.equal((await fetch(base+'/api/auth/session')).status,200);
  const ready=readinessSnapshot();assert.equal(ready.checks.releaseAdmission,false);assert.equal(ready.ok,false);
});
