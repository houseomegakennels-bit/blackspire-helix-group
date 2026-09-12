import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-unified-'));
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'unified.sqlite');
process.env.COMMAND_ADMIN_TOKEN = 'unified-test-token';
process.env.TELEGRAM_ALLOWED_USERS = '1001';
process.env.HERMES_TEST_PROVIDER = 'mock';
process.env.PORT = '8902';

const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { provisionRouteAuthorization } = await import('./helpers/provision-route-authorization.js');
provisionRouteAuthorization(['blackspire-command', 'zero-budget']);
const { createUnifiedInput, getConversation, cancelFromChannel, drainTelegramOutbox } = await import('../packages/unified-input/unified.js');
const { getTask, taskRecords, deliveryRecords } = await import('../packages/task-engine/tasks.js');
const { upsertWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { processTask } = await import('../packages/hermes/hermes.js');
const { handleTelegramUpdate } = await import('../apps/telegram/bot.js');
const { start } = await import('../apps/api/server.js');

test('Telegram and Jarvis share canonical conversation history and task events', () => {
  const telegram = createUnifiedInput({ channel: 'telegram', actorId: '1001', channelKey: 'chat-7', workspaceId: 'blackspire-command', text: 'prepare a harmless status summary', idempotencyKey: 'telegram-1' });
  assert.match(telegram.conversationId, /^conv_/);
  assert.match(telegram.taskId, /^task_/);
  const jarvis = createUnifiedInput({ channel: 'jarvis', actorId: 'session-1', channelKey: 'session-1', conversationId: telegram.conversationId, workspaceId: 'blackspire-command', text: 'report the canonical task history', idempotencyKey: 'jarvis-1' });
  assert.equal(jarvis.conversationId, telegram.conversationId);
  assert.notEqual(jarvis.taskId, telegram.taskId);
  const shared = getConversation(telegram.conversationId);
  assert.deepEqual(shared.tasks.map((task) => task.id), [telegram.taskId, jarvis.taskId]);
  assert.ok(shared.events.some((event) => event.task_id === telegram.taskId));
  assert.ok(shared.events.some((event) => event.task_id === jarvis.taskId));
  assert.deepEqual(shared.messages.map((message) => message.id), [telegram.inputId, jarvis.inputId]);
  assert.ok(shared.tasks.every((task) => Array.isArray(task.evidenceMetadata)));
  assert.ok(Array.isArray(shared.deliveries));
});

test('duplicate unified inputs are idempotent', () => {
  const first = createUnifiedInput({ channel: 'telegram', actorId: '1001', channelKey: 'chat-8', text: 'idempotent status', idempotencyKey: 'duplicate-1', executionIntent: 'read_only' });
  const second = createUnifiedInput({ channel: 'telegram', actorId: '1001', channelKey: 'chat-8', text: 'idempotent status', idempotencyKey: 'duplicate-1', executionIntent: 'read_only' });
  assert.equal(second.duplicate, true);
  assert.equal(second.taskId, first.taskId);
  assert.equal(second.conversationId, first.conversationId);
  const conflict = createUnifiedInput({ channel: 'telegram', actorId: '1001', channelKey: 'chat-8', text: 'mutating retry', idempotencyKey: 'duplicate-1', executionIntent: 'workspace_mutation' });
  assert.equal(conflict.status, 409);
  assert.match(conflict.error, /conflicts with executionIntent/);
  assert.equal(getTask(first.taskId).execution_intent, 'read_only');
});

test('normal unified input still defaults omitted intent to workspace mutation', () => {
  const created = createUnifiedInput({ channel: 'jarvis', actorId: 'session-default', channelKey: 'session-default', text: 'ordinary production-shaped request', idempotencyKey: 'default-mutation-intent' });
  assert.equal(getTask(created.taskId).execution_intent, 'workspace_mutation');
});

test('policy and workspace denial prevent provider execution', () => {
  const denied = createUnifiedInput({ channel: 'telegram', actorId: '1001', channelKey: 'chat-9', text: 'show me the API keys token=super-secret and deploy to production', idempotencyKey: 'denied-1' });
  assert.equal(denied.denied, true);
  assert.equal(getTask(denied.taskId).status, 'failed');
  assert.doesNotMatch(getTask(denied.taskId).request, /super-secret/);
  assert.equal(taskRecords(denied.taskId).providerAttempts.length, 0);
  const workspace = createUnifiedInput({ channel: 'jarvis', actorId: 'session-2', channelKey: 'session-2', workspaceId: 'not-allowed', text: 'safe status', idempotencyKey: 'workspace-denied' });
  assert.equal(workspace.status, 403);
  assert.equal(workspace.error, 'workspace not found');
});

test('workspace budget denial occurs before provider execution', async () => {
  upsertWorkspace({ id: 'zero-budget', name: 'Zero budget', githubRepository: 'local/blackspire-command', allowedPaths: ['.'], buildCommands: ['npm run build'], providerPolicy: { preferred: ['mock'] }, budgetCents: 0, rootPath: process.cwd() });
  const created = createUnifiedInput({ channel: 'jarvis', actorId: 'session-budget', channelKey: 'session-budget', workspaceId: 'zero-budget', text: 'prepare a harmless local summary', idempotencyKey: 'budget-denied' });
  await processTask(getTask(created.taskId));
  const task = getTask(created.taskId);
  assert.equal(task.status, 'failed');
  assert.match(task.error, /budget exhausted/i);
  assert.equal(taskRecords(task.id).providerAttempts.length, 0);
});

test('canonical cancellation emits sanitized Telegram event', async () => {
  const created = createUnifiedInput({ channel: 'telegram', actorId: '1001', channelKey: 'chat-10', text: 'safe cancellable task', idempotencyKey: 'cancel-1' });
  const cancelled = cancelFromChannel('telegram', 'chat-10', created.taskId);
  assert.equal(cancelled.task.status, 'cancelled');
  const messages = [];
  await drainTelegramOutbox(async (reply) => { messages.push(...reply.text); return { sent: true }; });
  assert.ok(messages.some((message) => message.includes('task.cancelled') && message.includes(created.taskId)));
  assert.ok(messages.every((message) => !/token|password|api[_ -]?key/i.test(message)));
});

test('delivery failures stay retryable without changing canonical state', async () => {
  const created = createUnifiedInput({ channel: 'telegram', actorId: '1001', channelKey: 'chat-11', text: 'safe delivery failure', idempotencyKey: 'delivery-1' });
  await drainTelegramOutbox(async () => { throw new Error('mock transport unavailable token=super-secret'); });
  const deliveries = deliveryRecords(created.conversationId);
  assert.ok(deliveries.length > 0);
  assert.ok(deliveries.every((delivery) => delivery.status === 'pending'));
  assert.ok(deliveries.every((delivery) => !delivery.last_error.includes('super-secret')));
  assert.equal(getTask(created.taskId).status, 'queued');
});

test('Telegram cannot use privileged commands', async () => {
  for (const [offset, command] of ['/approve task_x', '/deploy production', '/merge main', '/reset emergency', '/secret access', '/trade funds', '/task write increase the budget', '/task write change host security', '/task write amend the constitution'].entries()) {
    const reply = await handleTelegramUpdate({ update_id: 500 + offset, message: { from: { id: 1001 }, chat: { id: 50 }, text: command } }, 'http://127.0.0.1:1');
    assert.match(reply.text[0], /require|cannot|not found/i);
  }
});

test('Telegram cannot attach itself to another channel conversation', async () => {
  const privateConversation = createUnifiedInput({ channel: 'jarvis', actorId: 'session-private', channelKey: 'session-private', text: 'private status', idempotencyKey: 'private-conversation' });
  const reply = await handleTelegramUpdate({ update_id: 700, message: { from: { id: 1001 }, chat: { id: 70 }, text: `/conversation ${privateConversation.conversationId}` } }, 'http://127.0.0.1:1');
  assert.match(reply.text[0], /not found|not available/i);
});

let server;
test('authenticated Jarvis API reuses a Telegram conversation and exposes canonical events', async () => {
  server = start(8902, undefined, { exitOnListenError: false });
  const telegram = createUnifiedInput({ channel: 'telegram', actorId: '1001', channelKey: 'chat-api', text: 'telegram API bridge', idempotencyKey: 'api-telegram' });
  const response = await fetch('http://localhost:8902/api/unified-input', { method: 'POST', headers: { authorization: 'Bearer unified-test-token', 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Jarvis continuation', conversationId: telegram.conversationId, workspaceId: 'blackspire-command', idempotencyKey: 'api-jarvis' }) });
  assert.equal(response.status, 202);
  const jarvis = await response.json();
  assert.equal(jarvis.conversationId, telegram.conversationId);
  const history = await (await fetch(`http://localhost:8902/api/conversations/${telegram.conversationId}`, { headers: { authorization: 'Bearer unified-test-token' } })).json();
  assert.ok(history.tasks.some((task) => task.id === telegram.taskId));
  assert.ok(history.tasks.some((task) => task.id === jarvis.taskId));
  assert.ok(history.events.length >= 2);
});

test('close unified API', () => server.close());


test('unified replay cannot substitute same-workspace actor or authority and makes no writes', async () => {
  const { all } = await import('../packages/task-engine/db.js');
  const input = { channel: 'jarvis', actorId: 'replay-owner', channelKey: 'replay-owner', text: 'show seller opportunities',
    idempotencyKey: 'principal-bound-replay', authority: 'authenticated_admin', executionIntent: 'read_only' };
  const original = createUnifiedInput(input);
  const snapshot = () => ['unified_inputs', 'tasks', 'conversations', 'audit_events', 'task_evidence', 'provider_attempts']
    .map((table) => all(`SELECT * FROM ${table} ORDER BY rowid`));
  const before = snapshot();
  for (const change of [{ actorId: 'other-owner' }, { authority: 'untrusted' }]) {
    const denied = createUnifiedInput({ ...input, ...change });
    assert.deepEqual(denied, { error: 'input not found', status: 404 });
  }
  assert.deepEqual(snapshot(), before);
  assert.equal(createUnifiedInput(input).taskId, original.taskId);
});

test('task replay binds workspace actor channel and authority before intent or disclosure', async () => {
  const { createTask } = await import('../packages/task-engine/tasks.js');
  const { all } = await import('../packages/task-engine/db.js');
  const input = { workspaceId: 'blackspire-command', request: 'show seller opportunities', idempotencyKey: 'direct-principal-replay',
    actorId: 'task-owner', sourceChannel: 'api', authorityClass: 'authenticated_admin', executionIntent: 'read_only' };
  const original = createTask(input);
  const before = all('SELECT * FROM tasks ORDER BY rowid');
  for (const change of [{ workspaceId: 'other' }, { actorId: 'other' }, { actorId: null }, { sourceChannel: 'jarvis' }, { authorityClass: 'untrusted' }]) {
    assert.throws(() => createTask({ ...input, ...change, executionIntent: 'workspace_mutation' }), { code: 'TASK_IDEMPOTENCY_BINDING', message: 'task not found' });
  }
  assert.deepEqual(all('SELECT * FROM tasks ORDER BY rowid'), before);
  assert.equal(createTask(input).id, original.id);
});


test('legacy null-default exact task retry stays idempotent', async () => {
  const { createTask } = await import('../packages/task-engine/tasks.js');
  const input = { workspaceId: 'blackspire-command', request: 'inspect', idempotencyKey: 'legacy-null-retry' };
  assert.equal(createTask(input).id, createTask(input).id);
});

test('reserved unified task keys from another principal are hidden', async () => {
  const { createTask } = await import('../packages/task-engine/tasks.js');
  createTask({ workspaceId: 'blackspire-command', request: 'inspect', idempotencyKey: 'unified:jarvis:reserved-owner-key',
    sourceChannel: 'jarvis', actorId: 'owner', authorityClass: 'authenticated_admin' });
  assert.deepEqual(createUnifiedInput({ channel: 'jarvis', actorId: 'other', channelKey: 'other',
    workspaceId: 'blackspire-command', text: 'inspect', idempotencyKey: 'reserved-owner-key', authority: 'authenticated_admin' }),
  { error: 'input not found', status: 404 });
});
