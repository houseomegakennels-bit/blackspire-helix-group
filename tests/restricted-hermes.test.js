import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-restricted-hermes-'));
process.env.BLACKSPIRE_DATA_DIR = root;
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'test.sqlite');
process.env.BLACKSPIRE_RUNTIME_MODE = 'mock';
process.env.BLACKSPIRE_HERMES_MODE = 'mock';
process.env.HERMES_TEST_PROVIDER = 'mock';
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

const { migrate } = await import('../packages/task-engine/db.js');
migrate();
const { upsertWorkspace, getWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { createTask, getTask, transition, setFlag, taskRecords, recordProviderAttempt } = await import('../packages/task-engine/tasks.js');
const { createHermesRequest, mockHermesResponse, validateHermesResponse } = await import('../packages/hermes/contract.js');
const { dispatchHermes } = await import('../packages/hermes/adapter.js');
const { guardDispatch, providerConfiguration } = await import('../packages/execution/dispatchGuard.js');
const { createUnifiedInput, requestCancellation } = await import('../packages/unified-input/unified.js');
const { processTask } = await import('../packages/hermes/hermes.js');
const { closeDb } = await import('../packages/task-engine/db.js');

upsertWorkspace({ id: 'restricted', name: 'Restricted', githubRepository: 'local/restricted', allowedPaths: [], buildCommands: [], providerPolicy: { preferred: ['mock'] }, budgetCents: 25, enabledTools: ['read','status'], rootPath: root });
const workspace = getWorkspace('restricted');
const makeTask = (suffix = Math.random()) => createTask({ workspaceId: workspace.id, request: 'report harmless status', idempotencyKey: `restricted-${suffix}`, budgetCents: 25, sourceChannel: 'api', authorityClass: 'authenticated_admin' });
const requestFor = (task) => createHermesRequest({ task, actorId: 'admin', workspace });

test('low-risk input reaches mock Hermes through the versioned contract', async () => {
  const task = makeTask('low'); const request = requestFor(task); const response = await dispatchHermes(request);
  assert.equal(response.provider, 'mock'); assert.equal(response.canonicalTaskId, task.id);
});

test('fake local restricted Hermes adapter accepts only loopback', async () => {
  const server = http.createServer(async (req, res) => { let body=''; for await (const chunk of req) body += chunk; res.end(JSON.stringify(mockHermesResponse(JSON.parse(body)))); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const priorMode=process.env.BLACKSPIRE_HERMES_MODE; const priorUrl=process.env.RESTRICTED_HERMES_URL;
  process.env.BLACKSPIRE_HERMES_MODE='restricted-test'; process.env.RESTRICTED_HERMES_URL=`http://127.0.0.1:${server.address().port}`;
  try { assert.equal((await dispatchHermes(requestFor(makeTask('local')))).provider, 'mock'); } finally { process.env.BLACKSPIRE_HERMES_MODE=priorMode; if (priorUrl===undefined) delete process.env.RESTRICTED_HERMES_URL; else process.env.RESTRICTED_HERMES_URL=priorUrl; await new Promise((resolve)=>server.close(resolve)); }
});

test('privileged and unknown privileged-looking input never reaches Hermes', () => {
  for (const [key,text] of [['priv','deploy production'],['unknown','enable mysterious repository control']]) {
    const result=createUnifiedInput({ channel:'telegram', actorId:'9001', channelKey:key, workspaceId:'restricted', text, idempotencyKey:key, authority:'telegram' });
    assert.equal(result.denied, true); assert.equal(taskRecords(result.taskId).providerAttempts.length,0);
  }
});

test('Hermes cannot change authority, identity, canonical IDs, budget, or provider', () => {
  const request=requestFor(makeTask('immut')); const base=mockHermesResponse(request);
  for (const patch of [{actorId:'other'},{channel:'telegram'},{workspaceId:'other'},{canonicalTaskId:'other'},{canonicalConversationId:'other'},{costCeilingCents:26},{provider:'openai'}]) assert.throws(()=>validateHermesResponse({...base,...patch},request,{allowedProviders:['mock']}));
});

test('malformed, oversized, unknown-version, and extra-field responses fail closed', () => {
  const request=requestFor(makeTask('schema')); const response=mockHermesResponse(request);
  assert.throws(()=>validateHermesResponse('{',request));
  assert.throws(()=>validateHermesResponse('x'.repeat(17000),request));
  assert.throws(()=>validateHermesResponse({...response,version:'2'},request));
  assert.throws(()=>validateHermesResponse({...response,approval:true},request));
});

test('credentials and paid fallback fail closed in mock/restricted test modes', () => {
  for (const value of ['', 'placeholder-key', 'dev-admin-token-change-me']) assert.equal(providerConfiguration({provider:'openai',mode:'api'},{env:{BLACKSPIRE_RUNTIME_MODE:'production',OPENAI_API_KEY:value},allowedProviders:['openai']}).ok,false);
  assert.equal(providerConfiguration({provider:'openai',mode:'api'},{env:{BLACKSPIRE_RUNTIME_MODE:'mock',OPENAI_API_KEY:'a'.repeat(30)},allowedProviders:['openai']}).ok,false);
  assert.equal(providerConfiguration({provider:'mock',mode:'mock'},{env:{BLACKSPIRE_RUNTIME_MODE:'restricted-test'},allowedProviders:['mock']}).ok,true);
});

test('shared guard blocks workspace, channel, cancellation, deadline, budget, emergency stop, invalid provider, and replay', () => {
  const cases=[];
  let task=makeTask('workspace'); cases.push(guardDispatch({task:{...task,id:'not-persisted',workspace_id:'other'},workspace,phase:'hermes'}));
  task=makeTask('channel'); cases.push(guardDispatch({task,workspace,channel:'telegram',phase:'hermes'}));
  task=createTask({workspaceId:'restricted',request:'safe',idempotencyKey:'actor',budgetCents:25,sourceChannel:'api',actorId:'canonical-actor',authorityClass:'authenticated_admin'}); cases.push(guardDispatch({task,workspace,actorId:'other-actor',phase:'hermes'}));
  task=makeTask('cancel'); transition(task.id,'cancelled'); cases.push(guardDispatch({task,workspace,phase:'hermes'}));
  task=makeTask('deadline'); cases.push(guardDispatch({task,workspace,deadline:new Date(0).toISOString(),phase:'hermes'}));
  task=createTask({workspaceId:'restricted',request:'safe',idempotencyKey:'zero',budgetCents:0,sourceChannel:'api',authorityClass:'authenticated_admin'}); cases.push(guardDispatch({task,workspace,phase:'hermes'}));
  task=makeTask('provider'); cases.push(guardDispatch({task,workspace,selected:{provider:'openai',mode:'api'},idempotencyKey:task.idempotency_key,allowedProviders:['mock']}));
  task=makeTask('replay'); recordProviderAttempt(task.id,{provider:'mock',mode:'mock',status:'completed',requestPacket:{idempotencyKey:task.idempotency_key}}); cases.push(guardDispatch({task,workspace,selected:{provider:'mock',mode:'mock'},idempotencyKey:task.idempotency_key,allowedProviders:['mock']}));
  setFlag('emergency_stop','active'); task=makeTask('stop'); cases.push(guardDispatch({task,workspace,phase:'hermes'})); setFlag('emergency_stop','inactive');
  assert.ok(cases.every((result)=>result.ok===false),JSON.stringify(cases));
});

test('pre-dispatch and mid-work cancellation are canonical and late completion cannot revive them', async () => {
  const task=makeTask('cancel-flow'); requestCancellation(task.id); await processTask(task); assert.equal(getTask(task.id).status,'cancelled'); assert.equal(taskRecords(task.id).providerAttempts.length,0);
  assert.equal(transition(task.id,'completed').status,'cancelled');
});

test('mock provider failure is bounded and evidence is sanitized', async () => {
  const task=makeTask('evidence'); const secret='sk-'+'sensitive-value-123456';
  recordProviderAttempt(task.id,{provider:'mock',mode:'mock',status:'failed',requestPacket:{authorization:`Bearer ${secret}`},responsePacket:{payload:secret},error:`token=${secret}`});
  const serialized=JSON.stringify(taskRecords(task.id)); assert.doesNotMatch(serialized,/sensitive-value/);
});

test.after(()=>{ closeDb(); fs.rmSync(root,{recursive:true,force:true}); });
