import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Isolated, credential-free test-mode environment for the bounded mock
// acceptance path. Proves the exact harmless case completes and that denial is
// enforced when any single required condition changes. No real provider, no
// credentials, no network, disposable SQLite.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-mockauth-'));
process.env.NODE_ENV = 'test';
process.env.UNIFIED_IPHONE_TEST_MODE = 'true';
process.env.UNIFIED_TEST_EXPIRES_AT = new Date(Date.now() + 60 * 60 * 1000).toISOString();
process.env.UNIFIED_TEST_WORKSPACE_ID = 'iphone-test';
process.env.UNIFIED_TEST_ACTOR_ID = 'iphone-test-operator';
process.env.UNIFIED_TEST_CHANNEL_KEY = 'iphone-test-chat';
process.env.UNIFIED_TEST_ACCESS_CODE = 'local-one-time-code';
process.env.BLACKSPIRE_DATA_DIR = root;
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'mockauth.sqlite');
process.env.UNIFIED_TEST_WORKSPACE_ROOT = root;
process.env.HERMES_TEST_PROVIDER = 'mock';
process.env.BLACKSPIRE_HERMES_MODE = 'mock';
process.env.TELEGRAM_MODE = 'mock';
process.env.WORKER_POLL_MS = '200';
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.CODEX_API_KEY;
delete process.env.GITHUB_TOKEN;
delete process.env.GH_TOKEN;
delete process.env.BLACKSPIRE_RUNTIME_MODE;

const { migrate } = await import('../packages/task-engine/db.js');
migrate();
const { authorizeReadOnlyTestTask } = await import('../packages/shared/testMode.js');
const { processTask } = await import('../packages/hermes/hermes.js');
const { getTask, taskRecords, createTask } = await import('../packages/task-engine/tasks.js');
const { createUnifiedInput, requestCancellation } = await import('../packages/unified-input/unified.js');
const { upsertWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { closeDb } = await import('../packages/task-engine/db.js');

// Seed the designated synthetic test workspace exactly as the server does under
// TEST_MODE: mock-only policy, no tools beyond status, disposable root.
upsertWorkspace({
  id: 'iphone-test', name: 'Unified Jarvis iPhone Test', description: 'Disposable read-only test workspace',
  githubRepository: 'local/iphone-test', defaultBranch: 'test', allowedPaths: [], buildCommands: [],
  providerPolicy: { preferred: ['mock'] }, riskLevel: 'low', budgetCents: 100, secretReferences: [],
  enabledTools: ['status'], lastHealthStatus: 'test', rootPath: root,
});

const DESIGNATED = { id: 'iphone-test', provider_policy: { preferred: ['mock'] } };
function validEnv(overrides = {}) {
  return {
    UNIFIED_IPHONE_TEST_MODE: 'true',
    UNIFIED_TEST_EXPIRES_AT: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    UNIFIED_TEST_WORKSPACE_ID: 'iphone-test',
    UNIFIED_TEST_ACCESS_CODE: 'local-one-time-code',
    NODE_ENV: 'test', HERMES_TEST_PROVIDER: 'mock', BLACKSPIRE_HERMES_MODE: 'mock', TELEGRAM_MODE: 'mock',
    BLACKSPIRE_DB_PATH: path.join(root, 'mockauth.sqlite'),
    ...overrides,
  };
}

/* ---------- unit: canonical authorization derives + verifies every condition ---------- */

test('authorizes the exact harmless bounded-mock case', () => {
  const auth = authorizeReadOnlyTestTask(DESIGNATED, validEnv());
  assert.equal(auth.ok, true, auth.reason);
});

test('denies when test mode is disabled (flag not literally true)', () => {
  assert.equal(authorizeReadOnlyTestTask(DESIGNATED, validEnv({ UNIFIED_IPHONE_TEST_MODE: 'false' })).ok, false);
  assert.equal(authorizeReadOnlyTestTask(DESIGNATED, validEnv({ UNIFIED_IPHONE_TEST_MODE: '1' })).ok, false);
});

test('denies a task in the wrong workspace', () => {
  const auth = authorizeReadOnlyTestTask({ id: 'blackspire-command', provider_policy: { preferred: ['mock'] } }, validEnv());
  assert.equal(auth.ok, false);
  assert.match(auth.reason, /designated synthetic test workspace/);
});

test('denies a missing workspace', () => {
  assert.equal(authorizeReadOnlyTestTask(null, validEnv()).ok, false);
  assert.equal(authorizeReadOnlyTestTask(undefined, validEnv()).ok, false);
});

test('denies a designated workspace that permits any non-mock provider', () => {
  assert.equal(authorizeReadOnlyTestTask({ id: 'iphone-test', provider_policy: { preferred: ['mock', 'openai'] } }, validEnv()).ok, false);
  assert.equal(authorizeReadOnlyTestTask({ id: 'iphone-test', provider_policy: { preferred: ['openai'] } }, validEnv()).ok, false);
  assert.equal(authorizeReadOnlyTestTask({ id: 'iphone-test', provider_policy: { preferred: [] } }, validEnv()).ok, false);
});

test('denies when the canonical test-mode config is invalid', () => {
  // missing one-time access code
  assert.equal(authorizeReadOnlyTestTask(DESIGNATED, validEnv({ UNIFIED_TEST_ACCESS_CODE: '' })).ok, false);
  // expiry in the past
  assert.equal(authorizeReadOnlyTestTask(DESIGNATED, validEnv({ UNIFIED_TEST_EXPIRES_AT: new Date(Date.now() - 1000).toISOString() })).ok, false);
  // expiry beyond the four-hour bound
  assert.equal(authorizeReadOnlyTestTask(DESIGNATED, validEnv({ UNIFIED_TEST_EXPIRES_AT: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString() })).ok, false);
  // not NODE_ENV=test
  assert.equal(authorizeReadOnlyTestTask(DESIGNATED, validEnv({ NODE_ENV: 'production' })).ok, false);
  // non-disposable database path
  assert.equal(authorizeReadOnlyTestTask(DESIGNATED, validEnv({ BLACKSPIRE_DB_PATH: '/var/lib/blackspire/prod.sqlite' })).ok, false);
});

test('denies when a real provider credential is present', () => {
  // Any truthy credential value trips the canonical check; values here are
  // deliberately not secret-shaped so the repo secret scanner stays quiet.
  assert.equal(authorizeReadOnlyTestTask(DESIGNATED, validEnv({ OPENAI_API_KEY: 'openai-key-present-for-test' })).ok, false);
  assert.equal(authorizeReadOnlyTestTask(DESIGNATED, validEnv({ ANTHROPIC_API_KEY: 'anthropic-key-present-for-test' })).ok, false);
  assert.equal(authorizeReadOnlyTestTask(DESIGNATED, validEnv({ GITHUB_TOKEN: 'github-token-present-for-test' })).ok, false);
});

test('denies when mock Hermes is not the configured provider or mode', () => {
  assert.equal(authorizeReadOnlyTestTask(DESIGNATED, validEnv({ HERMES_TEST_PROVIDER: 'openai' })).ok, false);
  assert.equal(authorizeReadOnlyTestTask(DESIGNATED, validEnv({ BLACKSPIRE_HERMES_MODE: 'restricted-test' })).ok, false);
});

test('denies when the runtime is production', () => {
  assert.equal(authorizeReadOnlyTestTask(DESIGNATED, validEnv({ BLACKSPIRE_RUNTIME_MODE: 'production' })).ok, false);
});

/* ---------- integration: the worker path completes or fails closed ---------- */

test('harmless happy-path command completes read-only with mock attribution', async () => {
  const result = createUnifiedInput({
    channel: 'jarvis', actorId: 'iphone-test-operator', channelKey: 'test-session:iphone-test-operator',
    conversationId: null, workspaceId: 'iphone-test', text: 'status check', idempotencyKey: 'happy-1', authority: 'test_operator',
  });
  assert.ok(result.conversationId?.startsWith('conv_'), 'canonical conversation id');
  assert.ok(result.taskId?.startsWith('task_'), 'canonical task id');
  assert.equal(result.status, 'queued');

  await processTask(getTask(result.taskId));
  const task = getTask(result.taskId);
  assert.equal(task.status, 'completed', task.error || 'expected completion');
  assert.deepEqual(JSON.parse(task.summary).changedFiles, [], 'read-only: no changed files');

  const rec = taskRecords(result.taskId);
  assert.equal(rec.providerAttempts.length, 1, 'exactly one provider attempt');
  assert.equal(rec.providerAttempts[0].provider, 'mock');
  assert.equal(rec.providerAttempts[0].mode, 'mock');
  assert.equal(rec.providerAttempts[0].status, 'completed');
  assert.match(rec.providerAttempts[0].response_packet, /mock-hermes-status-v1/, 'mock Hermes attribution');
});

test('follow-up in the same conversation reuses it and completes', async () => {
  const first = createUnifiedInput({ channel: 'jarvis', actorId: 'iphone-test-operator', channelKey: 'test-session:iphone-test-operator', conversationId: null, workspaceId: 'iphone-test', text: 'status check', idempotencyKey: 'reuse-1', authority: 'test_operator' });
  await processTask(getTask(first.taskId));
  const follow = createUnifiedInput({ channel: 'jarvis', actorId: 'iphone-test-operator', channelKey: 'test-session:iphone-test-operator', conversationId: first.conversationId, workspaceId: 'iphone-test', text: 'status check again', idempotencyKey: 'reuse-2', authority: 'test_operator' });
  assert.equal(follow.conversationId, first.conversationId, 'same canonical conversation');
  assert.notEqual(follow.taskId, first.taskId, 'distinct task');
  await processTask(getTask(follow.taskId));
  assert.equal(getTask(follow.taskId).status, 'completed');
});

test('a task in a non-designated workspace fails closed and never invokes a provider', async () => {
  const t = createTask({ workspaceId: 'blackspire-command', request: 'status check', idempotencyKey: 'unified:jarvis:wrong-1', budgetCents: 500, conversationId: null, inputId: null, sourceChannel: 'jarvis', actorId: 'x', actionClass: 'low_risk', authorityClass: 'authenticated_admin', policyDecision: 'allowed', initialStatus: 'queued' });
  await processTask(getTask(t.id));
  const done = getTask(t.id);
  assert.equal(done.status, 'failed');
  assert.match(done.error, /designated synthetic test workspace/);
  assert.equal(taskRecords(t.id).providerAttempts.length, 0, 'no provider invocation for a denied task');
});

test('a policy-prohibited request is denied at ingress and never dispatched', async () => {
  const denied = createUnifiedInput({ channel: 'jarvis', actorId: 'iphone-test-operator', channelKey: 'test-session:iphone-test-operator', conversationId: null, workspaceId: 'iphone-test', text: 'transfer funds to my account', idempotencyKey: 'denied-1', authority: 'test_operator' });
  assert.equal(denied.status, 'failed');
  assert.equal(denied.denied, true);
  await processTask(getTask(denied.taskId));
  const task = getTask(denied.taskId);
  assert.equal(task.status, 'failed');
  assert.equal(taskRecords(denied.taskId).providerAttempts.length, 0, 'prohibited request never reaches a provider');
});

test('replay of a completed task does not invoke a second provider call', async () => {
  const result = createUnifiedInput({ channel: 'jarvis', actorId: 'iphone-test-operator', channelKey: 'test-session:iphone-test-operator', conversationId: null, workspaceId: 'iphone-test', text: 'status check', idempotencyKey: 'replay-1', authority: 'test_operator' });
  await processTask(getTask(result.taskId));
  assert.equal(getTask(result.taskId).status, 'completed');
  const attemptsBefore = taskRecords(result.taskId).providerAttempts.length;
  // Re-run the same task: the duplicate-replay guard must block a second completed invocation.
  await processTask(getTask(result.taskId));
  const attemptsAfter = taskRecords(result.taskId).providerAttempts.filter((a) => a.status === 'completed').length;
  assert.equal(attemptsAfter, attemptsBefore, 'replay must not add a second completed provider attempt');
});

test('a cancelled task is not resurrected into completion', async () => {
  const result = createUnifiedInput({ channel: 'jarvis', actorId: 'iphone-test-operator', channelKey: 'test-session:iphone-test-operator', conversationId: null, workspaceId: 'iphone-test', text: 'status check', idempotencyKey: 'cancel-1', authority: 'test_operator' });
  const cancel = requestCancellation(result.taskId, { actor: 'iphone-test-operator' });
  assert.ok(cancel.task, 'cancellation recorded');
  await processTask(getTask(result.taskId));
  assert.equal(getTask(result.taskId).status, 'cancelled', 'cancelled task stays cancelled');
});

test('recorded evidence carries no raw credential-shaped content', () => {
  const result = createUnifiedInput({ channel: 'jarvis', actorId: 'iphone-test-operator', channelKey: 'test-session:iphone-test-operator', conversationId: null, workspaceId: 'iphone-test', text: 'status check', idempotencyKey: 'evidence-1', authority: 'test_operator' });
  const evidence = JSON.stringify(taskRecords(result.taskId).evidence);
  assert.doesNotMatch(evidence, /sk-[A-Za-z0-9]{20}|gh[pousr]_[A-Za-z0-9]{20}/, 'no credential-shaped strings in evidence');
});

test('close db', () => { closeDb(); });
