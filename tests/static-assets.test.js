import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { spawn } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-static-'));
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'static.sqlite');
process.env.COMMAND_ADMIN_TOKEN = 'static-token';
process.env.PORT = '8899';
process.env.HERMES_TEST_PROVIDER = 'mock';

const { closeDb } = await import('../packages/task-engine/db.js');
const { start } = await import('../apps/api/server.js');

const base = 'http://localhost:8899';
const server = start(8899);

// Every public asset route, with the exact content type each must answer. The Jarvis shell
// assets ship on the Jarvis UI branch, so tests that need their bytes stage a fixture.
const PUBLIC_ASSETS = [
  { url: '/manifest.webmanifest', file: 'apps/jarvis-pwa/public/manifest.webmanifest', type: 'application/manifest+json; charset=utf-8', immutable: false },
  { url: '/sw.js', file: 'apps/jarvis-pwa/public/sw.js', type: 'text/javascript; charset=utf-8', immutable: false },
  { url: '/jarvis.css', file: 'apps/jarvis-pwa/public/jarvis.css', type: 'text/css; charset=utf-8', immutable: false },
  { url: '/jarvis.js', file: 'apps/jarvis-pwa/public/jarvis.js', type: 'text/javascript; charset=utf-8', immutable: false },
  { url: '/helix-core.js', file: 'apps/jarvis-pwa/public/helix-core.js', type: 'text/javascript; charset=utf-8', immutable: true },
];

// Stage any asset that is absent on this branch, run the body, then restore the tree exactly.
async function withAssets(run) {
  const staged = [];
  try {
    for (const asset of PUBLIC_ASSETS) {
      const resolved = path.resolve(asset.file);
      if (fs.existsSync(resolved)) continue;
      fs.writeFileSync(resolved, `/* fixture ${asset.url} */\n`);
      staged.push(resolved);
    }
    await run();
  } finally {
    for (const resolved of staged) fs.rmSync(resolved, { force: true });
  }
}

test('every public asset is served unauthenticated with its exact content type and bytes', async () => {
  await withAssets(async () => {
    for (const asset of PUBLIC_ASSETS) {
      const response = await fetch(`${base}${asset.url}`);
      assert.equal(response.status, 200, `${asset.url} status`);
      assert.equal(response.headers.get('content-type'), asset.type, `${asset.url} content-type`);
      // No auth was sent and none may be demanded: the sign-in view needs these to render.
      assert.equal(response.headers.get('www-authenticate'), null, `${asset.url} demanded auth`);
      assert.equal(await response.text(), fs.readFileSync(path.resolve(asset.file), 'utf8'), `${asset.url} body`);
    }
  });
});

test('authenticated requests receive byte-identical assets', async () => {
  await withAssets(async () => {
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ adminToken: 'static-token' }),
    });
    assert.equal(login.status, 200, 'login must succeed for this test to mean anything');
    const cookie = login.headers.getSetCookie().map((entry) => entry.split(';')[0]).join('; ');

    for (const asset of PUBLIC_ASSETS) {
      const response = await fetch(`${base}${asset.url}`, { headers: { cookie } });
      assert.equal(response.status, 200, `${asset.url} status`);
      assert.equal(response.headers.get('content-type'), asset.type, `${asset.url} content-type`);
      assert.equal(await response.text(), fs.readFileSync(path.resolve(asset.file), 'utf8'), `${asset.url} body`);
    }
  });
});

test('cache-busting query strings resolve before login', async () => {
  await withAssets(async () => {
    for (const [asset, query] of [
      [PUBLIC_ASSETS[0], '?v=2'],
      [PUBLIC_ASSETS[1], '?update=1'],
      [PUBLIC_ASSETS[2], '?v=2'],
      [PUBLIC_ASSETS[3], '?v=2'],
      [PUBLIC_ASSETS[4], '?v=2'],
    ]) {
      const response = await fetch(`${base}${asset.url}${query}`);
      // No cookie, no bearer: a 401 here means the shell cannot style or boot itself.
      assert.equal(response.status, 200, `${asset.url}${query} status`);
      assert.equal(response.headers.get('content-type'), asset.type, `${asset.url}${query} content-type`);
      assert.equal(await response.text(), fs.readFileSync(path.resolve(asset.file), 'utf8'), `${asset.url}${query} body`);
    }
  });
});

test('query strings do not change authenticated asset behavior', async () => {
  await withAssets(async () => {
    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: base },
      body: JSON.stringify({ adminToken: 'static-token' }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().map((entry) => entry.split(';')[0]).join('; ');

    for (const asset of PUBLIC_ASSETS) {
      const response = await fetch(`${base}${asset.url}?v=2`, { headers: { cookie } });
      assert.equal(response.status, 200, `${asset.url} status`);
      assert.equal(response.headers.get('content-type'), asset.type, `${asset.url} content-type`);
      assert.equal(await response.text(), fs.readFileSync(path.resolve(asset.file), 'utf8'), `${asset.url} body`);
    }
  });
});

test('a query string cannot make a non-asset path public', async () => {
  // The exemption keys on the exact pathname, so decorating any other route must not
  // smuggle it past authentication.
  for (const attempt of [
    '/api/tasks?v=2',
    '/api/workspaces?v=2',
    '/api/stop?v=2',
    '/jarvis.css.map?v=2',
    '/jarvis.jsx?v=2',
    '/jarvis.js.map?v=2',
    '/package.json?v=2',
    '/.env?v=2',
    '/apps/api/server.js?v=2',
    '/jarvis.js/extra?v=2',
    '/notjarvis.js?v=2',
    '/jarvis.js%2E%2E%2Fpackage.json?v=2',
    '/../package.json?v=2',
    '/jarvis.css/../../../package.json?v=2',
  ]) {
    const response = await fetch(`${base}${attempt}`, { redirect: 'manual' });
    assert.ok(response.status === 404 || response.status === 401, `${attempt} -> ${response.status}`);
    const body = await response.text();
    assert.doesNotMatch(body, /"dependencies"|root:x:|PUBLIC_ASSETS/, `${attempt} leaked file contents`);
  }
});

test('API routes with query strings keep their authentication boundary', async () => {
  // Unauthenticated: still refused.
  for (const attempt of ['/api/tasks?limit=1', '/api/workspaces?x=1']) {
    assert.equal((await fetch(`${base}${attempt}`)).status, 401, `${attempt} must stay authenticated`);
  }
  // Authenticated: still reachable, so the fix did not narrow anything either.
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: base },
    body: JSON.stringify({ adminToken: 'static-token' }),
  });
  const cookie = login.headers.getSetCookie().map((entry) => entry.split(';')[0]).join('; ');
  assert.equal((await fetch(`${base}/api/tasks?limit=1`, { headers: { cookie } })).status, 200);
});

test('a malformed request target fails safely', async () => {
  // Sent raw: fetch() would reject these before they ever hit the server.
  for (const target of ['http://', '//\\', '/%']) {
    const status = await new Promise((resolve, reject) => {
      const socket = net.connect(8899, 'localhost', () => {
        socket.write(`GET ${target} HTTP/1.1\r\nHost: localhost:8899\r\nConnection: close\r\n\r\n`);
      });
      let raw = '';
      socket.on('data', (chunk) => { raw += chunk; });
      socket.on('end', () => resolve(Number(raw.split(' ')[1])));
      socket.on('error', reject);
    });
    assert.ok(status >= 400 && status < 500, `${target} -> ${status} (must refuse, not fault)`);
  }
});

test('a missing allowlisted asset answers 404 instead of a truncated 200', async () => {
  // The Jarvis shell assets ship on the Jarvis UI branch; on this branch they are absent.
  for (const asset of PUBLIC_ASSETS) {
    const present = fs.existsSync(path.resolve(asset.file));
    const response = await fetch(`${base}${asset.url}`);
    if (present) {
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('content-type'), asset.type);
      if (asset.immutable) assert.match(response.headers.get('cache-control'), /immutable/);
    } else {
      assert.equal(response.status, 404, `${asset.url} must 404 when absent`);
      assert.deepEqual(await response.json(), { error: 'not found' });
    }
  }
});

test('the shell entry points keep their existing behavior', async () => {
  for (const url of ['/', '/jarvis']) {
    const response = await fetch(`${base}${url}`);
    assert.equal(response.status, 200, `${url} status`);
    assert.match(response.headers.get('content-type'), /text\/html/, `${url} content-type`);
    // TEST_MODE is off here, so both paths serve the real shell, not the test-mode page.
    assert.equal(await response.text(), fs.readFileSync(path.resolve('apps/jarvis-pwa/public/index.html'), 'utf8'), `${url} body`);
  }
});

test('immutable assets are only marked immutable when they are immutable', async () => {
  const sw = await fetch(`${base}/sw.js`);
  // The service worker must stay revalidatable or clients can never receive an update.
  assert.doesNotMatch(sw.headers.get('cache-control') ?? '', /immutable/);
});

test('asset lookup is exact-match and cannot be walked out of', async () => {
  for (const attempt of [
    '/../package.json',
    '/sw.js/../../../package.json',
    '/manifest.webmanifest/../../../../etc/passwd',
    '/helix-core.js%2f..%2f..%2fpackage.json',
    '/manifest-anything',
    '/sw.js.map',
    '/jarvis.js.map',
    '/jarvis.css.map',
    '/jarvis.js/../../../package.json',
    '/jarvis.css/../../../../etc/passwd',
    '/jarvis.js%2e%2e%2f%2e%2e%2fpackage.json',
    '/apps/api/server.js',
    '/package.json',
    '/.env',
    '/apps/jarvis-pwa/public/jarvis.js',
    '/jarvis.js/',
    '/JARVIS.JS',
  ]) {
    const response = await fetch(`${base}${attempt}`, { redirect: 'manual' });
    assert.ok(response.status === 404 || response.status === 401, `${attempt} -> ${response.status}`);
    const body = await response.text();
    assert.doesNotMatch(body, /"dependencies"|root:x:/, `${attempt} leaked file contents`);
  }
});

test('asset responses carry the unchanged security headers', async () => {
  const response = await fetch(`${base}/manifest.webmanifest`);
  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.doesNotMatch(csp, /\*/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
});

test('production CSP does not permit inline script or style', async () => {
  // The dev CSP intentionally allows inline; only the production policy must be strict, so
  // assert it against a real production-mode boot rather than this test server.
  const child = spawn(process.execPath, ['apps/api/server.js'], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: '8901',
      BLACKSPIRE_DB_PATH: path.join(root, 'prod-csp.sqlite'),
      COMMAND_ADMIN_TOKEN: crypto.randomBytes(24).toString('hex'),
      SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
      PUBLIC_BASE_URL: 'https://command.example.com',
      TRUST_PROXY: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on('data', (chunk) => { if (String(chunk).includes('"port"')) resolve(); });
      child.on('exit', (code) => reject(new Error(`production API exited with ${code}`)));
    });
    const csp = (await fetch('http://localhost:8901/manifest.webmanifest')).headers.get('content-security-policy');
    assert.doesNotMatch(csp, /unsafe-inline/, 'production CSP must never allow inline');
    assert.doesNotMatch(csp, /unsafe-eval/);
    assert.doesNotMatch(csp, /\*/, 'production CSP must not use wildcard origins');
    assert.match(csp, /script-src 'self';/);
    assert.match(csp, /style-src 'self';/);
    assert.match(csp, /default-src 'self';/);
  } finally {
    child.kill('SIGTERM');
  }
});

test('close static asset API', () => {
  server.close();
  closeDb();
});
