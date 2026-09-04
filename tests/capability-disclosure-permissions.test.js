import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-capability-disclosure-'));
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'disclosure.sqlite');
process.env.COMMAND_ADMIN_TOKEN = 'capability-disclosure-test-token';
process.env.SESSION_SECRET = 'capability-disclosure-session-secret-not-real';
process.env.ALLOW_BEARER_AUTH = 'true';
process.env.BLACKSPIRE_OPERATOR_PRINCIPAL_ID = 'disclosure-admin';

const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { run } = await import('../packages/task-engine/db.js');
const { upsertWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const {
  createTask,
  createApproval,
  recordTaskEvent,
  requiredCapabilityPermissionsForTask,
  requiredCapabilityPermissionsForConversation,
} = await import('../packages/task-engine/tasks.js');
const { start } = await import('../apps/api/server.js');

const workspaceId = 'disclosure-ws';
const now = Date.now();
const capabilityPermissions = [
  'seller.opportunities.read',
  'buyer.profiles.read',
  'buyer.matches.read',
  'deal.records.read',
  'deal.analysis.read',
  'nexus.enrichment.read',
];
const basePermissions = ['approval.grant', 'task.execute', 'task.read', 'workspace.read'];
const allPermissions = [...basePermissions, ...capabilityPermissions];

upsertWorkspace({ id: workspaceId, name: workspaceId, githubRepository: 'local/disclosure', rootPath: root, providerPolicy: {} });
run('INSERT INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', ['disclosure-admin', 'admin', 'disclosure-admin', 'bearer', null, 'active', now, null, null, null, 1, now]);
run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['disclosure-grant', 'disclosure-admin', workspaceId, 'service', JSON.stringify(allPermissions), 'active', 1, null, now, null, null, 'test', 1, now]);
run('INSERT INTO conversations VALUES(?,?,?,?,?)', ['disclosure-conversation', workspaceId, 'active', new Date().toISOString(), new Date().toISOString()]);
run('INSERT INTO conversations VALUES(?,?,?,?,?)', ['generic-conversation', workspaceId, 'active', new Date().toISOString(), new Date().toISOString()]);

const modes = [
  ['seller.opportunities.search', 'seller.opportunities.read'],
  ['buyer.profiles.search', 'buyer.profiles.read'],
  ['buyer.matches.search', 'buyer.matches.read'],
  ['deal.records.search', 'deal.records.read'],
  ['deal.analysis.get', 'deal.analysis.read'],
  ['nexus.enrichment.status', 'nexus.enrichment.read'],
];
const tasks = new Map();
for (const [mode] of modes) {
  const task = createTask({ workspaceId, request: `read ${mode}`, idempotencyKey: `disclosure-${mode}`, conversationId: 'disclosure-conversation' });
  run('UPDATE tasks SET status=?,summary=? WHERE id=?', ['completed', `sensitive result from ${mode}`, task.id]);
  run('INSERT INTO provider_attempts(id,task_id,provider,mode,status,response_packet,created_at) VALUES(?,?,?,?,?,?,?)', [`attempt-${mode}`, task.id, 'blackspire-capability', mode, 'completed', JSON.stringify({ sensitive: mode }), new Date().toISOString()]);
  createApproval(task.id, 'fixture', `approval for ${mode}`);
  recordTaskEvent(task.id, 'capability.completed', { sensitive: mode });
  tasks.set(mode, task.id);
}
const genericTask = createTask({ workspaceId, request: 'generic status', idempotencyKey: 'disclosure-generic', conversationId: 'generic-conversation' });

const server = start(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const headers = { authorization: 'Bearer capability-disclosure-test-token' };
const request = (pathname) => fetch(`${base}${pathname}`, { headers });
test.after(() => server.close());

test('persisted capability modes map deterministically to their exact disclosure permissions', () => {
  for (const [mode, permission] of modes) {
    assert.deepEqual(requiredCapabilityPermissionsForTask(tasks.get(mode)), [permission]);
  }
  assert.deepEqual(requiredCapabilityPermissionsForTask(genericTask.id), []);
  assert.deepEqual(requiredCapabilityPermissionsForConversation('disclosure-conversation'), [...capabilityPermissions].sort());
});

test('an unrecognized persisted capability mode fails closed instead of becoming a generic task', async () => {
  const task = createTask({ workspaceId, request: 'unknown future capability', idempotencyKey: 'disclosure-unknown' });
  run('INSERT INTO provider_attempts(id,task_id,provider,mode,status) VALUES(?,?,?,?,?)', ['attempt-unknown', task.id, 'blackspire-capability', 'future.sensitive.read', 'completed']);
  assert.deepEqual(requiredCapabilityPermissionsForTask(task.id), ['__unknown_capability_mode__']);
  assert.equal((await request(`/api/tasks/${task.id}`)).status, 404);
});

test('Nexus permission revocation closes every result-bearing read surface while generic tasks remain readable', async () => {
  const nexusTaskId = tasks.get('nexus.enrichment.status');
  run('UPDATE auth_workspace_grants SET permissions=? WHERE id=?', [JSON.stringify(allPermissions.filter((permission) => permission !== 'nexus.enrichment.read')), 'disclosure-grant']);

  for (const pathname of [
    `/api/tasks/${nexusTaskId}`,
    `/api/tasks/${nexusTaskId}/logs`,
    `/api/tasks/${nexusTaskId}/approvals`,
    `/api/tasks/${nexusTaskId}/export.json`,
    '/api/conversations/disclosure-conversation',
    '/api/conversations/disclosure-conversation/events',
  ]) assert.equal((await request(pathname)).status, 404, pathname);

  const listed = await (await request('/api/tasks')).json();
  assert.equal(listed.tasks.some((task) => task.id === nexusTaskId), false);
  assert.equal(listed.tasks.some((task) => task.id === genericTask.id), true);
  assert.equal((await request(`/api/tasks/${genericTask.id}`)).status, 200);
  assert.equal((await request('/api/conversations/generic-conversation/events')).status, 200);
});

test('each capability permission independently fences its task after completion', async () => {
  for (const [mode, permission] of modes) {
    run('UPDATE auth_workspace_grants SET permissions=? WHERE id=?', [JSON.stringify(allPermissions.filter((candidate) => candidate !== permission)), 'disclosure-grant']);
    assert.equal((await request(`/api/tasks/${tasks.get(mode)}`)).status, 404, `${mode} must require ${permission}`);
  }
  run('UPDATE auth_workspace_grants SET permissions=? WHERE id=?', [JSON.stringify(allPermissions), 'disclosure-grant']);
  for (const [mode] of modes) assert.equal((await request(`/api/tasks/${tasks.get(mode)}`)).status, 200, mode);
});
