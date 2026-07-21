import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-iphone-test-'));
process.env.NODE_ENV = 'test';
process.env.UNIFIED_IPHONE_TEST_MODE = 'true';
process.env.UNIFIED_TEST_EXPIRES_AT = new Date(Date.now() + 60 * 60 * 1000).toISOString();
process.env.UNIFIED_TEST_WORKSPACE_ID = 'iphone-test';
process.env.UNIFIED_TEST_ACTOR_ID = 'iphone-test-operator';
process.env.UNIFIED_TEST_CHANNEL_KEY = 'iphone-test-chat';
process.env.UNIFIED_TEST_ACCESS_CODE = 'local-one-time-code';
process.env.BLACKSPIRE_DATA_DIR = root;
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'iphone.sqlite');
process.env.UNIFIED_TEST_WORKSPACE_ROOT = root;
process.env.HERMES_TEST_PROVIDER = 'mock';
process.env.TELEGRAM_MODE = 'mock';
process.env.ALLOW_BEARER_AUTH = 'false';
process.env.SECURE_COOKIES = 'true';
process.env.SESSION_TTL_MS = '3600000';
process.env.TELEGRAM_OUTBOX_MAX_ATTEMPTS = '2';
process.env.TELEGRAM_OUTBOX_RETRY_SECONDS = '0';
process.env.PORT = '8920';
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;

const { start } = await import('../apps/api/server.js');
const { processTask } = await import('../packages/hermes/hermes.js');
const { getTask, taskRecords, deliveryRecords } = await import('../packages/task-engine/tasks.js');
const { getConversation, drainTelegramOutbox } = await import('../packages/unified-input/unified.js');
const { closeDb } = await import('../packages/task-engine/db.js');
const { testModeConfig } = await import('../packages/shared/testMode.js');

let server;
let cookie = '';
let csrf = '';
let conversationId = '';

function headers(extra = {}) {
  return { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json', origin: 'http://127.0.0.1:8920', ...extra };
}

test('test mode starts fail-closed and creates a short-lived test session', async () => {
  assert.equal(testModeConfig({ ...process.env, HERMES_TEST_PROVIDER: 'openai' }).ok, false);
  assert.equal(testModeConfig({ ...process.env, TELEGRAM_BOT_TOKEN: 'forbidden-fixture' }).ok, false);
  assert.equal(testModeConfig({ ...process.env, UNIFIED_TEST_EXPIRES_AT: new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString() }).ok, false);
  server = start(8920, '127.0.0.1');
  const status = await (await fetch('http://127.0.0.1:8920/api/test-mode')).json();
  assert.equal(status.enabled, true);
  assert.equal(status.workspaceId, 'iphone-test');
  assert.equal(status.provider, 'mock');
  assert.equal(status.telegram, 'mock');
  assert.equal(status.testActor, 'iphone-test-operator');
  assert.ok(status.expiresAt);

  const missingCode = await fetch('http://127.0.0.1:8920/api/test-mode/session', { method: 'POST', headers: { origin: 'http://127.0.0.1:8920', 'content-type': 'application/json' }, body: '{}' });
  assert.equal(missingCode.status, 404);
  const login = await fetch('http://127.0.0.1:8920/api/test-mode/session', { method: 'POST', headers: { origin: 'http://127.0.0.1:8920', 'content-type': 'application/json' }, body: JSON.stringify({ accessCode: 'local-one-time-code' }) });
  assert.equal(login.status, 200);
  cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  const body = await login.json();
  csrf = body.csrfToken;
  assert.ok(csrf);
  const crossOrigin = await fetch('http://127.0.0.1:8920/api/test-mode/session', { method: 'POST', headers: { origin: 'https://example.invalid' } });
  assert.equal(crossOrigin.status, 404);
});

test('test routes share canonical state and mock Hermes is read-only', async () => {
  const telegram = await (await fetch('http://127.0.0.1:8920/api/test-mode/telegram-input', {
    method: 'POST', headers: headers(), body: JSON.stringify({ text: 'Report the current task status without changing files.', updateId: 'iphone-happy-1' }),
  })).json();
  assert.ok(telegram.conversationId);
  assert.ok(telegram.taskId);
  conversationId = telegram.conversationId;
  const before = fs.readdirSync(root).sort();
  await processTask(getTask(telegram.taskId));
  assert.equal(getTask(telegram.taskId).status, 'completed');
  assert.deepEqual(fs.readdirSync(root).sort(), before);
  const records = taskRecords(telegram.taskId);
  assert.equal(records.providerAttempts.length, 1);
  assert.equal(records.providerAttempts[0].provider, 'mock');
  assert.match(records.providerAttempts[0].response_packet, /mock-hermes-status-v1/);

  const jarvis = await (await fetch('http://127.0.0.1:8920/api/unified-input', {
    method: 'POST', headers: headers(), body: JSON.stringify({ conversationId, text: 'Give the same status as a follow-up.', idempotencyKey: 'iphone-follow-up-1' }),
  })).json();
  assert.equal(jarvis.conversationId, conversationId);
  assert.equal(getConversation(conversationId).conversation.id, conversationId);
  assert.equal(getConversation(conversationId).tasks.length, 2);

  const replay = await (await fetch('http://127.0.0.1:8920/api/unified-input', {
    method: 'POST', headers: headers(), body: JSON.stringify({ conversationId, text: 'ignored replay', idempotencyKey: 'iphone-follow-up-1' }),
  })).json();
  assert.equal(replay.duplicate, true);
  assert.equal(replay.taskId, jarvis.taskId);

  await fetch('http://127.0.0.1:8920/api/unified-input', {
    method: 'POST', headers: headers(), body: JSON.stringify({ conversationId, text: 'Harmless status token=fixture-value', idempotencyKey: 'iphone-redaction-1' }),
  });
  const visible = JSON.stringify(await (await fetch(`http://127.0.0.1:8920/api/conversations/${conversationId}`, { headers: { cookie } })).json());
  assert.doesNotMatch(visible, /fixture-value/);
});

test('privileged Telegram fixtures are denied and admin routes stay unavailable', async () => {
  const response = await fetch('http://127.0.0.1:8920/api/test-mode/telegram-input', {
    method: 'POST', headers: headers(), body: JSON.stringify({ conversationId, text: 'Create a new repository', updateId: 'iphone-denial-1' }),
  });
  const denied = await response.json();
  assert.equal(response.status, 403);
  assert.equal(denied.denied, true);
  assert.equal(getTask(denied.taskId).status, 'failed');
  assert.equal(taskRecords(denied.taskId).providerAttempts.length, 0);
  assert.equal(taskRecords(denied.taskId).approvals.length, 0);
  assert.deepEqual(getConversation(conversationId).events.filter((event) => event.task_id === denied.taskId).map((event) => event.type), ['policy.denied']);
  const beforeReplay = getConversation(conversationId);
  const replayResponse = await fetch('http://127.0.0.1:8920/api/test-mode/telegram-input', {
    method: 'POST', headers: headers(), body: JSON.stringify({ conversationId, text: 'ignored replay', updateId: 'iphone-denial-1' }),
  });
  const replay = await replayResponse.json();
  assert.equal(replayResponse.status, 403);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.taskId, denied.taskId);
  assert.equal(getConversation(conversationId).events.length, beforeReplay.events.length);
  assert.equal(getConversation(conversationId).deliveries.length, beforeReplay.deliveries.length);
  for (const route of ['/api/stop', '/ready', `/api/tasks/${denied.taskId}/approve`, `/api/tasks/${denied.taskId}/export.json`]) {
    const readOnly = route === '/ready' || route.endsWith('.json');
    const response = await fetch(`http://127.0.0.1:8920${route}`, { method: readOnly ? 'GET' : 'POST', headers: headers(), body: readOnly ? undefined : '{}' });
    assert.equal(response.status, 404, route);
  }
});

test('held task cancellation and bounded mock Telegram failure remain canonical', async () => {
  const held = await (await fetch('http://127.0.0.1:8920/api/test-mode/queued-task', { method: 'POST', headers: headers(), body: JSON.stringify({ conversationId }) })).json();
  assert.equal(getTask(held.taskId).status, 'queued');
  const cancelled = await (await fetch(`http://127.0.0.1:8920/api/tasks/${held.taskId}/cancel`, { method: 'POST', headers: headers(), body: '{}' })).json();
  assert.equal(cancelled.task.status, 'cancelled');
  assert.ok(getConversation(conversationId).events.some((event) => event.type === 'task.cancellation_requested'));

  const configured = await fetch('http://127.0.0.1:8920/api/test-mode/delivery-failure', { method: 'POST', headers: headers(), body: JSON.stringify({ attempts: 2 }) });
  assert.equal(configured.status, 200);
  await drainTelegramOutbox(async () => { throw new Error('mock delivery failure secret=fixture-value'); });
  await drainTelegramOutbox(async () => { throw new Error('mock delivery failure secret=fixture-value'); });
  assert.ok(deliveryRecords(conversationId).some((row) => row.status === 'failed' && !row.last_error.includes('fixture-value')));
  assert.equal(getTask(held.taskId).status, 'cancelled');
});

test('test-mode browser contract is mobile, structured, and contains no privileged controls', async () => {
  const html = await (await fetch('http://127.0.0.1:8920/jarvis')).text();
  assert.match(html, /TEST MODE/);
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /Conversation ID/);
  assert.match(html, /Task ID/);
  assert.match(html, /Ordered event timeline/);
  assert.match(html, /Mock Telegram delivery/);
  assert.match(html, /Expires/);
  assert.match(html, /access code/i);
  assert.doesNotMatch(html, /GLOBAL STOP|Approval center|Admin token/);
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
  assert.equal(fs.existsSync(root), false);
});
