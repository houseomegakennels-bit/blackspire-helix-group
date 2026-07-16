import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-hermes-'));
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'command.sqlite');
process.env.HERMES_TEST_PROVIDER = 'mock';
process.env.COMMAND_ADMIN_TOKEN = 'test-token';
process.env.PORT = '8891';

const { start } = await import('../apps/api/server.js');
const { startWorker } = await import('../apps/worker/worker.js');
const { upsertWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { getTask, taskRecords, setFlag, getFlag } = await import('../packages/task-engine/tasks.js');
const { executeProviderRequest } = await import('../packages/providers/providers.js');

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function createRepo() {
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  git(['init', '-b', 'main'], repo);
  git(['config', 'user.email', 'test@example.com'], repo);
  git(['config', 'user.name', 'Test User'], repo);
  fs.writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }, null, 2));
  fs.mkdirSync(path.join(repo, 'test'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'test/basic.test.js'), "import test from 'node:test'; import assert from 'node:assert/strict'; test('ok',()=>assert.equal(1,1));\n");
  git(['add', '.'], repo);
  git(['commit', '-m', 'initial'], repo);
  return repo;
}

let server;
let repo;

test('setup temporary workspace and API', async () => {
  repo = createRepo();
  upsertWorkspace({ id: 'temp-coding', name: 'Temp Coding Workspace', githubRepository: 'local/temp-coding', defaultBranch: 'main', allowedPaths: ['docs'], buildCommands: ['npm test'], providerPolicy: { preferred: ['mock'] }, rootPath: repo, enabledTools: ['write_branch', 'test', 'draft_pr'] });
  server = start(8891);
  await fetch('http://localhost:8891/api/stop/reset', { method: 'POST', headers: { authorization: 'Bearer test-token' } });
  assert.ok(server);
});

test('API queues but does not process directly', async () => {
  const response = await fetch('http://localhost:8891/api/tasks', { method: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: 'temp-coding', request: 'Create `docs/proof.md` with proof text', idempotencyKey: 'api-only' }) });
  const task = (await response.json()).task;
  assert.equal(task.status, 'queued');
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(getTask(task.id).status, 'queued');
});

test('mocked provider adapter returns normalized proposed edit artifacts', async () => {
  const result = await executeProviderRequest({ selected: { provider: 'mock', mode: 'mock' }, packet: { request: 'Create `docs/provider.md`' }, workspace: { root_path: repo } });
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'mock');
  assert.ok(result.artifacts[0].path.startsWith('docs/'));
  assert.ok(result.usage);
});

test('worker claims task and Hermes completes branch edit validation commit and evidence', async () => {
  const response = await fetch('http://localhost:8891/api/tasks', { method: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: 'temp-coding', request: 'Create `docs/proof.md` with proof text', idempotencyKey: 'coding-flow' }) });
  const taskId = (await response.json()).task.id;
  for (let i = 0; i < 6 && getTask(taskId).status === 'queued'; i += 1) await startWorker({ once: true });
  const task = getTask(taskId);
  assert.equal(task.status, 'completed');
  assert.equal(git(['branch', '--show-current'], repo), `hermes/${taskId}`);
  assert.ok(fs.existsSync(path.join(repo, 'docs/proof.md')));
  const records = taskRecords(taskId);
  assert.ok(records.subtasks.length >= 8);
  assert.ok(records.providerAttempts.some((attempt) => attempt.status === 'completed'));
  assert.ok(records.changedFiles.some((file) => file.path.startsWith('docs/')));
  assert.ok(records.commands.some((command) => command.ok === 1));
  assert.ok(records.evidence.some((evidence) => evidence.kind === 'final'));
  assert.match(git(['log', '--oneline', '-1'], repo), /Hermes task/);
});

test('high-risk task pauses for approval before provider execution', async () => {
  git(['switch', 'main'], repo);
  const response = await fetch('http://localhost:8891/api/tasks', { method: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: 'temp-coding', request: 'deploy to production', idempotencyKey: 'approval-flow' }) });
  const taskId = (await response.json()).task.id;
  for (let i = 0; i < 6 && getTask(taskId).status === 'queued'; i += 1) await startWorker({ once: true });
  const task = getTask(taskId);
  assert.equal(task.status, 'waiting_for_approval');
  assert.equal(taskRecords(taskId).providerAttempts.length, 0);
});

test('cancellation prevents subsequent stages', async () => {
  const response = await fetch('http://localhost:8891/api/tasks', { method: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: 'temp-coding', request: 'Create `docs/cancelled.md`', idempotencyKey: 'cancel-flow' }) });
  const taskId = (await response.json()).task.id;
  await fetch(`http://localhost:8891/api/tasks/${taskId}/cancel`, { method: 'POST', headers: { authorization: 'Bearer test-token' } });
  await startWorker({ once: true });
  assert.equal(getTask(taskId).status, 'cancelled');
  assert.equal(taskRecords(taskId).providerAttempts.length, 0);
});

test('emergency stop prevents worker claims', async () => {
  setFlag('emergency_stop', 'active');
  const response = await fetch('http://localhost:8891/api/tasks', { method: 'POST', headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: 'temp-coding', request: 'Create `docs/blocked.md`', idempotencyKey: 'blocked-flow' }) });
  assert.equal(response.status, 423);
  assert.equal(getFlag('emergency_stop'), 'active');
  setFlag('emergency_stop', 'inactive');
});

test('close API', () => server.close());
