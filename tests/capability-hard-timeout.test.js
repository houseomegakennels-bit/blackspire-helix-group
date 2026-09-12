import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-capability-hard-timeout-'));
process.env.BLACKSPIRE_DATA_DIR = root;
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'capability-hard-timeout.sqlite');
process.env.BLACKSPIRE_RUNTIME_MODE = 'test';
delete process.env.UNIFIED_IPHONE_TEST_MODE;

const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { run } = await import('../packages/task-engine/db.js');
const { upsertWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { createUnifiedInput } = await import('../packages/unified-input/unified.js');
const { getTask, taskRecords, transition } = await import('../packages/task-engine/tasks.js');
const { processTask } = await import('../packages/hermes/hermes.js');
const { createCapabilityRegistry } = await import('../packages/capabilities/registry.js');
const { sellerOpportunityCapability } = await import('../packages/capabilities/seller-opportunities.js');

const workspaceId = 'hard-timeout-ws';
const actorId = 'hard-timeout-admin';
const now = Date.now();
upsertWorkspace({ id: workspaceId, name: workspaceId, githubRepository: 'houseomegakennels-bit/blackspire-helix-group', rootPath: '.', providerPolicy: { preferred: ['mock'] }, budgetCents: 500 });
run('INSERT INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [actorId, 'admin', actorId, 'bearer', null, 'active', now, null, null, null, 1, now]);
run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['hard-timeout-grant', actorId, workspaceId, 'service', JSON.stringify(['seller.opportunities.read', 'task.create', 'task.execute', 'task.read', 'workspace.read']), 'active', 1, null, now, null, null, 'test', 1, now]);

function createTask(suffix) {
  const created = createUnifiedInput({ channel: 'jarvis', actorId, channelKey: `hard-timeout-${suffix}`, workspaceId, text: 'Show seller opportunities.', idempotencyKey: `hard-timeout-${suffix}`, authority: 'authenticated_admin', executionIntent: 'read_only' });
  return getTask(created.taskId);
}

function registryWith(execute, timeoutMs = 100) {
  return createCapabilityRegistry([{ ...sellerOpportunityCapability, timeoutMs, execute }]);
}

const canonicalResult = () => ({ opportunities: [], sourceSnapshotAt: '2026-09-04T00:00:00.000Z' });

test('hard timeout returns naturally and fences a non-cooperative late result', async () => {
  const created = createTask('late-result');
  let release;
  let adapterSignal;
  const adapterResult = new Promise((resolve) => { release = () => resolve(canonicalResult()); });
  const started = Date.now();
  const result = await processTask(created, {
    capabilityOptions: {
      registry: registryWith(async ({ signal }) => { adapterSignal = signal; return adapterResult; }),
    },
  });

  assert.equal(result.status, 'outcome_unknown');
  assert.match(result.error, /timed out.*automatic replay refused/i);
  assert.equal(adapterSignal.aborted, true);
  assert.ok(Date.now() - started < 1_000, 'authoritative execution must not await the non-cooperative adapter');
  const recordsAtTimeout = taskRecords(created.id);
  assert.equal(recordsAtTimeout.providerAttempts[0].status, 'outcome_unknown');
  assert.ok(recordsAtTimeout.evidence.some((row) => row.kind === 'capability_timeout'));
  assert.ok(recordsAtTimeout.evidence.some((row) => row.kind === 'capability_late_response_ignored'));

  release();
  await new Promise((resolve) => setImmediate(resolve));
  const afterLateResult = getTask(created.id);
  assert.equal(afterLateResult.status, 'outcome_unknown');
  assert.equal(afterLateResult.summary || null, null);

  let replayCalls = 0;
  const replay = await processTask({ ...afterLateResult, status: 'queued' }, {
    capabilityOptions: { registry: registryWith(async () => { replayCalls += 1; return canonicalResult(); }) },
  });
  assert.equal(replay.status, 'outcome_unknown');
  assert.equal(replayCalls, 0);
  assert.equal(taskRecords(created.id).providerAttempts.length, 1);
});

test('external AbortSignal listener is removed with the callback that was added', async () => {
  const created = createTask('listener-cleanup');
  let addedCallback;
  let removedCallback;
  const externalSignal = {
    aborted: false,
    addEventListener(type, callback) { assert.equal(type, 'abort'); addedCallback = callback; },
    removeEventListener(type, callback) { assert.equal(type, 'abort'); removedCallback = callback; },
  };
  const result = await processTask(created, {
    capabilityOptions: {
      signal: externalSignal,
      registry: registryWith(async () => canonicalResult(), 500),
    },
  });
  assert.equal(result.status, 'completed');
  assert.equal(typeof addedCallback, 'function');
  assert.equal(removedCallback, addedCallback);
});

test('cancellation before adapter subscription does not dispatch or leave an unhandled abort', async () => {
  const created = createTask('cancel-before-adapter');
  let calls = 0;
  const result = await processTask(created, {
    capabilityOptions: {
      beforeAdapter: () => transition(created.id, 'cancelled', { error: 'operator cancelled' }),
      registry: registryWith(async () => { calls += 1; return canonicalResult(); }),
    },
  });
  assert.equal(result.status, 'cancelled');
  assert.equal(calls, 0);
  assert.equal(result.summary || null, null);
  await new Promise((resolve) => setImmediate(resolve));
});

test('an already-aborted external signal prevents adapter dispatch', async () => {
  const created = createTask('already-aborted');
  let calls = 0;
  const result = await processTask(created, {
    capabilityOptions: {
      signal: AbortSignal.abort(),
      registry: registryWith(async () => { calls += 1; return canonicalResult(); }),
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.status, 'failed');
  assert.equal(result.summary || null, null);
});

test('an abort queued before the adapter microtask prevents dispatch', async () => {
  const created = createTask('abort-before-microtask');
  const controller = new AbortController();
  let calls = 0;
  const result = await processTask(created, {
    capabilityOptions: {
      signal: controller.signal,
      beforeAdapter: () => queueMicrotask(() => controller.abort()),
      registry: registryWith(async () => { calls += 1; return canonicalResult(); }),
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.status, 'failed');
  assert.equal(result.summary || null, null);
});
