import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-cookies-'));

function bootApi(env, port) {
  const child = spawn(process.execPath, ['apps/api/server.js'], { env: { ...process.env, ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  return child;
}

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForHealth(child, port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Fail fast (and never hang) if the server process died during startup instead of polling a dead port.
    if (hasExited(child)) throw new Error(`API process exited during startup (code ${child.exitCode}, signal ${child.signalCode})`);
    try { if ((await fetch(`http://localhost:${port}/health`)).status === 200) return; } catch { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('API did not become healthy in time');
}

async function stopApi(child) {
  if (!child) return;
  // A child that already exited (e.g. a boot failure) will never emit another 'exit'; awaiting one would hang
  // the whole test run. Guard for it, attach the listener before signalling, and escalate to SIGKILL so an
  // unresponsive child can never block the suite indefinitely.
  if (hasExited(child)) return;
  await new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 2000);
    child.once('exit', finish);
    child.kill('SIGTERM');
  });
}

// Boot an API child and wait for health, guaranteeing the child is reaped if startup fails so no disposable
// process is orphaned and no failure can turn into a hang.
async function bootAndWait(env, port) {
  const child = bootApi(env, port);
  try {
    await waitForHealth(child, port);
  } catch (err) {
    await stopApi(child);
    throw err;
  }
  return child;
}

function parseSetCookies(response) {
  const raw = response.headers.getSetCookie ? response.headers.getSetCookie() : response.headers.get('set-cookie').split(/,(?=[^;]+?=)/);
  return raw.map((line) => {
    const [pair, ...attrs] = line.split(';').map((s) => s.trim());
    const [name, value] = pair.split('=');
    return { name, value: decodeURIComponent(value || ''), attrs: attrs.map((a) => a.toLowerCase()) };
  });
}

let devApi;
const devPort = 8901;

test('boot dev-mode API for cookie inspection', async () => {
  devApi = await bootAndWait({ NODE_ENV: 'development', BLACKSPIRE_DB_PATH: path.join(root, 'dev.sqlite'), COMMAND_ADMIN_TOKEN: 'cookie-token' }, devPort);
});

test('session cookie is HttpOnly; CSRF cookie is not, and the two values differ', async () => {
  const login = await fetch(`http://localhost:${devPort}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: 'cookie-token' }) });
  const cookies = parseSetCookies(login);
  const session = cookies.find((c) => c.name === 'bc_session');
  const csrf = cookies.find((c) => c.name === 'bc_csrf');
  assert.ok(session.attrs.includes('httponly'), 'session cookie must be HttpOnly');
  assert.ok(!csrf.attrs.includes('httponly'), 'CSRF cookie must be readable by JS (not HttpOnly)');
  assert.notEqual(session.value, csrf.value, 'CSRF token must not be the session id');
  assert.ok(session.attrs.includes('samesite=strict'));
  assert.ok(csrf.attrs.includes('samesite=strict'));
  assert.ok(session.attrs.includes('path=/'));
  assert.ok(csrf.attrs.includes('path=/'));
  assert.ok(!session.attrs.includes('secure'), 'dev mode must not force Secure (would break plain HTTP local dev)');

  const cookieHeader = `bc_session=${encodeURIComponent(session.value)}; bc_csrf=${encodeURIComponent(csrf.value)}`;
  const csrfToken = (await login.clone().json()).csrfToken;

  const noCsrf = await fetch(`http://localhost:${devPort}/api/tasks`, { method: 'POST', headers: { cookie: cookieHeader, 'content-type': 'application/json' }, body: JSON.stringify({ request: 'x' }) });
  assert.equal(noCsrf.status, 403);

  const withCsrf = await fetch(`http://localhost:${devPort}/api/tasks`, { method: 'POST', headers: { cookie: cookieHeader, 'x-csrf-token': csrfToken, 'content-type': 'application/json' }, body: JSON.stringify({ request: 'valid', idempotencyKey: 'csrf-ok' }) });
  assert.equal(withCsrf.status, 202);

  const logout = await fetch(`http://localhost:${devPort}/api/auth/logout`, { method: 'POST', headers: { cookie: cookieHeader, 'x-csrf-token': csrfToken } });
  const cleared = parseSetCookies(logout);
  assert.ok(cleared.every((c) => c.value === ''), 'logout must clear both cookie values');
  assert.ok(cleared.some((c) => c.name === 'bc_session'));
  assert.ok(cleared.some((c) => c.name === 'bc_csrf'));

  assert.equal((await fetch(`http://localhost:${devPort}/health`)).headers.get('cache-control'), 'no-cache');
  assert.equal((await fetch(`http://localhost:${devPort}/api/tasks`, { headers: { cookie: cookieHeader } })).headers.get('cache-control'), 'no-store');
});

test('stop dev-mode API', async () => { await stopApi(devApi); });

let prodApi;
const prodPort = 8902;
const prodEnv = {
  NODE_ENV: 'production',
  BLACKSPIRE_DB_PATH: path.join(root, 'prod', 'command.sqlite'),
  TELEGRAM_TMP_DIR: path.join(root, 'prod-attachments'),
  COMMAND_ADMIN_TOKEN: 'p'.repeat(32),
  SESSION_SECRET: 'q'.repeat(40),
  SECURE_COOKIES: 'true',
  PUBLIC_BASE_URL: 'https://command.example.com',
  TELEGRAM_MODE: 'polling',
  DEBUG: 'false',
  CORS_ORIGIN: 'https://command.example.com',
  RATE_LIMIT_DISABLED: 'false',
  TRUST_PROXY: 'false',
  GIT_WORKFLOW_ENABLED: 'false',
};

test('boot production-mode API for Secure-cookie and bearer-restriction checks', async () => {
  prodApi = await bootAndWait(prodEnv, prodPort);
});

test('production sets Secure on both cookies', async () => {
  const login = await fetch(`http://localhost:${prodPort}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: prodEnv.COMMAND_ADMIN_TOKEN }) });
  const cookies = parseSetCookies(login);
  assert.ok(cookies.every((c) => c.attrs.includes('secure')), 'production cookies must be Secure');
});

test('production disables bearer-token auth by default even with the correct token', async () => {
  const response = await fetch(`http://localhost:${prodPort}/api/tasks`, { headers: { authorization: `Bearer ${prodEnv.COMMAND_ADMIN_TOKEN}` } });
  assert.equal(response.status, 401, 'bearer auth must be restricted in production unless explicitly enabled');
});

test('stop production-mode API', async () => { await stopApi(prodApi); });

let prodBearerApi;
const prodBearerPort = 8903;

test('production allows bearer-token auth only when explicitly opted in', async () => {
  prodBearerApi = await bootAndWait({ ...prodEnv, ALLOW_BEARER_AUTH: 'true', BLACKSPIRE_DB_PATH: path.join(root, 'prod-bearer', 'command.sqlite'), TELEGRAM_TMP_DIR: path.join(root, 'prod-bearer-attachments') }, prodBearerPort);
  const response = await fetch(`http://localhost:${prodBearerPort}/api/tasks`, { headers: { authorization: `Bearer ${prodEnv.COMMAND_ADMIN_TOKEN}` } });
  assert.equal(response.status, 200, 'bearer auth must work once explicitly enabled');
  await stopApi(prodBearerApi);
});
