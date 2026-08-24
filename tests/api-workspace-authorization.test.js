import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-api-authz-'));
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'authz.sqlite');
process.env.COMMAND_ADMIN_TOKEN = 'workspace-authz-test-token';
process.env.SESSION_SECRET = 'workspace-authz-session-secret-not-real-000000';
process.env.ALLOW_BEARER_AUTH = 'true';
process.env.BLACKSPIRE_OPERATOR_PRINCIPAL_ID = 'route-operator';

const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { run } = await import('../packages/task-engine/db.js');
const { upsertWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { createTask, createApproval, recordEvidence } = await import('../packages/task-engine/tasks.js');
const { createUnifiedInput } = await import('../packages/unified-input/unified.js');
const { insertWorkflowRun, insertProviderInvocation } = await import('../packages/hermes-orchestrator/store.js');
const { start } = await import('../apps/api/server.js');

const now = Date.now();
const permissions = ['approval.grant', 'runtime.read', 'task.create', 'task.execute', 'task.read', 'workspace.read'];
run('INSERT INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', ['route-operator', 'admin', 'route-operator', 'bearer', null, 'active', now, null, null, null, 1, now]);
run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['route-grant-a', 'route-operator', 'workspace-a', 'service', JSON.stringify(permissions), 'active', 1, null, now, null, null, 'test', 1, now]);
for (const id of ['workspace-a', 'workspace-b']) upsertWorkspace({ id, name: id, githubRepository: `local/${id}`, defaultBranch: 'main', allowedPaths: ['docs'], buildCommands: [], providerPolicy: {}, riskLevel: 'low', budgetCents: 100, secretReferences: [], enabledTools: ['read'], lastHealthStatus: 'ok', rootPath: root });

const taskA = createTask({ workspaceId: 'workspace-a', request: 'inspect A', idempotencyKey: 'route-task-a' });
const taskB = createTask({ workspaceId: 'workspace-b', request: 'inspect B', idempotencyKey: 'route-task-b' });
createApproval(taskA.id, 'high_risk_execution', 'test approval');
createApproval(taskB.id, 'high_risk_execution', 'test approval');
recordEvidence(taskA.id, 'test', { workspace: 'a' });
recordEvidence(taskB.id, 'test', { workspace: 'b' });
const conversationA = createUnifiedInput({ channel: 'jarvis', actorId: 'fixture', channelKey: 'fixture-a', workspaceId: 'workspace-a', text: 'inspect status', idempotencyKey: 'route-conv-a' });
const conversationB = createUnifiedInput({ channel: 'jarvis', actorId: 'fixture', channelKey: 'fixture-b', workspaceId: 'workspace-b', text: 'inspect status', idempotencyKey: 'route-conv-b' });
const runtimeRunA = insertWorkflowRun({ id: 'route-run-a', taskId: taskA.id, workspaceId: 'workspace-a', actorId: 'fixture', channel: 'jarvis', objective: 'A', provider: 'mock' });
const runtimeRunB = insertWorkflowRun({ id: 'route-run-b', taskId: taskB.id, workspaceId: 'workspace-b', actorId: 'fixture', channel: 'jarvis', objective: 'B', provider: 'mock' });
insertProviderInvocation(runtimeRunA, taskA.id, { provider: 'mock', mode: 'mock', status: 'completed' });
insertProviderInvocation(runtimeRunB, taskB.id, { provider: 'mock', mode: 'mock', status: 'completed' });

const server = start(0, '127.0.0.1', { exitOnListenError: false });
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const bearer = { authorization: 'Bearer workspace-authz-test-token' };
const request = (pathname, options = {}) => fetch(`${base}${pathname}`, { ...options, headers: { ...bearer, ...(options.headers || {}) } });

test.after(() => server.close());

test('lists only workspaces and tasks authorized by current persisted grants', async () => {
  const workspaces = await (await request('/api/workspaces')).json();
  assert.deepEqual(workspaces.workspaces.map((workspace) => workspace.id), ['workspace-a']);
  const tasks = await (await request('/api/tasks')).json();
  assert.ok(tasks.tasks.length >= 2);
  assert.ok(tasks.tasks.every((task) => task.workspace_id === 'workspace-a'));
});

test('task reads, conversations, evidence, and attempt-bearing task records hide workspace B', async () => {
  assert.equal((await request(`/api/tasks/${taskA.id}`)).status, 200);
  assert.equal((await request(`/api/tasks/${taskB.id}`)).status, 404);
  assert.equal((await request(`/api/tasks/${taskA.id}/logs`)).status, 200);
  assert.equal((await request(`/api/tasks/${taskB.id}/logs`)).status, 404);
  assert.equal((await request(`/api/tasks/${taskA.id}/export.json`)).status, 200);
  assert.equal((await request(`/api/tasks/${taskB.id}/export.json`)).status, 404);
  assert.equal((await request(`/api/conversations/${conversationA.conversationId}`)).status, 200);
  assert.equal((await request(`/api/conversations/${conversationB.conversationId}`)).status, 404);
  assert.equal((await request(`/api/conversations/${conversationB.conversationId}/events`)).status, 404);
});

test('creation and unified input enforce the target workspace before mutation', async () => {
  const before = await (await request('/api/tasks')).json();
  assert.equal((await request('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: 'workspace-a', request: 'inspect A now' }) })).status, 202);
  assert.equal((await request('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: 'workspace-b', request: 'inspect B now' }) })).status, 404);
  assert.equal((await request('/api/unified-input', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: 'workspace-b', text: 'inspect B now' }) })).status, 404);
  const after = await (await request('/api/tasks')).json();
  assert.equal(after.tasks.length, before.tasks.length + 1);
});

test('execute, approval, cancellation, and runtime operations cannot substitute workspace B', async () => {
  assert.equal((await request(`/api/tasks/${taskB.id}/resume`, { method: 'POST' })).status, 404);
  assert.equal((await request(`/api/tasks/${taskB.id}/approve`, { method: 'POST' })).status, 404);
  assert.equal((await request(`/api/tasks/${taskB.id}/reject`, { method: 'POST' })).status, 404);
  assert.equal((await request(`/api/tasks/${taskB.id}/cancel`, { method: 'POST' })).status, 404);
  const runtime = await request('/api/hermes/runtime?workspaceId=workspace-a');
  assert.equal(runtime.status, 200);
  const runtimeBody = await runtime.json();
  assert.ok(runtimeBody.recentRuns.every((run) => run.workspaceId === 'workspace-a'));
  assert.equal(runtimeBody.recentInvocations.length, 1);
  assert.equal((await request('/api/hermes/runtime?workspaceId=workspace-b')).status, 404);
  assert.equal((await request('/api/hermes/runtime?workspaceId=absent')).status, 404);
  assert.equal((await request('/api/stop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: 'workspace-b' }) })).status, 404);
});

test('revoked grants fail closed and session rotation does not resurrect authority', async () => {
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: 'workspace-authz-test-token' }) });
  const cookies = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  const loginBody = await login.json();
  run("UPDATE auth_workspace_grants SET status='revoked',revoked_at=? WHERE id='route-grant-a'", [Date.now()]);
  assert.equal((await fetch(`${base}/api/tasks/${taskA.id}`, { headers: { cookie: cookies } })).status, 404);
  const rotated = await fetch(`${base}/api/auth/rotate`, { method: 'POST', headers: { cookie: cookies, 'x-csrf-token': loginBody.csrfToken } });
  assert.equal(rotated.status, 200);
  const rotatedCookies = rotated.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  assert.equal((await fetch(`${base}/api/tasks/${taskA.id}`, { headers: { cookie: rotatedCookies } })).status, 404);
});
