import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-jarvis-'));
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'jarvis.sqlite');
process.env.COMMAND_ADMIN_TOKEN = 'jarvis-token';
process.env.PORT = '8898';
process.env.HERMES_TEST_PROVIDER = 'mock';

const { start } = await import('../apps/api/server.js');

let server;
test('boot API for jarvis tests', () => { server = start(8898); assert.ok(server); });

test('Jarvis markup exposes evidence download, approval history, and status badge wiring', async () => {
  const html = await (await fetch('http://localhost:8898/jarvis')).text();
  assert.doesNotMatch(html, /localStorage/i, 'admin token must never be persisted to localStorage');
  assert.match(html, /downloadExport\('json'\)/);
  assert.match(html, /downloadExport\('md'\)/);
  assert.match(html, /loadApprovalHistory/);
  assert.match(html, /api\/tasks\/\$\{selectedTaskId\}\/export\.\$\{format\}/);
  assert.match(html, /renderStatus/);
  assert.match(html, /Emergency stop/);
  assert.match(html, /Telegram: /);
  assert.match(html, /Session expired/);
  assert.match(html, /viewport/);
});

test('unauthenticated api() calls surface a 401 instead of throwing, so the UI can prompt re-login', async () => {
  const response = await fetch('http://localhost:8898/api/tasks');
  assert.equal(response.status, 401);
});

test('evidence export route works end to end for the Jarvis download action', async () => {
  const created = await fetch('http://localhost:8898/api/tasks', { method: 'POST', headers: { authorization: 'Bearer jarvis-token', 'content-type': 'application/json' }, body: JSON.stringify({ request: 'jarvis export check', idempotencyKey: 'jarvis-export' }) });
  const taskId = (await created.json()).task.id;
  const exportResponse = await fetch(`http://localhost:8898/api/tasks/${taskId}/export.json`, { headers: { authorization: 'Bearer jarvis-token' } });
  assert.equal(exportResponse.status, 200);
  const approvalsResponse = await fetch(`http://localhost:8898/api/tasks/${taskId}/approvals`, { headers: { authorization: 'Bearer jarvis-token' } });
  assert.equal(approvalsResponse.status, 200);
  assert.ok(Array.isArray((await approvalsResponse.json()).approvals));
});

test('close API for jarvis tests', () => server.close());
