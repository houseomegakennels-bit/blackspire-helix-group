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
  const first = createUnifiedInput({ channel: 'telegram', actorId: '1001', channelKey: 'chat-8', text: 'idempotent status', idempotencyKey: 'duplicate-1' });
  const second = createUnifiedInput({ channel: 'telegram', actorId: '1001', channelKey: 'chat-8', text: 'idempotent status', idempotencyKey: 'duplicate-1' });
  assert.equal(second.duplicate, true);
  assert.equal(second.taskId, first.taskId);
  assert.equal(second.conversationId, first.conversationId);
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
  for (const [offset, command] of ['/approve task_x', '/deploy production', '/merge main', '/reset emergency', '/secret access', '/trade funds', '/task increase the budget', '/task change host security', '/task amend the constitution'].entries()) {
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
  server = start(8902);
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
