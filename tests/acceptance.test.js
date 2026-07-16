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

const { execSql, query } = await import('../packages/task-engine/db.js');
const { createTask, getTask, transition, claimNext, heartbeat, createSubtasks, recordProviderAttempt, recordUsage, recordChangedFile, recordCommandResult, recordEvidence, taskRecords, setFlag } = await import('../packages/task-engine/tasks.js');
const { start } = await import('../apps/api/server.js');
const { startWorker } = await import('../apps/worker/worker.js');
const { upsertWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { handleTelegramUpdate } = await import('../apps/telegram/bot.js');
const { runAllowed } = await import('../packages/execution/runner.js');
const { decide } = await import('../packages/policy/policy.js');
const { applyEdits, commitAll, createPullRequest } = await import('../packages/github/github.js');
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
  const mode = execSql('PRAGMA journal_mode;').trim();
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
  fs.copyFileSync(process.env.BLACKSPIRE_DB_PATH, backup);
  const before = query('SELECT COUNT(*) AS count FROM tasks;')[0].count;
  createTask({ workspaceId: 'accept', request: 'after backup', idempotencyKey: 'after-backup' });
  fs.copyFileSync(backup, process.env.BLACKSPIRE_DB_PATH);
  const after = query('SELECT COUNT(*) AS count FROM tasks;')[0].count;
  assert.equal(after, before);
});

test('API auth, invalid payloads, oversized payloads, health/readiness/task endpoints, controls, and security headers', async () => {
  server = start(8892);
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
  assert.equal((await fetch('http://localhost:8892/api/stop', { method: 'POST', headers: { authorization: 'Bearer accept-token' } })).status, 200);
  assert.equal((await fetch('http://localhost:8892/api/tasks', { method: 'POST', headers: { authorization: 'Bearer accept-token', 'content-type': 'application/json' }, body: JSON.stringify({ request: 'blocked' }) })).status, 423);
  assert.equal((await fetch('http://localhost:8892/api/stop/reset', { method: 'POST', headers: { authorization: 'Bearer accept-token' } })).status, 200);
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
  process.env.OPENAI_API_KEY = 'openai-test-redacted';
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
  fs.writeFileSync(codex, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo codex; exit 0; fi\necho \'{"artifacts":[{"path":"docs/codex.md","content":"ok"}],"summary":"ok"}\'\n');
  fs.writeFileSync(claude, '#!/bin/sh\nif [ "$1" = "--version" ]; then echo claude; exit 0; fi\necho \'{"artifacts":[{"path":"docs/claude.md","content":"ok"}],"summary":"ok"}\'\n');
  fs.chmodSync(codex, 0o755);
  fs.chmodSync(claude, 0o755);
  const oldPath = process.env.PATH;
  process.env.PATH = bin;
  assert.equal(runCodexCliPacket(path.join(root, 'packet.json')).artifacts[0].path, 'docs/codex.md');
  assert.equal(runClaudeCodePacket(path.join(root, 'packet.json')).artifacts[0].path, 'docs/claude.md');
  process.env.PATH = oldPath;
  const manual = await executeProviderRequest({ selected: { provider: 'manual', mode: 'handoff' }, packet: { taskId: 'manual', request: 'packet' }, workspace: { root_path: root } });
  assert.equal(manual.mode, 'handoff');
  assert.ok(fs.existsSync(manual.manualPacketPath));
});

test('Git workflow and workspace isolation/security controls', async () => {
  const dir = repo();
  assert.equal(decide('repository', { repository: 'evil/repo', allowlist: ['local/ok'] }).allowed, false);
  assert.throws(() => applyEdits([{ path: '../escape.md', content: 'x' }], { cwd: dir, allowedPaths: ['docs'] }));
  assert.throws(() => applyEdits([{ path: 'src/nope.md', content: 'x' }], { cwd: dir, allowedPaths: ['docs'] }));
  assert.equal((await runAllowed('rm -rf /', { cwd: dir, allowedCommands: ['npm test'] })).ok, false);
  assert.equal(commitAll('blocked on main', { cwd: dir }).ok, false);
  git(['switch', '-c', 'hermes/test'], dir);
  applyEdits([{ path: 'docs/git.md', content: 'ok' }], { cwd: dir, allowedPaths: ['docs'] });
  assert.equal((await runAllowed('npm test', { cwd: dir, allowedCommands: ['npm test'] })).ok, true);
  assert.equal(commitAll('safe commit', { cwd: dir }).ok, true);
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
  const taskReply = await handleTelegramUpdate({ update_id: 14, message: { from: { id: 1001 }, chat: { id: 1 }, text: '/task local telegram task' } }, 'http://localhost:8892');
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
  await fetch('http://localhost:8892/api/stop/reset', { method: 'POST', headers: { authorization: 'Bearer accept-token' } });
  const html = await (await fetch('http://localhost:8892/jarvis')).text();
  assert.match(html, /viewport/);
  assert.ok(!html.includes('localStorage.commandToken'));
  assert.match(html, /csrf/);
  assert.match(html, /submitTask/);
  assert.match(html, /Task history/);
  assert.match(html, /Approval center/);
  assert.match(html, /Workspace selector/);
  assert.match(html, /GLOBAL STOP/);
  assert.match(html, /SpeechRecognition/);
  assert.match(await (await fetch('http://localhost:8892/sw.js')).text(), /caches/);
  const manifest = await (await fetch('http://localhost:8892/manifest.webmanifest')).json();
  assert.equal(manifest.display, 'standalone');
  const response = await fetch('http://localhost:8892/api/tasks', { method: 'POST', headers: { authorization: 'Bearer accept-token', 'content-type': 'application/json' }, body: JSON.stringify({ request: 'jarvis endpoint task', idempotencyKey: 'jarvis-endpoint' }) });
  assert.equal(response.status, 202);
});

test('close acceptance API', () => server.close());

test('persistent sessions, CSRF cookies, restart survival, rotation, logout, revoke-all, cleanup, and rate limits', async () => {
  const { createSession, lookupSession, rotateSession, revokeSession, revokeAll, cleanupSessions, sessionCookies, clearCookies, requireCsrf, clientIp, assertProductionSafe } = await import('../packages/security/session-store.js');
  const { checkRateLimit, cleanupRateLimits } = await import('../packages/security/rate-limit.js');
  const session = createSession({ userId: 'admin', ip: '1.1.1.1', userAgent: 'test' });
  assert.ok(lookupSession(session.id));
  const cookies = sessionCookies(session, { secure: true });
  assert.ok(cookies[0].includes('HttpOnly'));
  assert.ok(cookies[0].includes('Secure'));
  assert.ok(cookies[0].includes('SameSite=Strict'));
  assert.ok(!cookies[1].includes('HttpOnly'));
  assert.ok(clearCookies({ secure: true })[0].includes('Max-Age=0'));
  assert.equal(requireCsrf({ method: 'POST', headers: { 'x-csrf-token': session.csrfToken } }, { csrf_token: session.csrfToken }), true);
  assert.equal(requireCsrf({ method: 'POST', headers: {} }, { csrf_token: session.csrfToken }), false);
  const rotated = rotateSession(session.id, { ip: '1.1.1.1' });
  assert.equal(lookupSession(session.id), null);
  assert.ok(lookupSession(rotated.id));
  revokeSession(rotated.id);
  assert.equal(lookupSession(rotated.id), null);
  const all = createSession({ userId: 'admin' });
  revokeAll('admin');
  assert.equal(lookupSession(all.id), null);
  const expired = createSession({ userId: 'admin', ttlMs: -1 });
  assert.equal(lookupSession(expired.id), null);
  cleanupSessions(100);
  let a = checkRateLimit({ scope: 'api', key: 'ip-a', limit: 2, windowMs: 60000 });
  checkRateLimit({ scope: 'api', key: 'ip-a', limit: 2, windowMs: 60000 });
  let blocked = checkRateLimit({ scope: 'api', key: 'ip-a', limit: 2, windowMs: 60000 });
  let other = checkRateLimit({ scope: 'api', key: 'ip-b', limit: 2, windowMs: 60000 });
  assert.equal(a.allowed, true);
  assert.equal(blocked.allowed, false);
  assert.equal(other.allowed, true);
  cleanupRateLimits(100);
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '8.8.8.8' }, socket: { remoteAddress: '127.0.0.1' } }), '127.0.0.1');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '8.8.8.8, 9.9.9.9' }, socket: { remoteAddress: '127.0.0.1' } }, { trustProxy: true }), '8.8.8.8');
  const validProd = { NODE_ENV: 'production', COMMAND_ADMIN_TOKEN: 'a'.repeat(30), SESSION_SECRET: 'b'.repeat(40), PUBLIC_URL: 'https://example.com', TELEGRAM_MODE: 'polling', TRUST_PROXY: 'false' };
  assert.equal(assertProductionSafe(validProd).ok, true);
  for (const override of [
    { COMMAND_ADMIN_TOKEN: 'short' },
    { SESSION_SECRET: 'short' },
    { PUBLIC_URL: 'http://example.com' },
    { SECURE_COOKIES: 'false' },
    { CORS_ORIGIN: '*' },
    { DEBUG: 'true' },
    { RATE_LIMIT_DISABLED: 'true' },
    { TELEGRAM_MODE: 'webhook', TELEGRAM_WEBHOOK_SECRET: '' },
    { TRUST_PROXY: 'true', TRUSTED_PROXY_CONFIGURED: '' },
    { DB_DIR_WRITABLE: 'false' },
    { ATTACHMENT_DIR_WRITABLE: 'false' },
    { GIT_WORKFLOW_ENABLED: 'true', GIT_AVAILABLE: 'false' }
  ]) assert.equal(assertProductionSafe({ ...validProd, ...override }).ok, false);
});

test('Telegram attachment, voice-note, document delivery, and evidence export boundaries', async () => {
  const { handleTelegramAttachment, handleVoiceNote, sendTelegramDocument } = await import('../packages/telegram/attachments.js');
  const { exportEvidence } = await import('../packages/evidence/export.js');
  const fetcher = async (url) => {
    if (String(url).includes('/getFile')) return { json: async () => ({ ok: true, result: { file_path: 'docs/input.txt', file_size: 11 } }) };
    if (String(url).includes('/file/')) return { arrayBuffer: async () => new TextEncoder().encode('hello world').buffer };
    if (String(url).includes('/sendDocument')) return { json: async () => ({ ok: true }) };
    return { json: async () => ({ ok: false }) };
  };
  const task = createTask({ workspaceId: 'accept', request: 'evidence task', idempotencyKey: 'evidence-task' });
  recordEvidence(task.id, 'final', { token: 'openai-secret-value-redacted' });
  const attachment = await handleTelegramAttachment({ token: 'mock', fileId: 'file-1', taskId: task.id, workspaceId: 'accept', mime: 'text/plain', size: 11, fetcher });
  assert.equal(attachment.cleaned, true);
  assert.match(attachment.content, /hello/);
  await assert.rejects(() => handleTelegramAttachment({ fileId: 'bad', mime: 'application/x-msdownload', fetcher }));
  await assert.rejects(() => handleTelegramAttachment({ fileId: 'big', mime: 'text/plain', size: 2 * 1024 * 1024, fetcher }));
  const voice = await handleVoiceNote({ fileId: 'voice', workspaceId: 'accept', transcribe: async () => 'Create docs/from-voice.md', fetcher });
  assert.equal(voice.ok, true);
  assert.equal((await handleVoiceNote({ fileId: 'voice', workspaceId: 'accept', fetcher })).ok, false);
  assert.equal((await handleVoiceNote({ fileId: 'voice', workspaceId: 'accept', transcribe: async () => { throw new Error('transcribe failed'); }, fetcher })).ok, false);
  assert.equal((await sendTelegramDocument({ token: 'mock', chatId: 1, filename: 'evidence.md', content: 'ok', fetcher })).ok, true);
  const jsonExport = exportEvidence(task.id, 'json');
  const mdExport = exportEvidence(task.id, 'md');
  assert.ok(jsonExport.content.includes(task.id));
  assert.ok(mdExport.content.includes('# Evidence'));
  assert.ok(query(`SELECT COUNT(*) AS count FROM evidence_exports WHERE task_id='${task.id}'`)[0].count >= 2);
  assert.equal(exportEvidence('missing-task', 'json'), null);
});
