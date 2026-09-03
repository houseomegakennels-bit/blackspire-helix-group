import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-buyer-cancel-'));
process.env.BLACKSPIRE_DATA_DIR = root;
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'buyer-cancel.sqlite');
process.env.BLACKSPIRE_RUNTIME_MODE = 'test';
delete process.env.UNIFIED_IPHONE_TEST_MODE;

const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { run, all } = await import('../packages/task-engine/db.js');
const { upsertWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { createUnifiedInput } = await import('../packages/unified-input/unified.js');
const { getTask, transition, setFlag, taskRecords } = await import('../packages/task-engine/tasks.js');
const { processTask } = await import('../packages/hermes/hermes.js');

const permissions = ['buyer.profiles.read','buyer.matches.read','task.create','task.execute','task.read','workspace.read'];
upsertWorkspace({ id: 'buyer-ws', name: 'buyer-ws', githubRepository: 'houseomegakennels-bit/blackspire-helix-group', rootPath: '.', providerPolicy: { preferred: ['mock'] }, budgetCents: 500 });
run('INSERT INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', ['buyer-admin','admin','buyer-admin','bearer',null,'active',Date.now(),null,null,null,1,Date.now()]);
run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['buyer-grant','buyer-admin','buyer-ws','service',JSON.stringify(permissions),'active',1,null,Date.now(),null,null,'test',1,Date.now()]);

function task(text, overrides = {}) {
  const created = createUnifiedInput({ channel:'jarvis', actorId:'buyer-admin', channelKey:`cancel-${crypto.randomUUID()}`, workspaceId:'buyer-ws', text, idempotencyKey:`cancel-${crypto.randomUUID()}`, authority:'authenticated_admin', executionIntent:'read_only', ...overrides });
  return getTask(created.taskId);
}

function delayedAdapter(result, signal, delayMs = 200) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(result), delayMs);
    const onAbort = () => { clearTimeout(timer); reject(new Error('aborted')); };
    signal?.addEventListener?.('abort', onAbort, { once: true });
    return { release: () => clearTimeout(timer), done: () => resolve(result) };
  });
}

test('late cancellation while adapter is pending does not disclose Buyer data', async () => {
  const created = task('Find buyers with cancellation race.');
  const pending = processTask(created, { capabilityOptions:{ adapters:{ buyerProfiles:async ({ signal })=>{ const delayed = delayedAdapter({ profiles:[{ displayName:'ABC Capital', source:'buyer_group_registry' }], matches:[], sourceSnapshotAt:'2026-09-02T00:00:00.000Z' }, signal, 500); await new Promise((resolve)=>setImmediate(resolve)); return await delayed; } } } });
  await new Promise((resolve)=>setTimeout(resolve, 50));
  transition(created.id, 'cancelled', { error:'operator cancelled' });
  const result = await pending;
  assert.ok(result);
  assert.ok(['cancelled','failed'].includes(result.status));
  assert.doesNotMatch(String(result?.summary||'') + ' ' + String(result?.error||''), /ABC Capital/);
});

test('emergency stop while adapter is pending prevents Buyer finalization', async () => {
  const created = task('Find buyers with cancellation timing test.');
  const pending = processTask(created, { capabilityOptions:{ adapters:{ buyerProfiles:async ({ signal })=>{ const delayed = delayedAdapter({ profiles:[{ displayName:'ABC Capital', source:'buyer_group_registry' }], matches:[], sourceSnapshotAt:'2026-09-02T00:00:00.000Z' }, signal, 500); await new Promise((resolve)=>setImmediate(resolve)); return await delayed; } } } });
  await new Promise((resolve)=>setTimeout(resolve, 50));
  setFlag('emergency_stop','active');
  try {
    const result = await pending;
    assert.ok(result);
    assert.ok(['cancelled','failed'].includes(result.status));
    assert.doesNotMatch(String(result?.summary||'') + ' ' + String(result?.error||''), /ABC Capital/);
  } finally {
    setFlag('emergency_stop','inactive');
  }
});
