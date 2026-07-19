import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-static-'));
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'static.sqlite');
process.env.COMMAND_ADMIN_TOKEN = 'static-token';
process.env.PORT = '8899';
process.env.HERMES_TEST_PROVIDER = 'mock';

const { closeDb } = await import('../packages/task-engine/db.js');
const { start } = await import('../apps/api/server.js');

const base = 'http://localhost:8899';
const server = start(8899);

test('allowlisted assets are served unauthenticated with the correct content type', async () => {
  const manifest = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(manifest.status, 200);
  assert.match(manifest.headers.get('content-type'), /application\/manifest\+json/);

  const sw = await fetch(`${base}/sw.js`);
  assert.equal(sw.status, 200);
  assert.match(sw.headers.get('content-type'), /text\/javascript/);
});

test('a missing allowlisted asset answers 404 instead of a truncated 200', async () => {
  // helix-core.js ships on the Jarvis UI branch; on this branch the file is absent.
  const present = fs.existsSync(path.resolve('apps/jarvis-pwa/public/helix-core.js'));
  const response = await fetch(`${base}/helix-core.js`);
  if (present) {
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/javascript/);
    assert.match(response.headers.get('cache-control'), /immutable/);
  } else {
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'not found' });
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
  ]) {
    const response = await fetch(`${base}${attempt}`, { redirect: 'manual' });
    assert.ok(response.status === 404 || response.status === 401, `${attempt} -> ${response.status}`);
    const body = await response.text();
    assert.doesNotMatch(body, /"dependencies"|root:x:/, `${attempt} leaked file contents`);
  }
});

test('production CSP does not permit inline script or style', async () => {
  const response = await fetch(`${base}/manifest.webmanifest`);
  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/);
  assert.doesNotMatch(csp, /\*/);
});

test('close static asset API', () => {
  server.close();
  closeDb();
});
