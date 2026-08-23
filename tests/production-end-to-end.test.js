// End-to-end proof of the real production execution path.
//
//   authenticated API task creation -> durable queue -> worker claim
//   -> production Hermes dispatch -> server-selected real provider
//   -> authenticated Codex CLI provider module -> applied artifacts -> persisted evidence
//   -> observable through the API
//
// Everything around the external client is production code: production runtime
// mode, the production Hermes mode, the real worker loop, the real dispatch
// guard and the real providers module. Only the Codex executable is substituted,
// so the proof is deterministic, costs nothing, and still exercises the CLI
// execution mode production now permits.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-production-e2e-'));
const binDir = path.join(root, 'bin');
fs.mkdirSync(binDir, { recursive: true });
process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
process.env.BLACKSPIRE_DATA_DIR = root;
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'production-e2e.sqlite');
process.env.COMMAND_ADMIN_TOKEN = 'production-e2e-admin-token-0123456789';
process.env.PORT = '8907';
process.env.BIND_HOST = '127.0.0.1';
// Server-side production authority. None of this is reachable from a request body.
process.env.BLACKSPIRE_RUNTIME_MODE = 'production';
process.env.BLACKSPIRE_HERMES_MODE = 'production';
process.env.BLACKSPIRE_PRODUCTION_PROVIDERS = 'codex';
process.env.BLACKSPIRE_PRODUCTION_MODEL = 'server-authoritative-model';
process.env.BLACKSPIRE_PRODUCTION_EXECUTION = 'enabled';
process.env.CODEX_HOME = path.join(root, 'codex-home');
fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });
delete process.env.OPENAI_API_KEY;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.CODEX_API_KEY;
delete process.env.CODEX_API_ENDPOINT;
process.env.OPENAI_MODEL = 'worker-local-default-model';
delete process.env.BLACKSPIRE_PROVIDER_MODE;
delete process.env.HERMES_TEST_PROVIDER;
delete process.env.UNIFIED_IPHONE_TEST_MODE;

const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { start } = await import('../apps/api/server.js');
const { startWorker } = await import('../apps/worker/worker.js');
const { upsertWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { getTask, recordProviderAttempt, taskRecords } = await import('../packages/task-engine/tasks.js');
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

const codexInvocations = [];
const codexLog = path.join(root, 'codex-invocations.jsonl');
fs.writeFileSync(path.join(binDir, 'codex'), `#!/usr/bin/env bash
set -euo pipefail
case "\${1:-}" in
  --version)
    printf 'codex-cli 999.0.0-test\\n'
    ;;
  doctor)
    if [[ "\${2:-}" == "--json" ]]; then
      printf '{"checks":{"auth.credentials":{"status":"ok","summary":"auth is configured"}}}\\n'
    else
      printf 'auth is configured\\n'
    fi
    ;;
  exec)
    prompt="\${*: -1}"
    packet="\${prompt#* at }"
    packet="\${packet%%. Return*}"
    final=""
    for ((i=1; i<=$#; i++)); do
      if [[ "\${!i}" == "--output-last-message" ]]; then
        j=$((i+1))
        final="\${!j}"
      fi
    done
    printf '{"argv":%s,"cwd":%s,"env":%s}\\n' "$(node -e 'console.log(JSON.stringify(process.argv.slice(1)))' "$@")" "$(node -e 'console.log(JSON.stringify(process.cwd()))')" "$(node -e 'console.log(JSON.stringify({COMMAND_ADMIN_TOKEN:process.env.COMMAND_ADMIN_TOKEN||null,SESSION_SECRET:process.env.SESSION_SECRET||null,GITHUB_TOKEN:process.env.GITHUB_TOKEN||null,OPENAI_API_KEY:process.env.OPENAI_API_KEY||null,ANTHROPIC_API_KEY:process.env.ANTHROPIC_API_KEY||null,CODEX_API_KEY:process.env.CODEX_API_KEY||null,HOME:process.env.HOME||null,PATH:Boolean(process.env.PATH)}))')" >> "${codexLog}"
    if grep -q 'malformed-codex' "$packet"; then
      printf '{"type":"thread.started"}\\n'
      printf 'not-json\\n'
      exit 0
    fi
    printf '{"artifacts":[{"path":"docs/production-proof.md","content":"# Production proof\\\\n\\\\nWritten by the configured Codex CLI provider.\\\\n"}],"summary":"Wrote the requested proof document.","usage":{"inputTokens":120,"outputTokens":45}}\\n' > "$final"
    printf '{"type":"thread.started","thread_id":"fixture"}\\n'
    printf '{"type":"turn.started"}\\n'
    printf '{"type":"item.completed","item":{"type":"message","message":{"content":[{"text":"progress"}]}}}\\n'
    printf '{"type":"turn.completed"}\\n'
    ;;
  *)
    exit 64
    ;;
esac
`);
fs.chmodSync(path.join(binDir, 'codex'), 0o755);

// The allowed production path for this milestone is Codex CLI. Any outbound API
// fetch during the provider phase would mean the test stopped proving that path.
const outbound = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const target = String(url);
  if (target.startsWith('https://api.openai.com/') || target.startsWith('https://api.anthropic.com/')) {
    outbound.push({ url: target, authorization: init.headers?.authorization || init.headers?.['x-api-key'] || null });
    throw new Error('metered API provider must not be reached by the Codex production E2E');
  }
  return realFetch(url, init);
};

const repo = createRepo();
upsertWorkspace({
  id: 'production-e2e', name: 'Production E2E', description: 'production end-to-end proof',
  githubRepository: 'local/production-e2e', defaultBranch: 'main', allowedPaths: ['docs'],
  buildCommands: ['true'], providerPolicy: { preferred: ['codex'] }, riskLevel: 'low',
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

test('the worker claims the queued task and reaches the real configured Codex CLI provider', async () => {
  await startWorker({ once: true });
  const lines = fs.readFileSync(codexLog, 'utf8').trim().split('\n').filter(Boolean);
  codexInvocations.push(...lines.map((line) => JSON.parse(line)));
  assert.equal(codexInvocations.length, 1, 'the worker invoked Codex CLI exactly once');
  assert.equal(outbound.length, 0, 'no metered API provider endpoint was reached');
});

test('the provider record carries the server-chosen model, not a request-supplied one', () => {
  assert.deepEqual(codexInvocations[0].argv.slice(0, 2), ['exec', '--json']);
  assert.equal(codexInvocations[0].argv[codexInvocations[0].argv.indexOf('--model') + 1], 'server-authoritative-model');
  assert.equal(codexInvocations[0].argv[codexInvocations[0].argv.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(codexInvocations[0].cwd, repo);
  assert.equal(codexInvocations[0].env.COMMAND_ADMIN_TOKEN, null);
  assert.equal(codexInvocations[0].env.SESSION_SECRET, null);
  assert.equal(codexInvocations[0].env.GITHUB_TOKEN, null);
  assert.equal(codexInvocations[0].env.OPENAI_API_KEY, null);
  assert.equal(codexInvocations[0].env.ANTHROPIC_API_KEY, null);
  assert.equal(codexInvocations[0].env.CODEX_API_KEY, null);
  assert.equal(codexInvocations[0].env.PATH, true);
  const task = getTask(taskId);
  assert.equal(task.status, 'completed', task.error || 'task did not complete');
  const executed = JSON.parse(taskRecords(taskId).providerAttempts.at(-1).response_packet);
  assert.equal(executed.model, 'server-authoritative-model');
  assert.notEqual(executed.model, 'worker-local-default-model');
});

test('the task completes and its persisted record names the real provider, never mock', () => {
  const task = getTask(taskId);
  assert.equal(task.status, 'completed', task.error || 'task did not complete');
  const records = taskRecords(taskId);
  const attempt = records.providerAttempts.at(-1);
  assert.equal(records.providerAttempts.filter((row) => row.provider === 'codex').length, 1, 'Codex uses one durable attempt lifecycle row');
  assert.equal(attempt.provider, 'codex');
  assert.equal(attempt.mode, 'cli');
  assert.equal(attempt.status, 'completed');
  assert.ok(!records.providerAttempts.some((row) => row.provider === 'mock'), 'no mock attempt occurred');
});

test('the provider artifacts were actually applied inside the workspace allowlist', () => {
  const written = path.join(repo, 'docs/production-proof.md');
  assert.ok(fs.existsSync(written), 'the provider artifact was written to the workspace');
  assert.match(fs.readFileSync(written, 'utf8'), /Written by the configured Codex CLI provider/);
  const changed = taskRecords(taskId).changedFiles.map((row) => row.path);
  assert.ok(changed.some((file) => file.includes('docs/production-proof.md')), `changed files: ${changed.join(',')}`);
  assert.ok(!changed.some((file) => file.includes('.hermes-task-packets')), `control files leaked into changed files: ${changed.join(',')}`);
  assert.doesNotMatch(git(['status', '--porcelain', '-uall'], repo), /\.hermes-task-packets/);
});

test('the durable event and usage trail records the executed provider and model', () => {
  const records = taskRecords(taskId);
  const usage = records.usage.at(-1);
  assert.equal(usage.provider, 'codex');
  assert.equal(usage.mode, 'cli');
  assert.equal(usage.cost_cents, null);
  assert.equal(usage.monetary_cost_state, 'subscription_unmetered');
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
  assert.ok(!text.includes('e2e-proof-credential'), 'the API response must not contain provider credential material');
  const body = JSON.parse(text);
  assert.equal(body.task.status, 'completed');
});

test('a restarted worker sees the durable completed state rather than re-running the task', async () => {
  const before = codexInvocations.length;
  await startWorker({ once: true });
  const lines = fs.readFileSync(codexLog, 'utf8').trim().split('\n').filter(Boolean);
  assert.equal(lines.length, before, 'a completed task is not re-dispatched after restart');
  assert.equal(getTask(taskId).status, 'completed');
});

test('a failed production Codex invocation is not retried for the same task', async () => {
  const before = fs.readFileSync(codexLog, 'utf8').trim().split('\n').filter(Boolean).length;
  const { status, body } = await submit('malformed-codex fixture should fail once', 'production-e2e-malformed');
  assert.equal(status, 202);
  await startWorker({ once: true });
  const after = fs.readFileSync(codexLog, 'utf8').trim().split('\n').filter(Boolean).length;
  assert.equal(after, before + 1, 'production Codex must not retry a failed subscription invocation');
  assert.equal(getTask(body.task.id).status, 'failed');
});

test('a stale-recovered task with a Codex dispatch marker is not invoked again', async () => {
  const before = fs.readFileSync(codexLog, 'utf8').trim().split('\n').filter(Boolean).length;
  const { status, body } = await submit('recover stale codex dispatch marker', 'production-e2e-stale-marker');
  assert.equal(status, 202);
  const staleTask = getTask(body.task.id);
  recordProviderAttempt(body.task.id, {
    provider: 'codex',
    mode: 'cli',
    status: 'started',
    requestPacket: {
      taskId: body.task.id,
      request: 'recover stale codex dispatch marker',
      attempt: 1,
      idempotencyKey: staleTask.idempotency_key,
    },
    responsePacket: { accounting: { monetaryCostState: 'subscription_unmetered', costCents: null } },
    latencyMs: 0,
  });
  await startWorker({ once: true });
  const after = fs.readFileSync(codexLog, 'utf8').trim().split('\n').filter(Boolean).length;
  assert.equal(after, before, 'stale recovery must not re-dispatch a task after a Codex start marker');
  assert.equal(getTask(body.task.id).status, 'failed');
  assert.match(getTask(body.task.id).error, /outcome unknown.*automatic replay refused/i);
  assert.equal(taskRecords(body.task.id).providerAttempts.find((row) => row.provider === 'codex').status, 'outcome_unknown');
});

test.after(() => {
  globalThis.fetch = realFetch;
  server?.close?.();
  closeDb();
  fs.rmSync(root, { recursive: true, force: true });
});
