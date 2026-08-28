import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-accept-'));
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'accept.sqlite');
process.env.COMMAND_ADMIN_TOKEN = 'accept-token';
process.env.PORT = '8892';
process.env.HERMES_TEST_PROVIDER = 'mock';
process.env.TELEGRAM_ALLOWED_USERS = '1001';

const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { provisionRouteAuthorization } = await import('./helpers/provision-route-authorization.js');
provisionRouteAuthorization(['blackspire-command', 'accept-code']);
const { execSql, query, closeDb } = await import('../packages/task-engine/db.js');
const { createTask, getTask, transition, claimNext, heartbeat, createSubtasks, recordProviderAttempt, recordUsage, recordChangedFile, recordCommandResult, recordEvidence, taskRecords, setFlag } = await import('../packages/task-engine/tasks.js');
const { start } = await import('../apps/api/server.js');
const { startWorker } = await import('../apps/worker/worker.js');
const { upsertWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { handleTelegramUpdate } = await import('../apps/telegram/bot.js');
const { runAllowed } = await import('../packages/execution/runner.js');
const { decide } = await import('../packages/policy/policy.js');
const { applyEdits, artifactsWouldChangeWorkspace, commitAll, commitArtifacts, createPullRequest } = await import('../packages/github/github.js');
const { callOpenAI, callAnthropic, runCodexCliPacket, runClaudeCodePacket, executeProviderRequest } = await import('../packages/providers/providers.js');

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function repo() {
  const dir = path.join(root, `repo-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(dir, { recursive: true });
  git(['init', '-b', 'main'], dir);
  git(['config', 'user.email', 'accept@example.com'], dir);
  git(['config', 'user.name', 'Acceptance Test'], dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node --test' } }));
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'test/basic.test.js'), "import test from 'node:test'; import assert from 'node:assert/strict'; test('ok',()=>assert.equal(1,1));\n");
  git(['add', '.'], dir);
  git(['commit', '-m', 'initial'], dir);
  return dir;
}

let server;
let workspaceRoot;

test('clean migration enables SQLite WAL mode', () => {
  execSql('PRAGMA wal_checkpoint;');
  const mode = query('PRAGMA journal_mode;')[0].journal_mode;
  assert.equal(mode, 'wal');
});

test('task engine persists lifecycle, approvals-adjacent records, audit, subtasks, provider attempts, usage, changes, commands, and evidence', () => {
  const task = createTask({ workspaceId: 'accept', request: 'acceptance persistence', idempotencyKey: 'persist-one' });
  assert.equal(createTask({ workspaceId: 'accept', request: 'duplicate', idempotencyKey: 'persist-one' }).id, task.id);
  transition(task.id, 'running');
  createSubtasks(task.id, [{ title: 'one', stage: 'one' }]);
  recordProviderAttempt(task.id, { provider: 'mock', mode: 'mock', status: 'completed', requestPacket: {}, responsePacket: { artifacts: [] }, latencyMs: 1 });
  recordUsage(task.id, { provider: 'mock', mode: 'mock', latencyMs: 1, inputTokens: 1, outputTokens: 1, costCents: 0 });
  recordChangedFile(task.id, { path: 'docs/a.md', status: 'A' });
  recordCommandResult(task.id, { command: 'npm test', cwd: '.', ok: true, code: 0, stdout: 'ok', stderr: '', durationMs: 1 });
  recordEvidence(task.id, 'final', { ok: true });
  transition(task.id, 'completed');
  const records = taskRecords(task.id);
  assert.equal(getTask(task.id).status, 'completed');
  assert.ok(records.logs.length > 0);
  assert.equal(records.subtasks.length, 1);
  assert.equal(records.providerAttempts.length, 1);
  assert.equal(records.usage.length, 1);
  assert.equal(records.changedFiles.length, 1);
  assert.equal(records.commands.length, 1);
  assert.equal(records.evidence.length, 1);
});

test('backup and restore preserves SQLite data', () => {
  const backup = path.join(root, 'backup.sqlite');
  execSql('PRAGMA wal_checkpoint(TRUNCATE);');
  fs.copyFileSync(process.env.BLACKSPIRE_DB_PATH, backup);
  const before = query('SELECT COUNT(*) AS count FROM tasks;')[0].count;
  const extra = createTask({ workspaceId: 'accept', request: 'after backup', idempotencyKey: 'after-backup' });
  transition(extra.id, 'completed');
  execSql('PRAGMA wal_checkpoint(TRUNCATE);');
  closeDb();
  fs.copyFileSync(backup, process.env.BLACKSPIRE_DB_PATH);
  const after = query('SELECT COUNT(*) AS count FROM tasks;')[0].count;
  assert.equal(after, before);
});

test('API auth, invalid payloads, oversized payloads, health/readiness/task endpoints, controls, and security headers', async () => {
  server = start(8892, undefined, { exitOnListenError: false });
  let response = await fetch('http://localhost:8892/api/tasks');
  assert.equal(response.status, 401);
  response = await fetch('http://localhost:8892/health');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.status, 200);
  assert.equal((await fetch('http://localhost:8892/ready')).status, 200);
  response = await fetch('http://localhost:8892/api/tasks', { method: 'POST', headers: { authorization: 'Bearer accept-token', 'content-type': 'application/json' }, body: JSON.stringify({ request: '' }) });
  assert.equal(response.status, 422);
  response = await fetch('http://localhost:8892/api/tasks', { method: 'POST', headers: { authorization: 'Bearer accept-token', 'content-type': 'application/json' }, body: JSON.stringify({ request: 'x'.repeat(4001) }) });
  assert.equal(response.status, 422);
  response = await fetch('http://localhost:8892/api/tasks', { method: 'POST', headers: { authorization: 'Bearer accept-token', 'content-type': 'application/json' }, body: JSON.stringify({ request: 'queued only', idempotencyKey: 'api-queued' }) });
  const task = (await response.json()).task;
  assert.equal(task.status, 'queued');
  assert.equal((await (await fetch('http://localhost:8892/api/tasks', { headers: { authorization: 'Bearer accept-token' } })).json()).tasks.length > 0, true);
  assert.equal((await fetch(`http://localhost:8892/api/tasks/${task.id}`, { headers: { authorization: 'Bearer accept-token' } })).status, 200);
  assert.equal((await fetch(`http://localhost:8892/api/tasks/${task.id}/logs`, { headers: { authorization: 'Bearer accept-token' } })).status, 200);
  assert.equal((await (await fetch(`http://localhost:8892/api/tasks/${task.id}/pause`, { method: 'POST', headers: { authorization: 'Bearer accept-token' } })).json()).task.status, 'waiting_for_approval');
  assert.equal((await (await fetch(`http://localhost:8892/api/tasks/${task.id}/resume`, { method: 'POST', headers: { authorization: 'Bearer accept-token' } })).json()).task.status, 'queued');
  assert.equal((await (await fetch(`http://localhost:8892/api/tasks/${task.id}/cancel`, { method: 'POST', headers: { authorization: 'Bearer accept-token' } })).json()).task.status, 'cancelled');
  assert.equal((await fetch('http://localhost:8892/api/stop', { method: 'POST', headers: { authorization: 'Bearer accept-token', 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: 'blackspire-command' }) })).status, 200);
  assert.equal((await fetch('http://localhost:8892/api/tasks', { method: 'POST', headers: { authorization: 'Bearer accept-token', 'content-type': 'application/json' }, body: JSON.stringify({ request: 'blocked' }) })).status, 423);
  { const login = await fetch('http://localhost:8892/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': 'accept-reset' }, body: JSON.stringify({ adminToken: 'accept-token' }) }); const b = await login.json(); const c = login.headers.get('set-cookie').split(',').map((v) => v.split(';')[0]).join('; '); assert.equal((await fetch('http://localhost:8892/api/stop/reset', { method: 'POST', headers: { cookie: c, 'x-csrf-token': b.csrfToken, 'x-confirmation-token': `${b.csrfToken}:RESET`, 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: 'blackspire-command' }) })).status, 200); }
});

test('worker atomic claim, heartbeat, stale recovery, cancellation, and emergency stop behavior', async () => {
  setFlag('emergency_stop', 'inactive');
  const a = createTask({ workspaceId: 'accept', request: 'claim one', idempotencyKey: 'claim-one' });
  const first = claimNext({ workerId: 'worker-a' });
  const second = claimNext({ workerId: 'worker-b' });
  assert.equal(first.id, a.id);
  assert.notEqual(second?.id, a.id);
  heartbeat(a.id, 'testing-heartbeat');
  assert.equal(getTask(a.id).current_stage, 'testing-heartbeat');
  execSql(`UPDATE tasks SET status='running', heartbeat_at='2000-01-01T00:00:00.000Z' WHERE id='${a.id}';`);
  assert.equal(claimNext({ workerId: 'worker-c', staleAfterSeconds: 1 }).id, a.id);
  const cancelled = createTask({ workspaceId: 'accept', request: 'cancelled no claim', idempotencyKey: 'cancelled-no-claim' });
  transition(cancelled.id, 'cancelled');
  assert.notEqual(claimNext({ workerId: 'worker-d' })?.id, cancelled.id);
  setFlag('emergency_stop', 'active');
  await startWorker({ once: true });
  setFlag('emergency_stop', 'inactive');
});

test('Hermes completes credential-free local coding workflow and approval/rejection behavior', async () => {
  workspaceRoot = repo();
  upsertWorkspace({ id: 'accept-code', name: 'Accept Code', githubRepository: 'local/accept-code', defaultBranch: 'main', allowedPaths: ['docs'], buildCommands: ['npm test'], providerPolicy: { preferred: ['mock'] }, rootPath: workspaceRoot, enabledTools: ['write_branch', 'test', 'draft_pr'] });
  const response = await fetch('http://localhost:8892/api/tasks', { method: 'POST', headers: { authorization: 'Bearer accept-token', 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: 'accept-code', request: 'Create `docs/accept.md`', idempotencyKey: 'accept-code' }) });
  const taskId = (await response.json()).task.id;
  for (let i = 0; i < 8 && getTask(taskId).status === 'queued'; i += 1) await startWorker({ once: true });
  assert.equal(getTask(taskId).status, 'completed');
  assert.equal(git(['branch', '--show-current'], workspaceRoot), `hermes/${taskId}`);
  assert.ok(fs.existsSync(path.join(workspaceRoot, 'docs/accept.md')));
  const records = taskRecords(taskId);
  assert.ok(records.providerAttempts.length > 0);
  assert.ok(records.usage.length > 0);
  assert.ok(records.changedFiles.length > 0);
  assert.ok(records.commands.some((command) => command.ok === 1));
  assert.ok(records.evidence.some((evidence) => evidence.kind === 'final'));

  git(['switch', 'main'], workspaceRoot);
  const highRisk = createTask({ workspaceId: 'accept-code', request: 'deploy to production', idempotencyKey: 'high-risk-accept' });
  await startWorker({ once: true });
  assert.equal(getTask(highRisk.id).status, 'waiting_for_approval');
  assert.equal(taskRecords(highRisk.id).providerAttempts.length, 0);
  await fetch(`http://localhost:8892/api/tasks/${highRisk.id}/approve`, { method: 'POST', headers: { authorization: 'Bearer accept-token' } });
  assert.equal(getTask(highRisk.id).status, 'queued');
  const rejected = createTask({ workspaceId: 'accept-code', request: 'delete data', idempotencyKey: 'reject-accept' });
  await startWorker({ once: true });
  await fetch(`http://localhost:8892/api/tasks/${rejected.id}/reject`, { method: 'POST', headers: { authorization: 'Bearer accept-token' } });
  assert.equal(getTask(rejected.id).status, 'cancelled');
});

test('provider adapters are credential-free testable and normalized', async () => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  assert.equal((await callOpenAI({ prompt: 'x' })).mode, 'unconfigured');
  assert.equal((await callAnthropic({ prompt: 'x' })).mode, 'unconfigured');
  const originalFetch = globalThis.fetch;
  process.env.OPENAI_API_KEY = 'sk-test-redacted';
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ output_text: JSON.stringify({ artifacts: [{ path: 'docs/openai.md', content: 'ok' }], summary: 'ok' }), usage: { input_tokens: 2, output_tokens: 3 } }) });
  assert.equal((await callOpenAI({ prompt: 'x' })).artifacts[0].path, 'docs/openai.md');
  process.env.ANTHROPIC_API_KEY = 'anthropic-test-redacted';
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ content: [{ text: JSON.stringify({ artifacts: [{ path: 'docs/anthropic.md', content: 'ok' }], summary: 'ok' }) }], usage: { input_tokens: 2, output_tokens: 3 } }) });
  assert.equal((await callAnthropic({ prompt: 'x' })).artifacts[0].path, 'docs/anthropic.md');
  globalThis.fetch = originalFetch;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const codex = path.join(bin, 'codex');
  const claude = path.join(bin, 'claude');
  fs.writeFileSync(codex, `#!/bin/bash
if [[ "\${1:-}" == "--version" ]]; then echo codex; exit 0; fi
if [[ "\${1:-}" == "doctor" ]]; then echo '{"checks":{"auth.credentials":{"status":"ok","summary":"auth is configured"}}}'; exit 0; fi
if [[ "\${1:-}" == "exec" ]]; then
  final=""
  for ((i=1; i<=$#; i++)); do
    if [[ "\${!i}" == "--output-last-message" ]]; then j=$((i+1)); final="\${!j}"; fi
  done
  printf '{"artifacts":[{"path":"docs/codex.md","content":"ok"}],"summary":"ok"}\\n' > "$final"
  printf '{"type":"thread.started"}\\n{"type":"turn.started"}\\n{"type":"turn.completed"}\\n'
  exit 0
fi
exit 64
`);
  fs.writeFileSync(claude, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo claude; exit 0; fi\necho \'{"artifacts":[{"path":"docs/claude.md","content":"ok"}],"summary":"ok"}\'\n');
  fs.chmodSync(codex, 0o755);
  fs.chmodSync(claude, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = bin;
  assert.equal((await runCodexCliPacket(path.join(root, 'packet.json'))).artifacts[0].path, 'docs/codex.md');
  assert.equal(runClaudeCodePacket(path.join(root, 'packet.json')).artifacts[0].path, 'docs/claude.md');
  process.env.PATH = oldPath;
  const manualWorkspace = repo();
  const manualDataDir = path.join(root, 'manual-provider-data');
  const previousDataDir = process.env.BLACKSPIRE_DATA_DIR;
  process.env.BLACKSPIRE_DATA_DIR = manualDataDir;
  try {
    const manual = await executeProviderRequest({ selected: { provider: 'manual', mode: 'handoff' }, packet: { taskId: 'manual', request: 'packet', executionIntent: 'read_only' }, workspace: { root_path: manualWorkspace } });
    assert.equal(manual.mode, 'handoff');
    assert.ok(fs.existsSync(manual.manualPacketPath));
    assert.equal(path.dirname(path.dirname(manual.manualPacketPath)), manualDataDir);
    assert.equal(git(['status', '--porcelain', '-uall'], manualWorkspace), '');
    assert.equal(fs.existsSync(path.join(manualWorkspace, '.hermes-task-packets')), false);
    const linkedDataDir = path.join(root, 'linked-provider-data');
    fs.symlinkSync(manualWorkspace, linkedDataDir);
    process.env.BLACKSPIRE_DATA_DIR = linkedDataDir;
    const escaped = await executeProviderRequest({ selected: { provider: 'manual', mode: 'handoff' }, packet: { taskId: 'escaped-manual', request: 'packet', executionIntent: 'read_only' }, workspace: { root_path: manualWorkspace } });
    assert.equal(escaped.ok, false);
    assert.match(escaped.error, /outside the workspace/i);
    assert.equal(git(['status', '--porcelain', '-uall'], manualWorkspace), '');
    const externalDataDir = path.join(root, 'external-provider-data');
    const externalPackets = path.join(externalDataDir, 'hermes-task-packets');
    fs.mkdirSync(externalPackets, { recursive: true });
    const redirectedTarget = path.join(manualWorkspace, 'redirected-packet.json');
    fs.writeFileSync(redirectedTarget, 'unchanged');
    const statusBeforeRedirect = git(['status', '--porcelain', '-uall'], manualWorkspace);
    fs.symlinkSync(redirectedTarget, path.join(externalPackets, 'redirected.json'));
    process.env.BLACKSPIRE_DATA_DIR = externalDataDir;
    const redirected = await executeProviderRequest({ selected: { provider: 'manual', mode: 'handoff' }, packet: { taskId: 'redirected', request: 'packet', executionIntent: 'read_only' }, workspace: { root_path: manualWorkspace } });
    assert.equal(redirected.ok, false);
    assert.match(redirected.error, /outside the workspace/i);
    assert.equal(fs.readFileSync(redirectedTarget, 'utf8'), 'unchanged');
    assert.equal(git(['status', '--porcelain', '-uall'], manualWorkspace), statusBeforeRedirect);
    fs.rmSync(path.join(externalPackets, 'redirected.json'));
    const displacedPackets = `${externalPackets}-displaced`;
    const originalOpenSync = fs.openSync;
    let swappedPacketDirectory = false;
    fs.openSync = function swapBeforeDirectoryOpen(target, ...args) {
      if (!swappedPacketDirectory && target === externalPackets) {
        swappedPacketDirectory = true;
        fs.renameSync(externalPackets, displacedPackets);
        fs.symlinkSync(manualWorkspace, externalPackets);
      }
      return originalOpenSync.call(this, target, ...args);
    };
    try {
      const swapped = await executeProviderRequest({ selected: { provider: 'manual', mode: 'handoff' }, packet: { taskId: 'swapped-parent', request: 'packet', executionIntent: 'read_only' }, workspace: { root_path: manualWorkspace } });
      assert.equal(swapped.ok, false);
      assert.equal(fs.existsSync(path.join(manualWorkspace, 'swapped-parent.json')), false);
    } finally {
      fs.openSync = originalOpenSync;
      fs.rmSync(externalPackets);
      fs.renameSync(displacedPackets, externalPackets);
    }
    fs.linkSync(redirectedTarget, path.join(externalPackets, 'hard-linked.json'));
    const hardLinked = await executeProviderRequest({ selected: { provider: 'manual', mode: 'handoff' }, packet: { taskId: 'hard-linked', request: 'packet', executionIntent: 'read_only' }, workspace: { root_path: manualWorkspace } });
    assert.equal(hardLinked.ok, false);
    assert.equal(fs.readFileSync(redirectedTarget, 'utf8'), 'unchanged');
    assert.equal(git(['status', '--porcelain', '-uall'], manualWorkspace), statusBeforeRedirect);
  } finally {
    if (previousDataDir === undefined) delete process.env.BLACKSPIRE_DATA_DIR;
    else process.env.BLACKSPIRE_DATA_DIR = previousDataDir;
  }
});

test('Git workflow and workspace isolation/security controls', async () => {
  const dir = repo();
  assert.equal(decide('repository', { repository: 'evil/repo', allowlist: ['local/ok'] }).allowed, false);
  assert.throws(() => applyEdits([{ path: '../escape.md', content: 'x' }], { cwd: dir, allowedPaths: ['docs'] }));
  assert.throws(() => applyEdits([{ path: 'src/nope.md', content: 'x' }], { cwd: dir, allowedPaths: ['docs'] }));
  const originalOpenDirectory = fs.opendirSync;
  let boundedReads = 0;
  let boundedHandleClosed = false;
  fs.opendirSync = () => ({
    readSync: () => (++boundedReads <= 100_001 ? { name: `entry-${boundedReads}`, isDirectory: () => false } : null),
    closeSync: () => { boundedHandleClosed = true; },
  });
  try {
    assert.throws(() => artifactsWouldChangeWorkspace([{ path: 'docs/bounded.md', content: 'x' }], { cwd: dir, allowedPaths: ['docs'] }), /too large to inspect projected Git control data safely/i);
    assert.equal(boundedReads, 100_001);
    assert.equal(boundedHandleClosed, true);
  } finally {
    fs.opendirSync = originalOpenDirectory;
  }
  assert.equal((await runAllowed('rm -rf /', { cwd: dir, allowedCommands: ['npm test'] })).ok, false);
  assert.equal(commitAll('blocked on main', { cwd: dir }).ok, false);
  git(['switch', '-c', 'hermes/test'], dir);
  applyEdits([{ path: 'docs/git.md', content: 'ok' }], { cwd: dir, allowedPaths: ['docs'] });
  assert.equal((await runAllowed('npm test', { cwd: dir, allowedCommands: ['npm test'] })).ok, true);
  assert.equal(commitAll('safe commit', { cwd: dir }).ok, true);
  const hook = path.join(dir, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hook, '#!/bin/sh\nprintf "hook content\\n" > docs/hook-injected.md\ngit add docs/hook-injected.md\n');
  fs.chmodSync(hook, 0o755);
  assert.throws(() => applyEdits([{ path: '.git/hooks/pre-commit', content: 'replaced' }], { cwd: dir, allowedPaths: ['.'] }), /Git control|not allowed/i);
  assert.throws(() => applyEdits([{ path: 'docs/nested/.git', content: 'replaced' }], { cwd: dir, allowedPaths: ['.'] }), /Git control|not allowed/i);
  fs.mkdirSync(path.join(dir, 'nested', '.git'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'nested', '.git', 'config'), 'nested control\n');
  fs.symlinkSync('../nested/.git/config', path.join(dir, 'docs', 'nested-control'));
  assert.throws(() => applyEdits([{ path: 'docs/nested-control', content: 'replaced' }], { cwd: dir, allowedPaths: ['.'] }), /nested Git control/i);
  assert.equal(fs.readFileSync(path.join(dir, 'nested', '.git', 'config'), 'utf8'), 'nested control\n');
  fs.rmSync(path.join(dir, 'docs', 'nested-control'));
  fs.rmSync(path.join(dir, 'nested'), { recursive: true });
  const separateControl = path.join(dir, 'nested-control');
  const separateWork = path.join(dir, 'nested-work');
  fs.appendFileSync(path.join(dir, '.git', 'info', 'exclude'), '/nested-control/\n/nested-work/\n');
  git(['init', '--separate-git-dir', separateControl, separateWork], dir);
  const originalControl = fs.readFileSync(path.join(separateControl, 'config'));
  assert.throws(() => applyEdits([{ path: 'nested-control/config', content: 'replaced' }], { cwd: dir, allowedPaths: ['.'] }), /Git control/i);
  fs.symlinkSync('../nested-control/config', path.join(dir, 'docs', 'separate-control-link'));
  git(['add', 'docs/separate-control-link'], dir);
  git(['-c', 'core.hooksPath=/dev/null', 'commit', '--no-verify', '-m', 'track separate control link fixture'], dir);
  const branchBeforeRefusal = git(['branch', '--show-current'], dir);
  const headBeforeRefusal = git(['rev-parse', 'HEAD'], dir);
  assert.throws(() => applyEdits([{ path: 'docs/separate-control-link', content: 'replaced' }], { cwd: dir, allowedPaths: ['.'] }), /Git control/i);
  assert.throws(() => applyEdits([{ path: 'nested-control/new-control-file', content: 'new' }], { cwd: dir, allowedPaths: ['.'] }), /Git control/i);
  assert.throws(() => applyEdits([{ path: 'nested-work/content.md', content: 'nested repository content' }], { cwd: dir, allowedPaths: ['.'] }), /repository boundary/i);
  assert.equal(git(['branch', '--show-current'], dir), branchBeforeRefusal);
  assert.equal(git(['rev-parse', 'HEAD'], dir), headBeforeRefusal);
  assert.deepEqual(fs.readFileSync(path.join(separateControl, 'config')), originalControl);
  assert.equal(fs.existsSync(path.join(separateControl, 'new-control-file')), false);
  assert.equal(fs.existsSync(path.join(separateWork, 'content.md')), false);
  assert.equal(git(['status', '--porcelain'], dir), '');
  fs.rmSync(separateControl, { recursive: true });
  fs.rmSync(separateWork, { recursive: true });
  const prospectiveControl = [
    { path: 'control/objects/placeholder', content: '' },
    { path: 'control/refs/placeholder', content: '' },
    { path: 'control/config', content: '[core]\nrepositoryformatversion = 0\nbare = false\n' },
    { path: 'control/HEAD', content: 'ref: refs/heads/main\n' },
  ];
  assert.throws(() => artifactsWouldChangeWorkspace(prospectiveControl, { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
  assert.throws(() => applyEdits(prospectiveControl, { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
  assert.equal(fs.existsSync(path.join(dir, 'control')), false);
  assert.equal(git(['status', '--porcelain'], dir), '');
  for (const config of ['', '[user]\nname = Blackspire\n']) {
    const validConfigControl = prospectiveControl.map((edit) => edit.path === 'control/config' ? { ...edit, content: config } : edit);
    assert.throws(() => artifactsWouldChangeWorkspace(validConfigControl, { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
    assert.throws(() => applyEdits(validConfigControl, { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
    assert.equal(fs.existsSync(path.join(dir, 'control')), false);
  }
  const configlessControl = prospectiveControl.filter((edit) => edit.path !== 'control/config');
  assert.throws(() => artifactsWouldChangeWorkspace(configlessControl, { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
  assert.throws(() => applyEdits(configlessControl, { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
  assert.equal(fs.existsSync(path.join(dir, 'control')), false);
  const uppercaseDetachedControl = configlessControl.map((edit) => edit.path === 'control/HEAD'
    ? { ...edit, content: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01\n' }
    : edit);
  assert.throws(() => artifactsWouldChangeWorkspace(uppercaseDetachedControl, { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
  assert.throws(() => applyEdits(uppercaseDetachedControl, { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
  assert.equal(fs.existsSync(path.join(dir, 'control')), false);
  assert.equal(git(['status', '--porcelain'], dir), '');
  fs.appendFileSync(path.join(dir, '.git', 'info', 'exclude'), '/control/\n');
  fs.mkdirSync(path.join(dir, 'control', 'refs', 'heads'), { recursive: true });
  fs.symlinkSync('refs/heads/main', path.join(dir, 'control', 'HEAD'));
  const symlinkedHeadControl = [{ path: 'control/objects/placeholder', content: '' }];
  assert.throws(() => artifactsWouldChangeWorkspace(symlinkedHeadControl, { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
  assert.throws(() => applyEdits(symlinkedHeadControl, { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
  assert.equal(fs.existsSync(path.join(dir, 'control', 'objects')), false);
  assert.equal(git(['status', '--porcelain'], dir), '');
  fs.rmSync(path.join(dir, 'control'), { recursive: true });
  for (const head of ['refs//heads/main', 'refs/heads/.main', `${'a'.repeat(65)}`]) {
    fs.mkdirSync(path.join(dir, 'control', 'refs', 'heads'), { recursive: true });
    if (head.startsWith('refs')) fs.symlinkSync(head, path.join(dir, 'control', 'HEAD'));
    else fs.writeFileSync(path.join(dir, 'control', 'HEAD'), `${head}\n`);
    const extendedHeadControl = [{ path: 'control/objects/placeholder', content: '' }];
    assert.throws(() => artifactsWouldChangeWorkspace(extendedHeadControl, { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
    assert.throws(() => applyEdits(extendedHeadControl, { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
    assert.equal(fs.existsSync(path.join(dir, 'control', 'objects')), false);
    fs.rmSync(path.join(dir, 'control'), { recursive: true });
  }
  fs.mkdirSync(path.join(dir, 'control', 'refs', 'heads'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'control', 'HEAD'), 'ref: refs/heads/.main\n');
  const regularDotHeadControl = [{ path: 'control/objects/placeholder', content: '' }];
  assert.throws(() => artifactsWouldChangeWorkspace(regularDotHeadControl, { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
  assert.throws(() => applyEdits(regularDotHeadControl, { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
  assert.equal(fs.existsSync(path.join(dir, 'control', 'objects')), false);
  fs.rmSync(path.join(dir, 'control'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'control', 'refs', 'heads'), { recursive: true });
  fs.symlinkSync('./refs/heads/main', path.join(dir, 'control', 'HEAD'));
  const gitLeadingDotHead = [{ path: 'control/objects/placeholder', content: '' }];
  assert.throws(() => artifactsWouldChangeWorkspace(gitLeadingDotHead, { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
  assert.throws(() => applyEdits(gitLeadingDotHead, { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
  fs.mkdirSync(path.join(dir, 'control', 'objects'), { recursive: true });
  assert.equal(spawnSync('git', ['-C', path.join(dir, 'control'), 'rev-parse', '--is-inside-git-dir'], { encoding: 'utf8' }).status, 0);
  fs.rmSync(path.join(dir, 'control'), { recursive: true });
  const malformedProspectiveControl = prospectiveControl.map((edit) => edit.path === 'control/config'
    ? { ...edit, content: '[core\nmalformed = true\n' }
    : edit);
  assert.throws(() => artifactsWouldChangeWorkspace(malformedProspectiveControl, { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
  assert.throws(() => applyEdits(malformedProspectiveControl, { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
  assert.equal(fs.existsSync(path.join(dir, 'control')), false);
  assert.equal(git(['status', '--porcelain'], dir), '');
  const projectionTargets = path.join(dir, 'projection-targets');
  fs.mkdirSync(path.join(projectionTargets, 'objects'), { recursive: true });
  fs.mkdirSync(path.join(projectionTargets, 'refs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'control'));
  fs.symlinkSync(path.join(projectionTargets, 'objects'), path.join(dir, 'control', 'objects'));
  fs.symlinkSync(path.join(projectionTargets, 'refs'), path.join(dir, 'control', 'refs'));
  assert.throws(() => artifactsWouldChangeWorkspace(malformedProspectiveControl.filter((edit) => !edit.path.includes('/placeholder')), { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
  assert.throws(() => applyEdits(malformedProspectiveControl.filter((edit) => !edit.path.includes('/placeholder')), { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
  assert.equal(fs.existsSync(path.join(dir, 'control', 'HEAD')), false);
  assert.equal(fs.existsSync(path.join(dir, 'control', 'config')), false);
  fs.rmSync(path.join(dir, 'control'), { recursive: true });
  fs.rmSync(projectionTargets, { recursive: true });
  fs.mkdirSync(path.join(dir, 'control'));
  fs.symlinkSync('../prospective-targets/objects', path.join(dir, 'control', 'objects'));
  fs.symlinkSync('../prospective-targets/refs', path.join(dir, 'control', 'refs'));
  const danglingReferentControl = [
    { path: 'prospective-targets/objects/placeholder', content: '' },
    { path: 'prospective-targets/refs/placeholder', content: '' },
    { path: 'control/config', content: '[core\nmalformed = true\n' },
    { path: 'control/HEAD', content: 'ref: refs/heads/main\n' },
  ];
  assert.throws(() => artifactsWouldChangeWorkspace(danglingReferentControl, { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
  assert.throws(() => applyEdits(danglingReferentControl, { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
  assert.equal(fs.existsSync(path.join(dir, 'prospective-targets')), false);
  assert.equal(fs.existsSync(path.join(dir, 'control', 'HEAD')), false);
  fs.rmSync(path.join(dir, 'control'), { recursive: true });
  // This batch does not touch control/ or its ancestors. It completes the
  // existing dangling objects/refs links only by creating referents elsewhere.
  fs.mkdirSync(path.join(dir, 'control'));
  fs.writeFileSync(path.join(dir, 'control', 'HEAD'), 'ref: refs/heads/main\n');
  fs.symlinkSync('../reverse-targets/objects', path.join(dir, 'control', 'objects'));
  fs.symlinkSync('../reverse-targets/refs', path.join(dir, 'control', 'refs'));
  const reverseSymlinkControl = [
    { path: 'reverse-targets/objects/placeholder', content: '' },
    { path: 'reverse-targets/refs/placeholder', content: '' },
  ];
  assert.throws(() => artifactsWouldChangeWorkspace(reverseSymlinkControl, { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
  assert.throws(() => applyEdits(reverseSymlinkControl, { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
  assert.equal(fs.existsSync(path.join(dir, 'reverse-targets')), false);
  fs.rmSync(path.join(dir, 'control'), { recursive: true });
  // The final graph must follow every same-batch dangling-link hop, not just
  // the first link.  Neither target directory exists before this batch.
  fs.mkdirSync(path.join(dir, 'control'));
  fs.mkdirSync(path.join(dir, 'links'));
  fs.symlinkSync('../links/objects', path.join(dir, 'control', 'objects'));
  fs.symlinkSync('../links/refs', path.join(dir, 'control', 'refs'));
  fs.symlinkSync('../targets/objects', path.join(dir, 'links', 'objects'));
  fs.symlinkSync('../targets/refs', path.join(dir, 'links', 'refs'));
  const twoHopDanglingControl = [
    { path: 'targets/objects/placeholder', content: '' },
    { path: 'targets/refs/placeholder', content: '' },
    { path: 'control/config', content: '[core\nmalformed = true\n' },
    { path: 'control/HEAD', content: 'ref: refs/heads/café\n' },
  ];
  assert.throws(() => artifactsWouldChangeWorkspace(twoHopDanglingControl, { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
  assert.throws(() => applyEdits(twoHopDanglingControl, { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
  assert.equal(fs.existsSync(path.join(dir, 'targets')), false);
  fs.rmSync(path.join(dir, 'control'), { recursive: true });
  fs.rmSync(path.join(dir, 'links'), { recursive: true });
  assert.equal(git(['status', '--porcelain'], dir), '');
  // An exact proposed referent is a regular file, not an inferred directory.
  fs.mkdirSync(path.join(dir, 'control'));
  fs.symlinkSync('../targets/objects', path.join(dir, 'control', 'objects'));
  fs.symlinkSync('../targets/refs', path.join(dir, 'control', 'refs'));
  const regularReferents = [
    { path: 'targets/objects', content: 'not a directory' },
    { path: 'targets/refs', content: 'not a directory' },
    { path: 'control/config', content: '[core]\nrepositoryformatversion = 0\n' },
    { path: 'control/HEAD', content: 'ref: refs/heads/main\n' },
  ];
  assert.equal(artifactsWouldChangeWorkspace(regularReferents, { cwd: dir, allowedPaths: ['.'] }), true);
  applyEdits(regularReferents, { cwd: dir, allowedPaths: ['.'] });
  assert.equal(fs.readFileSync(path.join(dir, 'targets', 'objects'), 'utf8'), 'not a directory');
  fs.rmSync(path.join(dir, 'control'), { recursive: true });
  fs.rmSync(path.join(dir, 'targets'), { recursive: true });
  assert.equal(git(['status', '--porcelain'], dir), '');
  const unicodeControl = malformedProspectiveControl.map((edit) => edit.path === 'control/HEAD'
    ? { ...edit, content: 'ref: refs/heads/café\n' }
    : edit);
  assert.throws(() => artifactsWouldChangeWorkspace(unicodeControl, { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
  assert.throws(() => applyEdits(unicodeControl, { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
  assert.equal(fs.existsSync(path.join(dir, 'control')), false);
  const ordinaryProjection = [
    { path: 'render/HEAD', content: 'current renderer output\n' },
    { path: 'render/config', content: 'renderer configuration\n' },
    { path: 'render/objects/item.json', content: '{}\n' },
    { path: 'render/refs/index.json', content: '[]\n' },
  ];
  assert.equal(artifactsWouldChangeWorkspace(ordinaryProjection, { cwd: dir, allowedPaths: ['.'] }), true);
  applyEdits(ordinaryProjection, { cwd: dir, allowedPaths: ['.'] });
  assert.equal(fs.readFileSync(path.join(dir, 'render', 'HEAD'), 'utf8'), 'current renderer output\n');
  fs.rmSync(path.join(dir, 'render'), { recursive: true });
  assert.equal(git(['status', '--porcelain'], dir), '');
  fs.mkdirSync(path.join(dir, 'control', 'objects'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'control', 'refs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'control', 'config'), '[core]\nrepositoryformatversion = 0\nbare = false\n');
  assert.throws(() => applyEdits([{ path: 'control/HEAD', content: 'ref: refs/heads/main\n' }], { cwd: dir, allowedPaths: ['.'] }), /creates Git control/i);
  assert.equal(fs.existsSync(path.join(dir, 'control', 'HEAD')), false);
  fs.rmSync(path.join(dir, 'control'), { recursive: true });
  assert.equal(git(['status', '--porcelain'], dir), '');
  fs.mkdirSync(path.join(dir, 'docs', 'legitimate'));
  fs.writeFileSync(path.join(dir, 'docs', 'legitimate', 'existing.md'), 'before\n');
  fs.symlinkSync('legitimate/existing.md', path.join(dir, 'docs', 'legitimate-link'));
  applyEdits([{ path: 'docs/legitimate/ordinary.md', content: 'ordinary\n' }, { path: 'docs/legitimate-link', content: 'after\n' }], { cwd: dir, allowedPaths: ['docs'] });
  assert.equal(fs.readFileSync(path.join(dir, 'docs', 'legitimate', 'ordinary.md'), 'utf8'), 'ordinary\n');
  assert.equal(fs.readFileSync(path.join(dir, 'docs', 'legitimate', 'existing.md'), 'utf8'), 'after\n');
  fs.rmSync(path.join(dir, 'docs', 'legitimate-link'));
  fs.rmSync(path.join(dir, 'docs', 'legitimate'), { recursive: true });
  const approved = [{ path: 'docs/hook-proof.md', content: 'approved only\n' }];
  applyEdits(approved, { cwd: dir, allowedPaths: ['docs'] });
  assert.equal(commitArtifacts('hook-isolated commit', approved, { cwd: dir, allowedPaths: ['docs'] }).ok, true);
  assert.equal(fs.existsSync(path.join(dir, 'docs', 'hook-injected.md')), false);
  assert.doesNotMatch(git(['show', '--name-only', '--format=', 'HEAD'], dir), /hook-injected/);
  const modeBound = [{ path: 'docs/hook-proof.md', content: 'mode must remain data-only\n' }];
  applyEdits(modeBound, { cwd: dir, allowedPaths: ['docs'] });
  fs.chmodSync(path.join(dir, 'docs', 'hook-proof.md'), 0o755);
  assert.throws(() => commitArtifacts('mode mutation refused', modeBound, { cwd: dir, allowedPaths: ['docs'] }), /unexpected artifact mode/i);
  git(['restore', '--staged', '--worktree', 'docs/hook-proof.md'], dir);
  assert.equal(createPullRequest({ title: 'No credentials', body: 'packet', cwd: dir }).mode, 'task-packet');
});

test('Telegram local bridge covers allowlist, duplicates, commands, chunking, escaping, and emergency stop', async () => {
  const unauthorized = await handleTelegramUpdate({ update_id: 10, message: { from: { id: 999 }, chat: { id: 1 }, text: '/status' } }, 'http://localhost:8892');
  assert.equal(unauthorized.ignored, true);
  const start = await handleTelegramUpdate({ update_id: 11, message: { from: { id: 1001 }, chat: { id: 1 }, text: '/start' } }, 'http://localhost:8892');
  assert.ok(start.text[0].includes('Blackspire'));
  assert.equal((await handleTelegramUpdate({ update_id: 11, message: { from: { id: 1001 }, chat: { id: 1 }, text: '/start' } }, 'http://localhost:8892')).ignored, true);
  assert.ok((await handleTelegramUpdate({ update_id: 12, message: { from: { id: 1001 }, chat: { id: 1 }, text: '/workspaces' } }, 'http://localhost:8892')).text[0]);
  assert.ok((await handleTelegramUpdate({ update_id: 13, message: { from: { id: 1001 }, chat: { id: 1 }, text: '/health' } }, 'http://localhost:8892')).text[0]);
  const taskReply = await handleTelegramUpdate({ update_id: 14, message: { from: { id: 1001 }, chat: { id: 1 }, text: '/task read local telegram task' } }, 'http://localhost:8892');
  const taskId = taskReply.text[0].match(/task\w+/)?.[0];
  assert.ok(taskReply.text[0].includes('Queued'));
  assert.ok((await handleTelegramUpdate({ update_id: 15, message: { from: { id: 1001 }, chat: { id: 1 }, text: `/task_status ${taskId}` } }, 'http://localhost:8892')).text[0]);
  assert.ok((await handleTelegramUpdate({ update_id: 16, message: { from: { id: 1001 }, chat: { id: 1 }, text: `/logs ${taskId}` } }, 'http://localhost:8892')).text[0]);
  assert.ok((await handleTelegramUpdate({ update_id: 17, message: { from: { id: 1001 }, chat: { id: 1 }, text: `/pause ${taskId}` } }, 'http://localhost:8892')).text[0]);
  assert.ok((await handleTelegramUpdate({ update_id: 18, message: { from: { id: 1001 }, chat: { id: 1 }, text: `/resume ${taskId}` } }, 'http://localhost:8892')).text[0]);
  assert.ok((await handleTelegramUpdate({ update_id: 19, message: { from: { id: 1001 }, chat: { id: 1 }, text: `/approve ${taskId}` } }, 'http://localhost:8892')).text[0]);
  assert.ok((await handleTelegramUpdate({ update_id: 20, message: { from: { id: 1001 }, chat: { id: 1 }, text: `/reject ${taskId}` } }, 'http://localhost:8892')).text[0]);
  assert.ok((await handleTelegramUpdate({ update_id: 21, message: { from: { id: 1001 }, chat: { id: 1 }, text: `/cancel ${taskId}` } }, 'http://localhost:8892')).text[0]);
  assert.ok((await handleTelegramUpdate({ update_id: 22, message: { from: { id: 1001 }, chat: { id: 1 }, text: '/stop' } }, 'http://localhost:8892')).text[0]);
});

test('Jarvis PWA assets are valid and mobile workflows are not desktop-only', async () => {
  { const login = await fetch('http://localhost:8892/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': 'jarvis-reset' }, body: JSON.stringify({ adminToken: 'accept-token' }) }); const b = await login.json(); const c = login.headers.get('set-cookie').split(',').map((v) => v.split(';')[0]).join('; '); await fetch('http://localhost:8892/api/stop/reset', { method: 'POST', headers: { cookie: c, 'x-csrf-token': b.csrfToken, 'x-confirmation-token': `${b.csrfToken}:RESET`, 'content-type': 'application/json' }, body: JSON.stringify({ workspaceId: 'blackspire-command' }) }); }
  const html = await (await fetch('http://localhost:8892/jarvis')).text();
  // Script and style are externalized for CSP; read them from disk since serving
  // them is the control plane's concern, not this acceptance check's.
  const appScript = fs.readFileSync('apps/jarvis-pwa/public/jarvis.js', 'utf8');
  assert.match(html, /viewport/);
  assert.doesNotMatch(html + appScript, /localStorage.commandToken/);
  assert.match(appScript, /api\/auth\/login/);
  assert.match(appScript, /submitCommand/);
  assert.match(html, /Recent conversations/);
  assert.match(html, /Approval center/);
  assert.match(html, /aria-label="Workspace"/);
  assert.match(html, /Emergency stop/);
  // Voice stays an inert, staged boundary: no browser speech service is authorized.
  assert.doesNotMatch(html + appScript, /SpeechRecognition|speechSynthesis/);
  assert.match(html, /Voice input is staged but not connected/);
  assert.match(await (await fetch('http://localhost:8892/sw.js')).text(), /caches/);
  const manifest = await (await fetch('http://localhost:8892/manifest.webmanifest')).json();
  assert.equal(manifest.display, 'standalone');
  const response = await fetch('http://localhost:8892/api/tasks', { method: 'POST', headers: { authorization: 'Bearer accept-token', 'content-type': 'application/json' }, body: JSON.stringify({ request: 'jarvis endpoint task', idempotencyKey: 'jarvis-endpoint' }) });
  assert.equal(response.status, 202);
});

test('close acceptance API', () => server.close());
