import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-hardening-'));
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'hardening.sqlite');
process.env.COMMAND_ADMIN_TOKEN = 'hardening-token';
process.env.SESSION_SECRET = 'x'.repeat(40);
process.env.PORT = '8893';
process.env.TELEGRAM_ALLOWED_USERS = '1001';
process.env.TELEGRAM_WEBHOOK_SECRET = 'telegram-secret';
process.env.LOGIN_RATE_LIMIT = '20';

const { start } = await import('../apps/api/server.js');
const { createTask, taskRecords, setFlag } = await import('../packages/task-engine/tasks.js');
const { handleTelegramUpdate, handleTelegramAttachment } = await import('../apps/telegram/bot.js');
const { requireProductionSafeConfig, rateLimit } = await import('../packages/shared/security.js');
const { resetRateLimit } = await import('../packages/shared/rateLimits.js');

let server;
let cookie = '';
let csrf = '';

test('start hardening API', () => { server = start(8893); assert.ok(server); });

test('secure session login, status, csrf, logout, revocation, and no browser secret echo', async () => {
  let response = await fetch('http://localhost:8893/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: 'wrong' }) });
  assert.equal(response.status, 401);
  response = await fetch('http://localhost:8893/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.1.1.1' }, body: JSON.stringify({ adminToken: 'hardening-token' }) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/);
  const body = await response.json();
  assert.equal(JSON.stringify(body).includes('hardening-token'), false);
  csrf = body.csrfToken;
  cookie = response.headers.get('set-cookie').split(',').map((v) => v.split(';')[0]).join('; ');
  response = await fetch('http://localhost:8893/api/auth/session', { headers: { cookie } });
  assert.equal((await response.json()).authenticated, true);
  assert.equal((await fetch('http://localhost:8893/api/tasks', { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ request: 'missing csrf' }) })).status, 403);
  assert.equal((await fetch('http://localhost:8893/api/tasks', { method: 'POST', headers: { cookie, 'x-csrf-token': 'bad', 'content-type': 'application/json' }, body: JSON.stringify({ request: 'bad csrf' }) })).status, 403);
  assert.equal((await fetch('http://localhost:8893/api/tasks', { method: 'POST', headers: { cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' }, body: JSON.stringify({ request: 'valid csrf', idempotencyKey: 'csrf-valid' }) })).status, 202);
  assert.equal((await fetch('http://localhost:8893/api/auth/revoke-all', { method: 'POST', headers: { cookie, 'x-csrf-token': csrf } })).status, 200);
  assert.equal((await (await fetch('http://localhost:8893/api/auth/session', { headers: { cookie } })).json()).authenticated, false);
});

test('failed login rate limiting returns retry-after and ignores spoofed forwarded-for by default', async () => {
  resetRateLimit('login:');
  process.env.LOGIN_RATE_LIMIT = '2';
  const headers = { 'content-type': 'application/json', 'x-forwarded-for': 'rate-ip-a' };
  await fetch('http://localhost:8893/api/auth/login', { method: 'POST', headers, body: JSON.stringify({ adminToken: 'bad' }) });
  await fetch('http://localhost:8893/api/auth/login', { method: 'POST', headers, body: JSON.stringify({ adminToken: 'bad' }) });
  const limited = await fetch('http://localhost:8893/api/auth/login', { method: 'POST', headers, body: JSON.stringify({ adminToken: 'bad' }) });
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('retry-after'));
  // TRUST_PROXY is disabled by default, so a spoofed X-Forwarded-For does NOT open a fresh bucket:
  // the real (loopback) socket IP is still over its limit even with a different claimed IP and valid credentials.
  const spoofed = await fetch('http://localhost:8893/api/auth/login', { method: 'POST', headers: { ...headers, 'x-forwarded-for': 'rate-ip-b' }, body: JSON.stringify({ adminToken: 'hardening-token' }) });
  assert.equal(spoofed.status, 429);
  resetRateLimit('login:');
  process.env.LOGIN_RATE_LIMIT = '20';
});

test('approval records are created, idempotent, approved, rejected, and expiration blocks execution', async () => {
  const task = createTask({ workspaceId: 'blackspire-command', request: 'deploy production', idempotencyKey: 'approval-hardening' });
  const { createApproval, decideApproval } = await import('../packages/task-engine/tasks.js');
  const first = createApproval(task.id, 'deploy', 'needs approval', { expiresAt: new Date(Date.now() + 60_000).toISOString() });
  const duplicate = createApproval(task.id, 'deploy', 'needs approval', { expiresAt: new Date(Date.now() + 60_000).toISOString() });
  assert.equal(first, duplicate);
  assert.equal(decideApproval(task.id, 'approved', 'ok'), 'approved');
  assert.equal(taskRecords(task.id).approvals[0].status, 'approved');
  const expired = createTask({ workspaceId: 'blackspire-command', request: 'delete data', idempotencyKey: 'approval-expired' });
  createApproval(expired.id, 'delete', 'expired', { expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(decideApproval(expired.id, 'approved', 'too late'), 'expired');
  const rejected = createTask({ workspaceId: 'blackspire-command', request: 'delete data', idempotencyKey: 'approval-reject' });
  createApproval(rejected.id, 'delete', 'reject me');
  assert.equal(decideApproval(rejected.id, 'rejected', 'no'), 'rejected');
});

test('Telegram webhook secret validation, duplicate protection, unauthorized user, and valid dispatch', async () => {
  let response = await fetch('http://localhost:8893/telegram/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'bad' }, body: JSON.stringify({ update_id: 1 }) });
  assert.equal(response.status, 401);
  response = await fetch('http://localhost:8893/telegram/webhook', { method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'telegram-secret' }, body: JSON.stringify({ update_id: 2, message: { from: { id: 999 }, chat: { id: 1 }, text: '/status' } }) });
  assert.equal(response.status, 200);
  const dispatch = await handleTelegramUpdate({ update_id: 3, message: { from: { id: 1001 }, chat: { id: 1 }, text: '/health' } }, 'http://localhost:8893');
  assert.ok(dispatch.text[0]);
  assert.equal((await handleTelegramUpdate({ update_id: 3, message: { from: { id: 1001 }, chat: { id: 1 }, text: '/health' } }, 'http://localhost:8893')).ignored, true);
});

// Pre-download rejection boundaries only (no network involved). The full download/mime/size/text-extraction/
// voice-transcription/cleanup workflow against a mocked Telegram HTTP API is covered in tests/telegram-files.test.js.
test('Telegram attachment size and MIME rejections happen before any network call', async () => {
  let result = await handleTelegramAttachment({ message: { from: { id: 1001 }, chat: { id: 1 }, document: { file_id: 'file0', file_name: 'huge.txt', file_size: 999_999_999, mime_type: 'text/plain' } } }, 'http://localhost:8893');
  assert.match(result.text[0], /too large/);
  result = await handleTelegramAttachment({ message: { from: { id: 1001 }, chat: { id: 1 }, document: { file_id: 'file2', file_name: 'bad.exe', file_size: 20, mime_type: 'application/x-msdownload' } } }, 'http://localhost:8893');
  assert.match(result.text[0], /not allowlisted/);
});

test('evidence export supports JSON/Markdown, redaction, missing task, and audit event', async () => {
  const task = createTask({ workspaceId: 'blackspire-command', request: 'export sk-test1234567', idempotencyKey: 'export-hardening' });
  let response = await fetch(`http://localhost:8893/api/tasks/${task.id}/export.json`, { headers: { authorization: 'Bearer hardening-token' } });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.equal(text.includes('sk-test1234567'), false);
  response = await fetch(`http://localhost:8893/api/tasks/${task.id}/export.md`, { headers: { authorization: 'Bearer hardening-token' } });
  assert.equal(response.status, 200);
  assert.equal((await fetch('http://localhost:8893/api/tasks/nope/export.json', { headers: { authorization: 'Bearer hardening-token' } })).status, 404);
  assert.ok(taskRecords(task.id).logs.some((event) => event.action === 'evidence.exported'));
});

test('emergency reset requires session confirmation and production validation rejects unsafe config', async () => {
  setFlag('emergency_stop', 'active');
  assert.equal((await fetch('http://localhost:8893/api/stop/reset', { method: 'POST', headers: { authorization: 'Bearer hardening-token' } })).status, 403);
  const login = await fetch('http://localhost:8893/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': 'reset-ip' }, body: JSON.stringify({ adminToken: 'hardening-token' }) });
  const body = await login.json();
  const sessionCookie = login.headers.get('set-cookie').split(',').map((v) => v.split(';')[0]).join('; ');
  assert.equal((await fetch('http://localhost:8893/api/stop/reset', { method: 'POST', headers: { cookie: sessionCookie, 'x-csrf-token': body.csrfToken, 'x-confirmation-token': `${body.csrfToken}:RESET` } })).status, 200);
  const production = requireProductionSafeConfig({ NODE_ENV: 'production', COMMAND_ADMIN_TOKEN: 'dev-admin-token-change-me', SESSION_SECRET: 'weak', PUBLIC_BASE_URL: 'http://example.com', TELEGRAM_MODE: 'webhook', DEBUG: 'true', CORS_ORIGIN: '*', RATE_LIMIT_DISABLED: 'true' });
  assert.equal(production.ok, false);
  assert.ok(production.errors.length >= 5);
});

test('close hardening API', () => server.close());
