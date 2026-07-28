// Hermes Milestone 2 — API status surface tests.
// Verifies the read-only /api/hermes/runtime endpoint requires auth and returns only redacted
// metadata (never a credential value).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-hermes-m2api-'));
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'm2api.sqlite');
process.env.COMMAND_ADMIN_TOKEN = 'm2-api-token';
process.env.SESSION_SECRET = 'm2-api-session-secret-not-real-000000000000';
process.env.TELEGRAM_ALLOWED_USERS = '1001';
process.env.ANTHROPIC_API_KEY = 'super-secret-should-never-appear';
process.env.ALLOW_BEARER_AUTH = 'true';
process.env.PORT = '8906';

const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { start } = await import('../apps/api/server.js');

const server = start(8906, '127.0.0.1', { exitOnListenError: false });
await new Promise((r) => setTimeout(r, 150));
const base = 'http://127.0.0.1:8906';

test.after(() => { try { server.close(); } catch { /* ignore */ } });

test('GET /api/hermes/runtime requires authentication', async () => {
  const res = await fetch(`${base}/api/hermes/runtime`);
  assert.equal(res.status, 401);
});

test('authenticated status returns redacted metadata and never the credential value', async () => {
  const res = await fetch(`${base}/api/hermes/runtime`, { headers: { authorization: 'Bearer m2-api-token' } });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.ok(!body.includes('super-secret-should-never-appear'), 'credential value must never appear in the status response');
  const json = JSON.parse(body);
  assert.equal(json.executionModeDefault, 'mock');
  const anthropic = json.providers.find((p) => p.id === 'anthropic');
  assert.equal(anthropic.enabled, false, 'anthropic is disabled by default');
  assert.equal(anthropic.authentication, 'configured', 'auth reported as a boolean state, not a value');
  assert.equal(anthropic.productionEligible, false);
});

test('the read-only hermes-runtime page is served', async () => {
  const res = await fetch(`${base}/hermes-runtime`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Hermes Runtime Status/);
});
