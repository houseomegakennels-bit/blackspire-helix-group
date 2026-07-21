import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-persistence-'));
const dbPath = path.join(root, 'command.sqlite');
const port = 8894;
const base = `http://localhost:${port}`;
// Set these in this process's own env too (not just the spawned child's), so that any direct import of
// packages/shared/config.js from this test file (which freezes constants at first import) resolves the
// same values the child API processes use.
process.env.BLACKSPIRE_DB_PATH = dbPath;
process.env.COMMAND_ADMIN_TOKEN = 'persist-token';
const env = { ...process.env, PORT: String(port), LOGIN_RATE_LIMIT: '3' };
const migration = spawnSync(process.execPath, ['scripts/migrate.js'], { cwd: process.cwd(), env: { ...env, BLACKSPIRE_RUN_MIGRATIONS: 'true' }, encoding: 'utf8' });
assert.equal(migration.status, 0, migration.stderr);

function bootApi() {
  const child = spawn(process.execPath, ['apps/api/server.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  return child;
}

async function waitForHealth(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/health`);
      if (response.status === 200) return;
    } catch { /* server not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('API did not become healthy in time');
}

async function stopApi(child) {
  child.kill('SIGTERM');
  await new Promise((resolve) => child.once('exit', resolve));
}

function cookieHeader(response) {
  return response.headers.get('set-cookie').split(',').map((v) => v.split(';')[0]).join('; ');
}

let api;
let cookie;
let csrfToken;

test('restart-persistence: boot API and log in', async () => {
  api = bootApi();
  await waitForHealth();
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: 'persist-token' }) });
  assert.equal(login.status, 200);
  const body = await login.json();
  csrfToken = body.csrfToken;
  cookie = cookieHeader(login);
  const session = await fetch(`${base}/api/auth/session`, { headers: { cookie } });
  assert.equal((await session.json()).authenticated, true);
});

test('restart-persistence: consume rate-limit capacity before restart', async () => {
  const bad = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: 'wrong' }) };
  await fetch(`${base}/api/auth/login`, bad);
  await fetch(`${base}/api/auth/login`, bad);
  // LOGIN_RATE_LIMIT=3 includes the successful login in the previous test, so this third attempt trips the limit.
  const limited = await fetch(`${base}/api/auth/login`, bad);
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.get('retry-after'));
});

test('restart-persistence: stop and restart API, session and rate-limit survive', async () => {
  await stopApi(api);
  api = bootApi();
  await waitForHealth();

  const session = await fetch(`${base}/api/auth/session`, { headers: { cookie } });
  assert.equal((await session.json()).authenticated, true, 'session must survive API restart');

  const stillLimited = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: 'wrong' }) });
  assert.equal(stillLimited.status, 429, 'rate limit bucket must survive API restart');
});

test('restart-persistence: revoke session, restart again, revocation persists', async () => {
  const revoke = await fetch(`${base}/api/auth/revoke-all`, { method: 'POST', headers: { cookie, 'x-csrf-token': csrfToken } });
  assert.equal(revoke.status, 200);
  const revokedImmediately = await fetch(`${base}/api/auth/session`, { headers: { cookie } });
  assert.equal((await revokedImmediately.json()).authenticated, false);

  await stopApi(api);
  api = bootApi();
  await waitForHealth();

  const stillRevoked = await fetch(`${base}/api/auth/session`, { headers: { cookie } });
  assert.equal((await stillRevoked.json()).authenticated, false, 'revocation must survive API restart');
});

test('restart-persistence: rotation invalidates the old session', async () => {
  process.env.BLACKSPIRE_DB_PATH = dbPath;
  const { resetRateLimit } = await import('../packages/shared/rateLimits.js');
  resetRateLimit('login:');
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: 'persist-token' }) });
  const body = await login.json();
  const oldCookie = cookieHeader(login);
  const rotate = await fetch(`${base}/api/auth/rotate`, { method: 'POST', headers: { cookie: oldCookie, 'x-csrf-token': body.csrfToken } });
  assert.equal(rotate.status, 200);
  const newCookie = cookieHeader(rotate);
  assert.notEqual(newCookie, oldCookie);

  const oldStillWorks = await fetch(`${base}/api/auth/session`, { headers: { cookie: oldCookie } });
  assert.equal((await oldStillWorks.json()).authenticated, false, 'rotation must invalidate the old session id');

  const newWorks = await fetch(`${base}/api/auth/session`, { headers: { cookie: newCookie } });
  assert.equal((await newWorks.json()).authenticated, true);
});

test('restart-persistence: expired sessions are rejected', async () => {
  process.env.BLACKSPIRE_DB_PATH = dbPath;
  process.env.COMMAND_ADMIN_TOKEN = 'persist-token';
  const { createSession, getSession } = await import('../packages/shared/sessions.js');
  process.env.SESSION_TTL_MS = '1';
  const expiring = createSession('persist-token', { ip: 'local' });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(getSession(expiring.sessionId), null);
  delete process.env.SESSION_TTL_MS;
});

test('restart-persistence: stop API', async () => {
  await stopApi(api);
});
