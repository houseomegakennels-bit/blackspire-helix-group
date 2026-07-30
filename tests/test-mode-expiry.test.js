import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-test-expiry-'));
process.env.NODE_ENV = 'test';
process.env.UNIFIED_IPHONE_TEST_MODE = 'true';
process.env.UNIFIED_TEST_EXPIRES_AT = new Date(Date.now() + 1000).toISOString();
process.env.UNIFIED_TEST_WORKSPACE_ID = 'expiry-test';
process.env.UNIFIED_TEST_ACTOR_ID = 'expiry-operator';
process.env.UNIFIED_TEST_CHANNEL_KEY = 'expiry-chat';
process.env.UNIFIED_TEST_ACCESS_CODE = 'local-expiry-code';
process.env.BLACKSPIRE_DATA_DIR = root;
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'expiry.sqlite');
process.env.UNIFIED_TEST_WORKSPACE_ROOT = root;
process.env.HERMES_TEST_PROVIDER = 'mock';
process.env.TELEGRAM_MODE = 'mock';
process.env.ALLOW_BEARER_AUTH = 'false';
process.env.SECURE_COOKIES = 'true';
process.env.SESSION_TTL_MS = '60000';
for (const key of ['TELEGRAM_BOT_TOKEN','OPENAI_API_KEY','ANTHROPIC_API_KEY','CODEX_API_KEY','TELEGRAM_WEBHOOK_SECRET','GH_TOKEN','GITHUB_TOKEN']) delete process.env[key];

const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { start } = await import('../apps/api/server.js');
const { closeDb } = await import('../packages/task-engine/db.js');
const server = start(0, '127.0.0.1', { exitOnListenError: false });
await new Promise((resolve) => server.once('listening', resolve));
const port = server.address().port;
process.env.UNIFIED_TEST_ALLOWED_HOST = `127.0.0.1:${port}`;
const origin = `http://127.0.0.1:${port}`;

test('test-mode sessions and fresh logins expire at the operator deadline', async () => {
  const login = await fetch(`${origin}/api/test-mode/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ accessCode: process.env.UNIFIED_TEST_ACCESS_CODE }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  await new Promise((resolve) => setTimeout(resolve, 1200));
  const existing = await (await fetch(`${origin}/api/auth/session`, { headers: { cookie } })).json();
  assert.equal(existing.authenticated, false);
  const fresh = await fetch(`${origin}/api/test-mode/session`, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ accessCode: process.env.UNIFIED_TEST_ACCESS_CODE }) });
  assert.equal(fresh.status, 404);
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
});
