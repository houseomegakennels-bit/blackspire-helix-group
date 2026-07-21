import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-unified-e2e-'));
const workspaceRoot = path.join(root, 'workspace');
fs.mkdirSync(workspaceRoot);
fs.writeFileSync(path.join(workspaceRoot, 'README.md'), '# Test workspace\n');
execFileSync('git', ['init', '-q'], { cwd: workspaceRoot });
execFileSync('git', ['config', 'user.email', 'test@localhost'], { cwd: workspaceRoot });
execFileSync('git', ['config', 'user.name', 'Local Test'], { cwd: workspaceRoot });
execFileSync('git', ['add', 'README.md'], { cwd: workspaceRoot });
execFileSync('git', ['commit', '-qm', 'test baseline'], { cwd: workspaceRoot });

process.env.BLACKSPIRE_DB_PATH = path.join(root, 'validation.sqlite');
process.env.BLACKSPIRE_DATA_DIR = root;
process.env.COMMAND_ADMIN_TOKEN = 'local-validation-token';
process.env.ALLOW_BEARER_AUTH = 'true';
process.env.TELEGRAM_ALLOWED_USERS = '9001';
process.env.HERMES_TEST_PROVIDER = 'mock';
process.env.TELEGRAM_OUTBOX_MAX_ATTEMPTS = '2';
process.env.TELEGRAM_OUTBOX_RETRY_SECONDS = '0';
process.env.PORT = '8910';
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

const externalAttempts = [];
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
    externalAttempts.push(url.origin);
    throw new Error('external network blocked by validation fixture');
  }
  return nativeFetch(input, init);
};

const { start } = await import('../apps/api/server.js');
const { handleTelegramUpdate } = await import('../apps/telegram/bot.js');
const { createUnifiedInput, getConversation, drainTelegramOutbox, registerCancellationToken } = await import('../packages/unified-input/unified.js');
const { getTask, taskRecords, deliveryRecords, setFlag } = await import('../packages/task-engine/tasks.js');
const { query, closeDb } = await import('../packages/task-engine/db.js');
const { upsertWorkspace, getWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { processTask } = await import('../packages/hermes/hermes.js');

upsertWorkspace({ id: 'e2e', name: 'E2E', githubRepository: 'local/e2e', allowedPaths: ['.'], buildCommands: ['node --version'], providerPolicy: { preferred: ['mock'] }, budgetCents: 50, rootPath: workspaceRoot });
upsertWorkspace({ id: 'zero-e2e', name: 'Zero E2E', githubRepository: 'local/e2e', allowedPaths: ['.'], buildCommands: ['node --version'], providerPolicy: { preferred: ['mock'] }, budgetCents: 0, rootPath: workspaceRoot });

let server;
const evidence = {};

test('credential-free loopback Unified Jarvis and mock Telegram flow', async () => {
  server = start(8910, '127.0.0.1');
  await handleTelegramUpdate({ update_id: 8099, message: { from: { id: 9001 }, chat: { id: 9100 }, text: '/use e2e' } });
  const telegramReply = await handleTelegramUpdate({ update_id: 8100, message: { from: { id: 9001 }, chat: { id: 9100 }, text: '/task create `docs/e2e.md`' } });
  assert.match(telegramReply.text[0], /Queued/);
  const telegramInput = query("SELECT * FROM unified_inputs WHERE channel='telegram' AND idempotency_key='telegram:8100';")[0];
  const telegramTask = query(`SELECT * FROM tasks WHERE input_id='${telegramInput.id}';`)[0];
  evidence.conversationId = telegramInput.conversation_id;
  evidence.telegramTaskId = telegramTask.id;

  assert.equal(getWorkspace('e2e').root_path, workspaceRoot);
  await processTask(telegramTask);
  assert.equal(getTask(telegramTask.id).status, 'completed');
  assert.deepEqual(taskRecords(telegramTask.id).providerAttempts.map(({ provider, mode }) => ({ provider, mode })), [{ provider: 'mock', mode: 'mock' }]);

  const jarvisResponse = await fetch('http://127.0.0.1:8910/api/unified-input', { method: 'POST', headers: { authorization: 'Bearer local-validation-token', 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: 'e2e', conversationId: evidence.conversationId, text: 'harmless follow-up', idempotencyKey: 'jarvis-e2e' }) });
  assert.equal(jarvisResponse.status, 202);
  const jarvis = await jarvisResponse.json();
  evidence.jarvisTaskId = jarvis.taskId;
  assert.equal(jarvis.conversationId, evidence.conversationId);

  const duplicateJarvis = await (await fetch('http://127.0.0.1:8910/api/unified-input', { method: 'POST', headers: { authorization: 'Bearer local-validation-token', 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: 'e2e', conversationId: evidence.conversationId, text: 'ignored duplicate', idempotencyKey: 'jarvis-e2e' }) })).json();
  assert.equal(duplicateJarvis.duplicate, true);
  assert.equal(duplicateJarvis.taskId, jarvis.taskId);
  const replay = await handleTelegramUpdate({ update_id: 8100, message: { from: { id: 9001 }, chat: { id: 9100 }, text: '/task duplicate' } });
  assert.equal(replay.ignored, true);

  let tokenCalls = 0;
  registerCancellationToken(jarvis.taskId, { cancel: () => { tokenCalls += 1; return { cleaned: true, resources: ['mock-provider'] }; } });
  const cancellationResponse = await fetch(`http://127.0.0.1:8910/api/tasks/${jarvis.taskId}/cancel`, { method: 'POST', headers: { authorization: 'Bearer local-validation-token', 'content-type': 'application/json' }, body: '{}' });
  const cancelled = await cancellationResponse.json();
  assert.equal(cancellationResponse.status, 200, JSON.stringify(cancelled));
  assert.equal(cancelled.task.status, 'cancelled');
  assert.equal(tokenCalls, 1);
  const cancellationRecords = taskRecords(jarvis.taskId);
  assert.ok(cancellationRecords.logs.some((row) => row.action === 'cancellation_requested'));
  assert.ok(cancellationRecords.evidence.some((row) => row.kind === 'cancellation_cleanup'));
  assert.ok(getConversation(evidence.conversationId).events.some((event) => event.type === 'task.cancellation_requested'));

  const delivered = [];
  await drainTelegramOutbox(async (reply) => { delivered.push(...reply.text); });
  assert.ok(delivered.some((message) => message.includes('task.cancelled') && !message.includes('local-validation-token')));

  const failureTask = createUnifiedInput({ channel: 'telegram', actorId: '9001', channelKey: '9100', conversationId: evidence.conversationId, workspaceId: 'e2e', text: 'delivery retry task', idempotencyKey: 'delivery-e2e' });
  await drainTelegramOutbox(async () => { throw new Error('mock failure token=external-secret-value'); });
  await drainTelegramOutbox(async () => { throw new Error('mock failure token=external-secret-value'); });
  assert.ok(deliveryRecords(evidence.conversationId).some((row) => row.status === 'failed' && row.attempts === 2 && !row.last_error.includes('external-secret-value')));
  assert.equal(getTask(failureTask.taskId).status, 'queued');
  assert.ok(getConversation(evidence.conversationId).deliveries.some((row) => row.status === 'failed'));

  const denied = createUnifiedInput({ channel: 'telegram', actorId: '9001', channelKey: '9200', workspaceId: 'e2e', text: 'create a repository and expose token=external-secret-value', idempotencyKey: 'policy-e2e' });
  assert.equal(denied.denied, true);
  assert.equal(taskRecords(denied.taskId).providerAttempts.length, 0);
  const workspaceDenied = createUnifiedInput({ channel: 'jarvis', actorId: 'local', channelKey: 'local', workspaceId: 'missing-e2e', text: 'safe', idempotencyKey: 'workspace-e2e' });
  assert.equal(workspaceDenied.status, 403);
  const budget = createUnifiedInput({ channel: 'jarvis', actorId: 'local', channelKey: 'budget', workspaceId: 'zero-e2e', text: 'safe', idempotencyKey: 'budget-e2e' });
  await processTask(getTask(budget.taskId));
  assert.equal(taskRecords(budget.taskId).providerAttempts.length, 0);
  assert.match(getTask(budget.taskId).error, /budget exhausted/i);
  setFlag('emergency_stop', 'active');
  const stopped = createUnifiedInput({ channel: 'jarvis', actorId: 'local', channelKey: 'stopped', workspaceId: 'e2e', text: 'safe', idempotencyKey: 'stop-e2e' });
  assert.equal(stopped.status, 423);
  setFlag('emergency_stop', 'inactive');

  const privateConversation = createUnifiedInput({ channel: 'jarvis', actorId: 'private', channelKey: 'private', workspaceId: 'e2e', text: 'private', idempotencyKey: 'private-e2e' });
  const attach = await handleTelegramUpdate({ update_id: 8101, message: { from: { id: 9001 }, chat: { id: 9300 }, text: `/conversation ${privateConversation.conversationId}` } });
  assert.match(attach.text[0], /not found|not available/i);

  const shared = await (await fetch(`http://127.0.0.1:8910/api/conversations/${evidence.conversationId}`, { headers: { authorization: 'Bearer local-validation-token' } })).json();
  assert.deepEqual(shared.tasks.slice(0, 2).map((task) => task.id), [telegramTask.id, jarvis.taskId]);
  const ordered = [...shared.events].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  assert.deepEqual(shared.events.map((row) => row.id), ordered.map((row) => row.id));
  const serialized = JSON.stringify({ shared, deniedTask: getTask(denied.taskId), deniedRecords: taskRecords(denied.taskId) });
  assert.doesNotMatch(serialized, /external-secret-value/);
  assert.deepEqual(externalAttempts, []);
  console.log(`UNIFIED_INPUT_E2E_EVIDENCE ${JSON.stringify(evidence)}`);
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  globalThis.fetch = nativeFetch;
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
  assert.equal(fs.existsSync(root), false);
});
