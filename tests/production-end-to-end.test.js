// End-to-end proof of the real production execution path.
//
//   authenticated API task creation -> durable queue -> worker claim
//   -> production Hermes dispatch -> server-selected real provider
//   -> real provider call -> applied artifacts -> persisted evidence
//   -> observable through the API
//
// Everything above the network socket is production code: production runtime
// mode, the production Hermes mode, the real worker loop, the real dispatch
// guard and the real providers module. Only the outbound HTTPS transport is
// substituted, so the proof is deterministic and costs nothing, while the
// provider request that is asserted on is the exact bytes the worker would
// have put on the wire.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-production-e2e-'));
process.env.BLACKSPIRE_DATA_DIR = root;
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'production-e2e.sqlite');
process.env.COMMAND_ADMIN_TOKEN = 'production-e2e-admin-token-0123456789';
process.env.PORT = '8907';
process.env.BIND_HOST = '127.0.0.1';
// Server-side production authority. None of this is reachable from a request body.
process.env.BLACKSPIRE_RUNTIME_MODE = 'production';
process.env.BLACKSPIRE_HERMES_MODE = 'production';
process.env.BLACKSPIRE_PRODUCTION_PROVIDERS = 'openai';
process.env.BLACKSPIRE_PRODUCTION_MODEL = 'server-authoritative-model';
process.env.OPENAI_API_KEY = 'e2e-proof-credential-0123456789';
process.env.OPENAI_MODEL = 'worker-local-default-model';
delete process.env.BLACKSPIRE_PROVIDER_MODE;
delete process.env.HERMES_TEST_PROVIDER;
delete process.env.UNIFIED_IPHONE_TEST_MODE;

const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { start } = await import('../apps/api/server.js');
const { startWorker } = await import('../apps/worker/worker.js');
const { upsertWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { getTask, taskRecords } = await import('../packages/task-engine/tasks.js');
const { closeDb } = await import('../packages/task-engine/db.js');

const ADMIN = { authorization: `Bearer ${process.env.COMMAND_ADMIN_TOKEN}`, 'content-type': 'application/json' };
const BASE = 'http://localhost:8907';

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function createRepo() {
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  git(['init', '-b', 'main'], repo);
  git(['config', 'user.email', 'test@example.com'], repo);
  git(['config', 'user.name', 'Test User'], repo);
  fs.writeFileSync(path.join(repo, 'docs/.keep'), '');
  git(['add', '.'], repo);
  git(['commit', '-m', 'initial'], repo);
  return repo;
}

// Stands in for the provider's HTTPS endpoint only. It records every outbound
// request so the test can assert on what production actually sent.
const outbound = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const target = String(url);
  if (!target.startsWith('https://api.openai.com/')) return realFetch(url, init);
  const body = JSON.parse(init.body);
  outbound.push({ url: target, authorization: init.headers.authorization, body });
  return {
    ok: true,
    json: async () => ({
      output_text: JSON.stringify({
        artifacts: [{ path: 'docs/production-proof.md', content: '# Production proof\n\nWritten by the configured provider.\n' }],
        summary: 'Wrote the requested proof document.',
      }),
      usage: { input_tokens: 120, output_tokens: 45 },
    }),
  };
};

const repo = createRepo();
upsertWorkspace({
  id: 'production-e2e', name: 'Production E2E', description: 'production end-to-end proof',
  githubRepository: 'local/production-e2e', defaultBranch: 'main', allowedPaths: ['docs'],
  buildCommands: ['true'], providerPolicy: { preferred: ['openai'] }, riskLevel: 'low',
  budgetCents: 500, secretReferences: [], enabledTools: ['read', 'status', 'write_branch'],
  lastHealthStatus: 'ok', rootPath: repo,
});

const server = start(8907, undefined, { exitOnListenError: false });
await fetch(`${BASE}/api/stop/reset`, { method: 'POST', headers: ADMIN });

async function submit(request, idempotencyKey) {
  const response = await fetch(`${BASE}/api/tasks`, {
    method: 'POST', headers: ADMIN,
    body: JSON.stringify({ workspaceId: 'production-e2e', request, idempotencyKey }),
  });
  return { status: response.status, body: await response.json() };
}

let taskId = null;

test('unauthenticated callers cannot create a production task', async () => {
  const response = await fetch(`${BASE}/api/tasks`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workspaceId: 'production-e2e', request: 'write `docs/x.md`', idempotencyKey: 'unauthenticated' }),
  });
  assert.ok(response.status === 401 || response.status === 403, `expected an auth failure, got ${response.status}`);
});

test('an authenticated request is queued durably and not executed inline', async () => {
  const { status, body } = await submit('write a short proof note to `docs/production-proof.md`', 'production-e2e-1');
  assert.equal(status, 202);
  taskId = body.task.id;
  assert.equal(body.task.status, 'queued');
  assert.equal(outbound.length, 0, 'the API must not reach a provider itself');
});

test('the worker claims the queued task and reaches the real configured provider', async () => {
  await startWorker({ once: true });
  assert.equal(outbound.length >= 1, true, 'the worker dispatched to the provider endpoint');
});

test('the provider request carries the server-chosen model and credential, not a request-supplied one', () => {
  const [call] = outbound;
  assert.equal(call.url, 'https://api.openai.com/v1/responses');
  assert.equal(call.body.model, 'server-authoritative-model');
  assert.notEqual(call.body.model, 'worker-local-default-model');
  assert.equal(call.authorization, `Bearer ${process.env.OPENAI_API_KEY}`);
});

test('the task completes and its persisted record names the real provider, never mock', () => {
  const task = getTask(taskId);
  assert.equal(task.status, 'completed', task.error || 'task did not complete');
  const records = taskRecords(taskId);
  const attempt = records.providerAttempts.at(-1);
  assert.equal(attempt.provider, 'openai');
  assert.equal(attempt.mode, 'api');
  assert.equal(attempt.status, 'completed');
  assert.ok(!records.providerAttempts.some((row) => row.provider === 'mock'), 'no mock attempt occurred');
});

test('the provider artifacts were actually applied inside the workspace allowlist', () => {
  const written = path.join(repo, 'docs/production-proof.md');
  assert.ok(fs.existsSync(written), 'the provider artifact was written to the workspace');
  assert.match(fs.readFileSync(written, 'utf8'), /Written by the configured provider/);
  const changed = taskRecords(taskId).changedFiles.map((row) => row.path);
  assert.ok(changed.some((file) => file.includes('docs/production-proof.md')), `changed files: ${changed.join(',')}`);
});

test('the durable event and usage trail records the executed provider and model', () => {
  const records = taskRecords(taskId);
  const usage = records.usage.at(-1);
  assert.equal(usage.provider, 'openai');
  assert.equal(usage.mode, 'api');
  // The executed model is recorded on the provider attempt, which is the canonical
  // "what actually ran" record; provider_usage stores only provider/mode/tokens.
  const executed = JSON.parse(records.providerAttempts.at(-1).response_packet);
  assert.equal(executed.model, 'server-authoritative-model');
  assert.ok(records.evidence.some((row) => row.kind === 'final'), 'final evidence was persisted');
  assert.ok(records.evidence.some((row) => row.kind === 'dispatch_attempt'), 'the dispatch attempt was persisted');
});

test('the completed result is observable through the API and leaks no credential', async () => {
  const response = await fetch(`${BASE}/api/tasks/${taskId}`, { headers: ADMIN });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(!text.includes(process.env.OPENAI_API_KEY), 'the API response must not contain the provider credential');
  const body = JSON.parse(text);
  assert.equal(body.task.status, 'completed');
});

test('a restarted worker sees the durable completed state rather than re-running the task', async () => {
  const before = outbound.length;
  await startWorker({ once: true });
  assert.equal(outbound.length, before, 'a completed task is not re-dispatched after restart');
  assert.equal(getTask(taskId).status, 'completed');
});

test.after(() => {
  globalThis.fetch = realFetch;
  server?.close?.();
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
});
