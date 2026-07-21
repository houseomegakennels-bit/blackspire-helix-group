import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-evidence-'));
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'evidence.sqlite');
process.env.HERMES_TEST_PROVIDER = 'mock';
process.env.COMMAND_ADMIN_TOKEN = 'evidence-token';
process.env.PORT = '8897';

const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { start } = await import('../apps/api/server.js');
const { startWorker } = await import('../apps/worker/worker.js');
const { upsertWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { getTask } = await import('../packages/task-engine/tasks.js');

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function repo() {
  const dir = path.join(root, 'repo');
  fs.mkdirSync(dir, { recursive: true });
  git(['init', '-b', 'main'], dir);
  git(['config', 'user.email', 'evidence@example.com'], dir);
  git(['config', 'user.name', 'Evidence Test'], dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }));
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'test/basic.test.js'), "import test from 'node:test'; import assert from 'node:assert/strict'; test('ok',()=>assert.equal(1,1));\n");
  git(['add', '.'], dir);
  git(['commit', '-m', 'initial'], dir);
  return dir;
}

let server;
let taskId;

test('setup evidence workspace, run task to completion', async () => {
  const dir = repo();
  upsertWorkspace({ id: 'evidence-ws', name: 'Evidence Workspace', githubRepository: 'local/evidence-ws', defaultBranch: 'main', allowedPaths: ['docs'], buildCommands: ['npm test'], providerPolicy: { preferred: ['mock'] }, rootPath: dir, enabledTools: ['write_branch', 'test', 'draft_pr'] });
  server = start(8897);
  const response = await fetch('http://localhost:8897/api/tasks', { method: 'POST', headers: { authorization: 'Bearer evidence-token', 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: 'evidence-ws', request: 'Create `docs/evidence.md` sk-redact-test123', idempotencyKey: 'evidence-flow' }) });
  taskId = (await response.json()).task.id;
  for (let i = 0; i < 8 && getTask(taskId).status === 'queued'; i += 1) await startWorker({ once: true });
  assert.equal(getTask(taskId).status, 'completed');
});

test('JSON export contains every required evidence section with stable, redacted, well-formed content', async () => {
  const response = await fetch(`http://localhost:8897/api/tasks/${taskId}/export.json`, { headers: { authorization: 'Bearer evidence-token' } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /^attachment; filename="task_[\w-]+-evidence\.json"$/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const bundle = await response.json();

  assert.equal(bundle.taskId, taskId);
  assert.match(bundle.taskRequest, /Create `docs\/evidence\.md`/);
  assert.equal(bundle.taskRequest.includes('sk-redact-test123'), false, 'secrets in the task request must be redacted');
  assert.equal(bundle.workspace.id, 'evidence-ws');
  assert.ok(bundle.plan.stages.length > 0);
  assert.ok(bundle.subtasks.length > 0);
  assert.ok(bundle.providerAttempts.length > 0);
  assert.ok(bundle.usage.length > 0);
  assert.ok(Array.isArray(bundle.approvalHistory));
  assert.ok(bundle.changedFiles.some((f) => f.path.startsWith('docs/')));
  assert.ok(bundle.commandResults.some((c) => c.ok === 1));
  assert.ok(bundle.logs.length > 0);
  assert.ok(Array.isArray(bundle.attachments));
  assert.equal(bundle.branch, `hermes/${taskId}`);
  assert.ok(bundle.commit.ok, 'commit metadata must be present');
  assert.ok(bundle.pullRequestOrManualHandoff, 'PR-or-manual-handoff metadata must be present');
  assert.ok(bundle.finalEvidence.some((e) => e.kind === 'final'));

  // Re-fetching must produce the same key order (stable ordering), independent of object hash iteration.
  const again = await (await fetch(`http://localhost:8897/api/tasks/${taskId}/export.json`, { headers: { authorization: 'Bearer evidence-token' } })).text();
  const first = await (await fetch(`http://localhost:8897/api/tasks/${taskId}/export.json`, { headers: { authorization: 'Bearer evidence-token' } })).text();
  assert.deepEqual(Object.keys(JSON.parse(again)), Object.keys(JSON.parse(first)));
});

test('Markdown export mirrors the same evidence and is safely named', async () => {
  const response = await fetch(`http://localhost:8897/api/tasks/${taskId}/export.md`, { headers: { authorization: 'Bearer evidence-token' } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /\.md"$/);
  const text = await response.text();
  assert.match(text, /Task Evidence/);
  assert.equal(text.includes('sk-redact-test123'), false);
});

test('oversized evidence bundles are rejected with 413 instead of silently truncated', async () => {
  process.env.EVIDENCE_BUNDLE_MAX_BYTES = '10';
  const response = await fetch(`http://localhost:8897/api/tasks/${taskId}/export.json`, { headers: { authorization: 'Bearer evidence-token' } });
  assert.equal(response.status, 413);
  delete process.env.EVIDENCE_BUNDLE_MAX_BYTES;
});

test('close evidence API', () => server.close());
