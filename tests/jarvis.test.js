import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-jarvis-'));
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'jarvis.sqlite');
process.env.COMMAND_ADMIN_TOKEN = 'jarvis-token';
process.env.PORT = '8898';
process.env.HERMES_TEST_PROVIDER = 'mock';

const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { start } = await import('../apps/api/server.js');

let server;
test('boot API for jarvis tests', () => { server = start(8898, undefined, { exitOnListenError: false }); assert.ok(server); });

test('Jarvis markup exposes evidence download, approval history, and status badge wiring', async () => {
  const html = await (await fetch('http://localhost:8898/jarvis')).text();
  // Behavior lives in the CSP-externalized /jarvis.js, which is read from disk here
  // because serving it is the control plane's concern, not this test's.
  const appScript = fs.readFileSync('apps/jarvis-pwa/public/jarvis.js', 'utf8');
  assert.match(html, /<script src="\/jarvis\.js"><\/script>/, 'the page loads its script same-origin');
  assert.doesNotMatch(html + appScript, /localStorage/i, 'admin token must never be persisted to localStorage');
  assert.match(appScript, /downloadExport\('json'\)/);
  assert.match(appScript, /downloadExport\('md'\)/);
  assert.match(appScript, /loadApprovalHistory/);
  assert.match(appScript, /api\/tasks\/\$\{selectedTaskId\}\/export\.\$\{format\}/);
  assert.match(appScript, /renderStatus/);
  assert.match(html, /Emergency stop/);
  assert.match(appScript, /Telegram: /);
  assert.match(appScript, /Session expired/);
  assert.match(html, /viewport/);
});

test('dangerous PWA actions require a second press on the same control', () => {
  const source = fs.readFileSync('apps/jarvis-pwa/public/jarvis.js', 'utf8');
  const start = source.indexOf('/* ---------- dangerous-action confirmation ---------- */');
  const endMarker = '/* ---------- end dangerous-action confirmation ---------- */';
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, 'confirmation state machine must remain directly testable');

  const notices = [];
  const timers = [];
  const context = {
    setNotice: (id, message) => notices.push({ id, message }),
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimeout: () => {},
  };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end + endMarker.length)}\nthis.confirmDangerousAction = confirmDangerousAction; this.restoreDangerousActionConfirmation = restoreDangerousActionConfirmation;`, context);

  const button = fakeButton('Approve');
  assert.equal(context.confirmDangerousAction({ key: 'approval:approve:task-1', button, confirmLabel: 'Confirm approve', noticeId: 'approvalNotice', prompt: 'Confirm task 1' }), false);
  assert.equal(button.textContent, 'Confirm approve');
  assert.equal(button.attributes['aria-pressed'], 'true');
  assert.deepEqual(notices.at(-1), { id: 'approvalNotice', message: 'Confirm task 1' });
  assert.equal(timers.at(-1).delay, 6000);

  const replacement = fakeButton('Approve');
  context.restoreDangerousActionConfirmation('approval:approve:task-1', replacement, 'Confirm approve', 'Approve');
  assert.equal(replacement.textContent, 'Confirm approve', 'a polling render must preserve the visible armed state');
  assert.equal(replacement.attributes['aria-pressed'], 'true');
  assert.equal(context.confirmDangerousAction({ key: 'approval:approve:task-1', button: replacement, confirmLabel: 'Confirm approve', noticeId: 'approvalNotice', prompt: 'Confirm task 1' }), true);
  assert.equal(replacement.textContent, 'Approve');
  assert.equal(replacement.attributes['aria-pressed'], undefined);
  assert.deepEqual(notices.at(-1), { id: 'approvalNotice', message: '' }, 'confirmation must clear its live prompt');
});

test('approval, rejection, and cancellation confirmations cannot confirm each other and expire closed', () => {
  const source = fs.readFileSync('apps/jarvis-pwa/public/jarvis.js', 'utf8');
  const start = source.indexOf('/* ---------- dangerous-action confirmation ---------- */');
  const endMarker = '/* ---------- end dangerous-action confirmation ---------- */';
  const end = source.indexOf(endMarker, start);
  const timers = [];
  const notices = [];
  const context = {
    setNotice: (id, message) => notices.push({ id, message }),
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
    clearTimeout: () => {},
  };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end + endMarker.length)}\nthis.confirmDangerousAction = confirmDangerousAction;`, context);

  const approve = fakeButton('Approve');
  const reject = fakeButton('Reject');
  const cancel = fakeButton('Cancel task');
  const arm = (key, button, label) => context.confirmDangerousAction({ key, button, confirmLabel: `Confirm ${label}`, noticeId: 'notice', prompt: label });

  assert.equal(arm('approval:approve:task-2', approve, 'approve'), false);
  assert.equal(arm('approval:reject:task-2', reject, 'reject'), false, 'reject must replace, not confirm, an armed approval');
  assert.equal(approve.textContent, 'Approve');
  assert.equal(arm('cancel:task-2', cancel, 'cancellation'), false, 'cancel must replace, not confirm, an armed rejection');
  assert.equal(reject.textContent, 'Reject');

  timers.at(-1).callback();
  assert.equal(cancel.textContent, 'Cancel task');
  assert.deepEqual(notices.at(-1), { id: 'notice', message: '' }, 'expiry must clear its stale live prompt');
  assert.equal(arm('cancel:task-2', cancel, 'cancellation'), false, 'an expired confirmation must require a new first press');
});

test('approval, rejection, and cancellation handlers all use the confirmation gate before mutation', () => {
  const source = fs.readFileSync('apps/jarvis-pwa/public/jarvis.js', 'utf8');
  const html = fs.readFileSync('apps/jarvis-pwa/public/index.html', 'utf8');
  assert.match(source, /key: `approval:\$\{action\}:\$\{taskId\}`/);
  assert.match(source, /key: `cancel:\$\{task\.id\}`/);
  assert.match(source, /if \(!confirmDangerousAction\([\s\S]*?\)\) return;[\s\S]*?buttons\.forEach\(\(b\) => \{ b\.disabled = true; \}\);/);
  assert.match(source, /if \(!confirmDangerousAction\([\s\S]*?key: `cancel:[\s\S]*?\)\) return;[\s\S]*?cancelButton\.disabled = true;/);
  assert.match(source, /decideApprovalAction\(task\.id, 'reject', reject, approve\)/);
  assert.match(source, /restoreDangerousActionConfirmation\(`approval:approve:\$\{task\.id\}`/);
  assert.match(source, /restoreDangerousActionConfirmation\(`approval:reject:\$\{task\.id\}`/);
  assert.match(html, /id="approvalNotice"[^>]*role="status"[^>]*aria-live="polite"/);
});

test('PWA fails visibly closed when deployment identity is absent or malformed', () => {
  const source = fs.readFileSync('apps/jarvis-pwa/public/jarvis.js', 'utf8');
  const start = source.indexOf('/* ---------- deployment identity (server-authoritative, display only) ---------- */');
  const end = source.indexOf('/* ---------- app state', start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}\nthis.deploymentIdentity = deploymentIdentity;`, context);
  assert.deepEqual({ ...context.deploymentIdentity({}) }, { environment: null, build: null, verified: false });
  assert.deepEqual({ ...context.deploymentIdentity({ environment: '<production>', buildSha: 'not-a-sha' }) }, { environment: null, build: null, verified: false });
});

test('PWA renders bounded server-authoritative environment and build identity', () => {
  const source = fs.readFileSync('apps/jarvis-pwa/public/jarvis.js', 'utf8');
  const start = source.indexOf('/* ---------- deployment identity (server-authoritative, display only) ---------- */');
  const end = source.indexOf('/* ---------- app state', start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}\nthis.deploymentIdentity = deploymentIdentity;`, context);
  assert.deepEqual({ ...context.deploymentIdentity({ environment: 'vps-staging', buildSha: 'abcdef0123456789' }) }, { environment: 'vps-staging', build: 'abcdef0123456789', verified: true });
  assert.match(source, /Stale — awaiting a fresh sync/);
  assert.match(source, /Environment and build identity are not reported/);
});

test('canonical sync freshness expires by clock even while a refresh remains unresolved', () => {
  const source = fs.readFileSync('apps/jarvis-pwa/public/jarvis.js', 'utf8');
  const start = source.indexOf('const MIN_CANONICAL_FRESH_MS');
  const end = source.indexOf('/* ---------- app state', start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}\nthis.canonicalSyncStale = canonicalSyncStale;`, context);

  const syncedAt = Date.parse('2026-08-11T00:00:00.000Z');
  assert.equal(context.canonicalSyncStale(new Date(syncedAt).toISOString(), 2500, syncedAt + 15000), false);
  assert.equal(context.canonicalSyncStale(new Date(syncedAt).toISOString(), 2500, syncedAt + 15001), true,
    'freshness depends on elapsed time, not completion of the next fetch');
  assert.match(source, /freshnessTimer = setTimeout\(\(\) => \{ freshnessTimer = 0; render\(\); \}/,
    'an independent deadline re-renders even when refreshAll is awaiting a hung request');
  assert.match(source, /store\.lastSync = new Date\(\)\.toISOString\(\);[\s\S]*?scheduleFreshnessDeadline\(\);/,
    'every successful canonical sync arms the independent freshness deadline');
});

function fakeButton(label) {
  return {
    textContent: label,
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
  };
}

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
