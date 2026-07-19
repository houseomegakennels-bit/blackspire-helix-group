import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-jarvis-ui-'));
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'jarvis-ui.sqlite');
process.env.COMMAND_ADMIN_TOKEN = 'jarvis-ui-token';
process.env.PORT = '8899';
process.env.HERMES_TEST_PROVIDER = 'mock';

const { start } = await import('../apps/api/server.js');

const html = fs.readFileSync('apps/jarvis-pwa/public/index.html', 'utf8');
const sw = fs.readFileSync('apps/jarvis-pwa/public/sw.js', 'utf8');
const manifest = JSON.parse(fs.readFileSync('apps/jarvis-pwa/public/manifest.webmanifest', 'utf8'));
const helixModulePath = 'apps/jarvis-pwa/public/helix-core.js';
const inlineScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1] || '';
const bearer = { authorization: 'Bearer jarvis-ui-token', 'content-type': 'application/json' };

let server;
test('boot API for jarvis UI tests', () => { server = start(8899); assert.ok(server); });

/* ---------- security boundary of the shipped markup ---------- */

test('no browser-side persistence of secrets or command content', () => {
  assert.doesNotMatch(html, /localStorage|sessionStorage|indexedDB/i, 'no web storage of any kind');
  assert.doesNotMatch(html, /document\.cookie/, 'cookies are HttpOnly and never script-read');
});

test('backend data is never rendered through innerHTML', () => {
  assert.doesNotMatch(html, /\.innerHTML\s*=/, 'dynamic rendering must use textContent/DOM nodes');
  assert.doesNotMatch(html, /insertAdjacentHTML|outerHTML\s*=/, 'no HTML string injection');
  assert.match(html, /textContent/);
});

test('no external network dependencies in the shipped page', () => {
  const externals = (html.match(/https?:\/\/[^'"\s)]+/g) || []).filter((url) => !url.startsWith('http://www.w3.org/'));
  assert.deepEqual(externals, [], 'no remote scripts, fonts, images, analytics, or trackers');
  assert.doesNotMatch(html, /gtag|analytics|sentry|hotjar|posthog/i);
});

test('voice remains a staged, inert boundary', () => {
  assert.doesNotMatch(html, /SpeechRecognition|speechSynthesis|getUserMedia|mediaDevices/);
  assert.match(html, /Voice input is staged but not connected/);
  assert.match(html, /idle · listening · transcribing · processing · speaking · interrupted · denied · error/);
  assert.match(html, /id="micBtn"[^>]*disabled|disabled[^>]*id="micBtn"|<button class="mic ghost" id="micBtn" type="button" disabled/);
});

test('no secrets, provider keys, or internal paths in markup', () => {
  assert.doesNotMatch(html, /TELEGRAM_BOT_TOKEN|API_KEY|Bearer\s+[A-Za-z0-9]/);
  assert.doesNotMatch(html, /\/root\/|\/home\/|\/opt\/blackspire/);
});

test('inline application script parses before any browser APIs run', () => {
  assert.ok(inlineScript.length > 1000, 'application script was extracted');
  assert.doesNotThrow(() => new vm.Script(inlineScript, { filename: 'jarvis-inline.js' }));
});

/* ---------- required screens and canonical vocabulary ---------- */

test('all seven screens exist as views', () => {
  for (const view of ['command', 'conversation', 'task', 'events', 'approvals', 'system', 'evidence']) {
    assert.match(html, new RegExp(`data-view="${view}"`), `missing screen: ${view}`);
  }
  assert.match(html, /data-view="signin"/);
});

test('canonical status vocabulary is complete and color-independent', () => {
  for (const label of ['Queued', 'Processing', 'Awaiting approval', 'Completed', 'Failed', 'Cancelled', 'Denied by policy']) {
    assert.match(html, new RegExp(label), `missing status label: ${label}`);
  }
});

test('known event types have labels and unknown events degrade safely', () => {
  for (const type of ['input.received', 'policy.allowed', 'policy.denied', 'task.queued', 'task.running', 'hermes.selected', 'provider.selected', 'task.completed', 'task.failed', 'task.cancellation_requested', 'task.cancellation_cleanup', 'task.cancelled', 'approval.required', 'approval.granted', 'approval.denied', 'delivery.pending', 'delivery.retry_wait', 'delivery.delivered', 'delivery.terminal_failed']) {
    assert.match(html, new RegExp(type.replace('.', '\\.')), `missing event type: ${type}`);
  }
  assert.match(html, /System event/, 'unknown events render as sanitized generic entries');
});

test('Telegram delivery states are all representable', () => {
  for (const label of ['Delivery pending', 'Retrying delivery', 'Delivered', 'Delivery failed \\(terminal\\)']) assert.match(html, new RegExp(label));
});

test('Safe Mode, emergency stop, and test/production mode are visible states', () => {
  assert.match(html, /Safe Mode/);
  assert.match(html, /Not reported by control plane/);
  assert.match(html, /Emergency stop/);
  assert.match(html, /TEST FIXTURE/);
  assert.match(html, /Production contracts/);
});

/* ---------- Helix Core ---------- */

test('Helix Core covers every system state and pauses safely', () => {
  for (const state of ['dormant', 'listening', 'processing', 'approval', 'completed', 'denied', 'cancelled', 'offline', 'emergency']) {
    assert.match(html, new RegExp(`data-core="${state}"`), `missing helix state: ${state}`);
  }
  assert.match(html, /prefers-reduced-motion/);
  assert.match(html, /animation-play-state:\s*paused/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /Helix Core state:/, 'screen-reader equivalent exists');
  assert.doesNotMatch(html, /arc reactor|stark|marvel/i, 'no film-derived references');
});

test('Helix Core enhancement is a separate optional lazy chunk with a permanent fallback', () => {
  assert.ok(fs.existsSync(helixModulePath), 'lazy Helix module exists');
  const module = fs.readFileSync(helixModulePath, 'utf8');
  assert.match(html, /import\('\/helix-core\.js'\)/, 'module is dynamically imported');
  assert.match(html, /helix-enhancement/, 'enhancement has a separate non-blocking mount point');
  assert.match(module, /export function mountHelixCore/);
  assert.match(module, /devicePixelRatio/);
  assert.match(module, /Math\.min\([^\n]*1\.5/, 'device pixel ratio is capped');
  assert.match(module, /webglcontextlost/);
  assert.match(module, /webglcontextrestored/);
  assert.match(module, /prefers-reduced-motion/);
  assert.doesNotMatch(module, /shadow|postprocess|texture|fetch\(/i, 'no heavy rendering or downloaded assets');
  const syntax = spawnSync(process.execPath, ['--check', helixModulePath], { encoding: 'utf8' });
  assert.equal(syntax.status, 0, syntax.stderr);
});

/* ---------- mobile, accessibility, PWA behaviors in markup ---------- */

test('mobile ergonomics: safe areas, 16px inputs, no text zoom, touch targets', () => {
  assert.match(html, /viewport-fit=cover/);
  assert.match(html, /env\(safe-area-inset-top\)/);
  assert.match(html, /env\(safe-area-inset-bottom\)/);
  assert.match(html, /font-size:16px/);
  assert.match(html, /min-height:44px/);
});

test('accessibility: landmarks, live regions, focus visibility, labels', () => {
  for (const token of ['aria-live="polite"', 'role="status"', 'role="alert"', ':focus-visible', 'class="sr-only"', 'aria-current', 'aria-label', 'Skip to content']) {
    assert.match(html, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing a11y token: ${token}`);
  }
});

test('polling is bounded, visibility-aware, and abortable', () => {
  assert.match(html, /visibilitychange/);
  assert.match(html, /AbortController/);
  assert.match(html, /30000/, 'max backoff interval capped');
  assert.match(html, /Math\.min\(Math\.round\(store\.pollMs \* 1\.7\), 30000\)/, 'exponential backoff with cap');
  assert.match(html, /pagehide/, 'polling and animation resources tear down on page exit');
});

test('frontend API contracts are documented without inventing response shapes', () => {
  for (const type of ['UnifiedInputResponse', 'ConversationResponse', 'TaskRecord', 'SystemHealth']) {
    assert.match(html, new RegExp(`@typedef \\{Object\\} ${type}`), `missing API type: ${type}`);
  }
});

test('active workspace filters task and conversation summaries in the browser', () => {
  assert.match(html, /function taskInActiveWorkspace/);
  assert.match(html, /filter\(taskInActiveWorkspace\)/);
});

test('submission uses idempotency keys and blocks double submit', () => {
  assert.match(html, /idempotencyKey/);
  assert.match(html, /crypto\.randomUUID/);
  assert.match(html, /store\.inflight/);
});

/* ---------- service worker safety ---------- */

test('service worker never caches API, auth, or privileged responses', () => {
  assert.match(sw, /\/api\//);
  assert.match(sw, /startsWith\('\/api\/'\)/);
  assert.match(sw, /method !== 'GET'/, 'state-changing requests are never intercepted');
  assert.match(sw, /'\/health'/);
  assert.match(sw, /SKIP_WAITING/, 'explicit update flow');
  assert.match(sw, /caches\.delete/, 'old cache versions are purged');
  const puts = [...sw.matchAll(/cache\.put\(([^,]+),/g)].map((match) => match[1].trim());
  assert.deepEqual(puts, ["'/jarvis'", 'event.request'], 'only the static shell is ever written to cache');
  const shell = sw.match(/const SHELL = \[([^\]]*)\]/)[1];
  assert.doesNotMatch(shell, /api|unified/, 'precache list holds no API routes');
  assert.match(html, /if \(applyingUpdate\) location\.reload\(\)/, 'controllerchange never reloads on first install, only on operator-chosen update');
});

test('the update bar reports update state honestly and never latches on', () => {
  assert.match(html, /const hadController = Boolean\(navigator\.serviceWorker\.controller\)/, 'a first install has no earlier worker to update from');
  assert.match(html, /hadController \? registration\.waiting : null/, 'only a genuine waiting worker over an existing controller is an update');
  assert.match(html, /classList\.toggle\('show', Boolean\(waiting\)\)/, 'the bar clears when the waiting worker activates');
  assert.doesNotMatch(html, /byId\('updateBar'\)\.classList\.add\('show'\)/, 'the update bar must never be latched on without a matching clear');
});

test('service worker cannot replace the Jarvis shell with another navigation', () => {
  assert.match(sw, /url\.pathname !== '\/jarvis' && url\.pathname !== '\/'/);
});

test('service worker awaits only successful shell cache writes', () => {
  assert.match(sw, /if \(response\.ok\) await cache\.put\('\/jarvis', response\.clone\(\)\)/);
  assert.match(sw, /if \(response\.ok\) await cache\.put\(event\.request, response\.clone\(\)\)/);
});

/* ---------- manifest ---------- */

test('web manifest is a valid installable Blackspire identity', () => {
  assert.equal(manifest.name, 'Blackspire Jarvis');
  assert.equal(manifest.short_name, 'Jarvis');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/jarvis');
  assert.equal(manifest.theme_color, '#04070C');
  assert.equal(manifest.background_color, '#04070C');
  assert.ok(manifest.icons.length >= 2);
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
  for (const icon of manifest.icons) assert.match(icon.src, /^data:image\/svg\+xml,/, 'icons are self-contained originals');
});

/* ---------- live vertical slice against the control plane ---------- */

let conversationId = '';
let taskId = '';

test('command submission creates one canonical conversation and task', async () => {
  const response = await fetch('http://localhost:8899/api/unified-input', { method: 'POST', headers: bearer, body: JSON.stringify({ text: 'Report status without changing files.', idempotencyKey: 'ui-suite-1' }) });
  assert.equal(response.status, 202);
  const body = await response.json();
  assert.ok(body.conversationId && body.taskId);
  assert.equal(body.duplicate, false);
  conversationId = body.conversationId; taskId = body.taskId;
});

test('duplicate submission is prevented through idempotency', async () => {
  const response = await fetch('http://localhost:8899/api/unified-input', { method: 'POST', headers: bearer, body: JSON.stringify({ text: 'Report status without changing files.', idempotencyKey: 'ui-suite-1' }) });
  const body = await response.json();
  assert.equal(body.duplicate, true);
  assert.equal(body.taskId, taskId, 'no second canonical task');
});

test('follow-up reuses the existing conversation', async () => {
  const response = await fetch('http://localhost:8899/api/unified-input', { method: 'POST', headers: bearer, body: JSON.stringify({ text: 'Follow-up summary please.', conversationId, idempotencyKey: 'ui-suite-2' }) });
  const body = await response.json();
  assert.equal(body.conversationId, conversationId);
  assert.notEqual(body.taskId, taskId);
});

test('conversation payload carries ordered events, messages, tasks, deliveries', async () => {
  const body = await (await fetch(`http://localhost:8899/api/conversations/${conversationId}`, { headers: bearer })).json();
  assert.ok(Array.isArray(body.events) && body.events.length >= 2);
  const stamps = body.events.map((event) => event.created_at + event.id);
  assert.deepEqual(stamps, [...stamps].sort(), 'events arrive ordered');
  assert.equal(body.messages.length, 2);
  assert.ok(Array.isArray(body.deliveries));
  assert.ok(body.tasks.every((task) => Array.isArray(task.providerAttribution) && Array.isArray(task.evidenceMetadata)));
});

test('refresh recovery: canonical state is reconstructable from IDs alone', async () => {
  const task = (await (await fetch(`http://localhost:8899/api/tasks/${taskId}`, { headers: bearer })).json()).task;
  assert.equal(task.conversation_id, conversationId, 'a task deep link recovers its conversation');
  assert.ok(task.idempotency_key);
});

test('eligible cancellation is recorded canonically', async () => {
  const body = await (await fetch(`http://localhost:8899/api/tasks/${taskId}/cancel`, { method: 'POST', headers: bearer, body: '{}' })).json();
  assert.equal(body.task.status, 'cancelled');
  const events = (await (await fetch(`http://localhost:8899/api/conversations/${conversationId}/events`, { headers: bearer })).json()).events;
  assert.ok(events.some((event) => event.type === 'task.cancellation_requested'));
  assert.ok(events.some((event) => event.type === 'task.cancelled'));
});

test('cancellation of a terminal task is refused without fake success', async () => {
  const body = await (await fetch(`http://localhost:8899/api/tasks/${taskId}/cancel`, { method: 'POST', headers: bearer, body: '{}' })).json();
  assert.equal(body.cleanup?.invoked, false, 'terminal task cleanup is not re-invoked');
});

test('unauthenticated canonical reads are rejected, not faked', async () => {
  assert.equal((await fetch('http://localhost:8899/api/tasks')).status, 401);
  assert.equal((await fetch(`http://localhost:8899/api/conversations/${conversationId}`)).status, 401);
});

test('close API for jarvis UI tests', () => server.close());
