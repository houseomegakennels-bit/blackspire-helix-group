import test from 'node:test';
import assert from 'node:assert/strict';
process.env.PORT = '8791';
process.env.BLACKSPIRE_DB_PATH = '.blackspire-command/integration.sqlite';
process.env.HERMES_TEST_PROVIDER = 'mock';
process.env.COMMAND_ADMIN_TOKEN = 'dev-admin-token-change-me';

import fs from 'node:fs';
fs.rmSync('.blackspire-command/integration.sqlite', { force: true });
fs.rmSync('.blackspire-command/integration.sqlite-wal', { force: true });
fs.rmSync('.blackspire-command/integration.sqlite-shm', { force: true });
const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { start } = await import('../apps/api/server.js');
const { handleTelegramUpdate, sendTelegramMessage, runPolling } = await import('../apps/telegram/bot.js');
const { callOpenAI, callAnthropic } = await import('../packages/providers/providers.js');
const { createPullRequest } = await import('../packages/github/github.js');

let server;
test('start api', async () => {
  server = start(8791, undefined, { exitOnListenError: false });
  await fetch('http://localhost:8791/api/stop/reset', { method: 'POST', headers: { authorization: 'Bearer dev-admin-token-change-me' } });
  assert.ok(server);
});

test('api health/readiness and jarvis command submission', async () => {
  let response = await fetch('http://localhost:8791/health');
  assert.equal(response.status, 200);
  response = await fetch('http://localhost:8791/api/tasks', { method: 'POST', headers: { authorization: 'Bearer dev-admin-token-change-me', 'content-type': 'application/json' }, body: JSON.stringify({ request: 'safe task', workspaceId: 'blackspire-command' }) });
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.ok(body.task.id);
});

test('telegram unauthorized users are ignored', async () => {
  const result = await handleTelegramUpdate({ update_id: 1, message: { from: { id: 999 }, chat: { id: 1 }, text: '/status' } }, 'http://localhost:8791');
  assert.equal(result.ignored, true);
});

test('telegram command creates stored task', async () => {
  const result = await handleTelegramUpdate({ update_id: 2, message: { from: { id: 1001 }, chat: { id: 1 }, text: '/task document status' } }, 'http://localhost:8791');
  assert.ok(result.text[0].includes('Queued'));
});

test('approval flow and cancellation endpoints work', async () => {
  let response = await fetch('http://localhost:8791/api/tasks', { method: 'POST', headers: { authorization: 'Bearer dev-admin-token-change-me', 'content-type': 'application/json' }, body: JSON.stringify({ request: 'deploy to production', workspaceId: 'blackspire-command' }) });
  const id = (await response.json()).task.id;
  response = await fetch(`http://localhost:8791/api/tasks/${id}/approve`, { method: 'POST', headers: { authorization: 'Bearer dev-admin-token-change-me' } });
  assert.equal(response.status, 200);
  response = await fetch(`http://localhost:8791/api/tasks/${id}/cancel`, { method: 'POST', headers: { authorization: 'Bearer dev-admin-token-change-me' } });
  const cancelBody = await response.json();
  assert.equal(cancelBody.task?.status, 'cancelled');
});

test('github branch/pr flow creates task packet when GitHub credentials are unavailable', () => {
  const result = createPullRequest({ title: 'Test', body: 'Body' });
  assert.equal(result.mode, 'task-packet');
});

test('telegram sendMessage uses real Bot API shape when token is supplied', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => ({ ok: true, json: async () => ({ ok: true, url: String(url), body: JSON.parse(options.body) }) });
  const sent = await sendTelegramMessage('mock-token', 123, 'hello');
  globalThis.fetch = originalFetch;
  assert.equal(sent[0].ok, true);
  assert.equal(sent[0].body.chat_id, 123);
});

test('telegram polling enters dry-run mode without bot token', async () => {
  const runtime = await runPolling({ token: '', pollMs: 10 });
  assert.equal(runtime.mode, 'dry-run');
});

test('provider API adapters report missing credentials without pretending to run', async () => {
  assert.equal((await callOpenAI({ prompt: 'hello' })).mode, 'unconfigured');
  assert.equal((await callAnthropic({ prompt: 'hello' })).mode, 'unconfigured');
});

test('emergency stop prevents new work', async () => {
  await fetch('http://localhost:8791/api/stop', { method: 'POST', headers: { authorization: 'Bearer dev-admin-token-change-me' } });
  const response = await fetch('http://localhost:8791/api/tasks', { method: 'POST', headers: { authorization: 'Bearer dev-admin-token-change-me', 'content-type': 'application/json' }, body: JSON.stringify({ request: 'blocked' }) });
  assert.equal(response.status, 423);
});

test('close api', () => server.close());
