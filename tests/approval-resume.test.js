import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-approval-'));
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'approval.sqlite');
process.env.HERMES_TEST_PROVIDER = 'mock';
process.env.COMMAND_ADMIN_TOKEN = 'approval-token';
process.env.PORT = '8895';

const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { start } = await import('../apps/api/server.js');
const { startWorker } = await import('../apps/worker/worker.js');
const { upsertWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { getTask, taskRecords, decideApproval } = await import('../packages/task-engine/tasks.js');

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function repo() {
  const dir = path.join(root, `repo-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  git(['init', '-b', 'main'], dir);
  git(['config', 'user.email', 'approval@example.com'], dir);
  git(['config', 'user.name', 'Approval Test'], dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }));
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'test/basic.test.js'), "import test from 'node:test'; import assert from 'node:assert/strict'; test('ok',()=>assert.equal(1,1));\n");
  git(['add', '.'], dir);
  git(['commit', '-m', 'initial'], dir);
  return dir;
}

let server;

test('setup approval workspace and API', () => {
  const dir = repo();
  upsertWorkspace({ id: 'approval-ws', name: 'Approval Workspace', githubRepository: 'local/approval-ws', defaultBranch: 'main', allowedPaths: ['docs'], buildCommands: ['npm test'], providerPolicy: { preferred: ['mock'] }, rootPath: dir, enabledTools: ['write_branch', 'test', 'draft_pr'] });
  server = start(8895, undefined, { exitOnListenError: false });
  assert.ok(server);
});

test('approved high-risk task resumes exactly once and completes without re-entering the approval loop', async () => {
  const response = await fetch('http://localhost:8895/api/tasks', { method: 'POST', headers: { authorization: 'Bearer approval-token', 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: 'approval-ws', request: 'deploy to production `docs/deploy.md`', idempotencyKey: 'approve-resume-1' }) });
  const taskId = (await response.json()).task.id;

  for (let i = 0; i < 6 && getTask(taskId).status === 'queued'; i += 1) await startWorker({ once: true });
  assert.equal(getTask(taskId).status, 'waiting_for_approval');
  assert.equal(taskRecords(taskId).approvals.length, 1, 'exactly one approval request must be created');

  await fetch(`http://localhost:8895/api/tasks/${taskId}/approve`, { method: 'POST', headers: { authorization: 'Bearer approval-token' } });
  assert.equal(getTask(taskId).status, 'queued');

  for (let i = 0; i < 8 && getTask(taskId).status !== 'completed'; i += 1) await startWorker({ once: true });
  assert.equal(getTask(taskId).status, 'completed', 'approved task must run through to completion, not pause for approval again');
  assert.equal(taskRecords(taskId).approvals.length, 1, 'resuming an approved task must not create a second approval request');
  assert.equal(taskRecords(taskId).approvals[0].status, 'approved');
});

test('rejected high-risk task cannot be forced to run by resuming', async () => {
  const response = await fetch('http://localhost:8895/api/tasks', { method: 'POST', headers: { authorization: 'Bearer approval-token', 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: 'approval-ws', request: 'delete data `docs/rejected.md`', idempotencyKey: 'reject-resume-1' }) });
  const taskId = (await response.json()).task.id;
  for (let i = 0; i < 6 && getTask(taskId).status === 'queued'; i += 1) await startWorker({ once: true });
  assert.equal(getTask(taskId).status, 'waiting_for_approval');

  await fetch(`http://localhost:8895/api/tasks/${taskId}/reject`, { method: 'POST', headers: { authorization: 'Bearer approval-token' } });
  assert.equal(getTask(taskId).status, 'cancelled');

  // Even if something forces the task back to queued, the persisted rejection blocks execution instead of re-prompting.
  await fetch(`http://localhost:8895/api/tasks/${taskId}/resume`, { method: 'POST', headers: { authorization: 'Bearer approval-token' } });
  await startWorker({ once: true });
  assert.equal(getTask(taskId).status, 'failed');
  assert.equal(taskRecords(taskId).providerAttempts.length, 0, 'a rejected task must never reach the provider');
});

test('an approval that expired before execution blocks the task instead of running it', async () => {
  const response = await fetch('http://localhost:8895/api/tasks', { method: 'POST', headers: { authorization: 'Bearer approval-token', 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: 'approval-ws', request: 'deploy to production `docs/stale-approval.md`', idempotencyKey: 'expire-resume-1' }) });
  const taskId = (await response.json()).task.id;
  for (let i = 0; i < 6 && getTask(taskId).status === 'queued'; i += 1) await startWorker({ once: true });
  assert.equal(getTask(taskId).status, 'waiting_for_approval');

  // Simulate an approval that was granted, but whose execution window has since lapsed.
  decideApproval(taskId, 'approved', 'approved but stale by execution time');
  const approvalId = taskRecords(taskId).approvals[0].id;
  const { execSql, esc } = await import('../packages/task-engine/db.js');
  execSql(`UPDATE approvals SET expires_at=${esc(new Date(Date.now() - 1000).toISOString())} WHERE id=${esc(approvalId)};`);

  await fetch(`http://localhost:8895/api/tasks/${taskId}/resume`, { method: 'POST', headers: { authorization: 'Bearer approval-token' } });
  await startWorker({ once: true });
  assert.equal(getTask(taskId).status, 'failed');
  assert.match(getTask(taskId).error, /expired/i);
  assert.equal(taskRecords(taskId).providerAttempts.length, 0, 'an expired approval must never reach the provider');
});

test('close approval API', () => server.close());
