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
const css = fs.readFileSync('apps/jarvis-pwa/public/jarvis.css', 'utf8');
const appScript = fs.readFileSync('apps/jarvis-pwa/public/jarvis.js', 'utf8');
const sw = fs.readFileSync('apps/jarvis-pwa/public/sw.js', 'utf8');
const manifest = JSON.parse(fs.readFileSync('apps/jarvis-pwa/public/manifest.webmanifest', 'utf8'));
const helixModulePath = 'apps/jarvis-pwa/public/helix-core.js';
/* The shipped page is now three same-origin files. Behavioral assertions look at the
   whole source; assertions about markup structure or CSP still look at index.html alone. */
const source = [html, css, appScript].join('\n');
const bearer = { authorization: 'Bearer jarvis-ui-token', 'content-type': 'application/json' };

let server;
test('boot API for jarvis UI tests', () => { server = start(8899); assert.ok(server); });

/* ---------- security boundary of the shipped markup ---------- */

test('no browser-side persistence of secrets or command content', () => {
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB/i, 'no web storage of any kind');
  assert.doesNotMatch(source, /document\.cookie/, 'cookies are HttpOnly and never script-read');
});

test('backend data is never rendered through innerHTML', () => {
  assert.doesNotMatch(source, /\.innerHTML\s*=/, 'dynamic rendering must use textContent/DOM nodes');
  assert.doesNotMatch(source, /insertAdjacentHTML|outerHTML\s*=/, 'no HTML string injection');
  assert.match(source, /textContent/);
});

test('no external network dependencies in the shipped page', () => {
  const externals = (html.match(/https?:\/\/[^'"\s)]+/g) || []).filter((url) => !url.startsWith('http://www.w3.org/'));
  assert.deepEqual(externals, [], 'no remote scripts, fonts, images, analytics, or trackers');
  assert.doesNotMatch(source, /gtag|analytics|sentry|hotjar|posthog/i);
});

test('voice remains a staged, inert boundary', () => {
  assert.doesNotMatch(source, /SpeechRecognition|speechSynthesis|getUserMedia|mediaDevices/);
  assert.match(html, /Voice input is staged but not connected/);
  assert.match(source, /idle · listening · transcribing · processing · speaking · interrupted · denied · error/);
  assert.match(html, /id="micBtn"[^>]*disabled|disabled[^>]*id="micBtn"|<button class="mic ghost" id="micBtn" type="button" disabled/);
});

test('no secrets, provider keys, or internal paths in markup', () => {
  assert.doesNotMatch(source, /TELEGRAM_BOT_TOKEN|API_KEY|Bearer\s+[A-Za-z0-9]/);
  assert.doesNotMatch(source, /\/root\/|\/home\/|\/opt\/blackspire/);
});

test('the application script parses before any browser APIs run', () => {
  assert.ok(appScript.length > 1000, 'application script is non-trivial');
  assert.doesNotThrow(() => new vm.Script(appScript, { filename: 'jarvis.js' }));
});

/* ---------- CSP: production allows only same-origin script and style ----------
   script-src 'self'; style-src 'self' — with no unsafe-inline, hash, or nonce.
   Anything inline in index.html would silently fail to run or apply in production. */

test('index.html carries no executable inline script', () => {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0, 'the page still loads an application script');
  for (const [, attrs, body] of scripts) {
    assert.match(attrs, /\ssrc=/, `inline <script> block found: ${body.slice(0, 80)}`);
    assert.equal(body.trim(), '', 'a src-ed script must have an empty body');
  }
  assert.doesNotMatch(html, /\son[a-z]+\s*=\s*["']/i, 'no inline event handler attributes');
  assert.doesNotMatch(html, /(?:href|src)\s*=\s*["']javascript:/i, 'no javascript: URLs');
});

test('index.html carries no inline style block or style attribute', () => {
  assert.doesNotMatch(html, /<style[\s>]/i, 'no inline <style> block');
  const attrs = [...html.matchAll(/\sstyle\s*=\s*"[^"]*"/g)].map((m) => m[0]);
  assert.deepEqual(attrs, [], 'style attributes are blocked by style-src \'self\' too');
});

test('both extracted assets are referenced by same-origin path', () => {
  assert.match(html, /<link\s+rel="stylesheet"\s+href="\/jarvis\.css">/, '/jarvis.css is referenced');
  assert.match(html, /<script\s+src="\/jarvis\.js"><\/script>/, '/jarvis.js is referenced');
  assert.ok(fs.existsSync('apps/jarvis-pwa/public/jarvis.css'));
  assert.ok(fs.existsSync('apps/jarvis-pwa/public/jarvis.js'));
});

test('extraction weakens no CSP directive', () => {
  const server = fs.readFileSync('apps/api/server.js', 'utf8');
  const policy = server.match(/content-security-policy',\s*`([^`]*)`/)[1];
  assert.match(policy, /script-src 'self'\$\{inline\}/, 'script-src stays same-origin in production');
  assert.match(policy, /style-src 'self'\$\{inline\}/, 'style-src stays same-origin in production');
  assert.doesNotMatch(html, /nonce=/, 'extraction made nonces unnecessary');
  assert.doesNotMatch(html, /sha(?:256|384|512)-/, 'extraction made hashes unnecessary');
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
    assert.match(source, new RegExp(label), `missing status label: ${label}`);
  }
});

test('known event types have labels and unknown events degrade safely', () => {
  for (const type of ['input.received', 'policy.allowed', 'policy.denied', 'task.queued', 'task.running', 'hermes.selected', 'provider.selected', 'task.completed', 'task.failed', 'task.cancellation_requested', 'task.cancellation_cleanup', 'task.cancelled', 'approval.required', 'approval.granted', 'approval.denied', 'delivery.pending', 'delivery.retry_wait', 'delivery.delivered', 'delivery.terminal_failed']) {
    assert.match(source, new RegExp(type.replace('.', '\\.')), `missing event type: ${type}`);
  }
  assert.match(source, /System event/, 'unknown events render as sanitized generic entries');
});

test('Telegram delivery states are all representable', () => {
  for (const label of ['Delivery pending', 'Retrying delivery', 'Delivered', 'Delivery failed \\(terminal\\)']) assert.match(source, new RegExp(label));
});

test('Safe Mode, emergency stop, and test/production mode are visible states', () => {
  assert.match(source, /Safe Mode/);
  assert.match(source, /Not reported by control plane/);
  assert.match(source, /Emergency stop/);
  assert.match(source, /TEST FIXTURE/);
  assert.match(source, /Production contracts/);
});

/* ---------- Helix Core ---------- */

test('Helix Core covers every system state and pauses safely', () => {
  for (const state of ['dormant', 'listening', 'processing', 'approval', 'completed', 'denied', 'cancelled', 'offline', 'emergency']) {
    assert.match(source, new RegExp(`data-core="${state}"`), `missing helix state: ${state}`);
  }
  assert.match(source, /prefers-reduced-motion/);
  assert.match(source, /animation-play-state:\s*paused/);
  assert.match(html, /aria-hidden="true"/);
  assert.match(source, /Helix Core state:/, 'screen-reader equivalent exists');
  assert.doesNotMatch(source, /arc reactor|stark|marvel/i, 'no film-derived references');
});

test('Helix Core enhancement is a separate optional lazy chunk with a permanent fallback', () => {
  assert.ok(fs.existsSync(helixModulePath), 'lazy Helix module exists');
  const module = fs.readFileSync(helixModulePath, 'utf8');
  assert.match(source, /import\('\/helix-core\.js'\)/, 'module is dynamically imported');
  assert.match(source, /helix-enhancement/, 'enhancement has a separate non-blocking mount point');
  assert.match(html, /data-helix-fallback="svg"/, 'the inert SVG survives in markup when the module never loads');
  assert.match(appScript, /dataset\.helixFallback = 'svg'/, 'a failed import falls back to the SVG');
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
  assert.match(source, /env\(safe-area-inset-top\)/);
  assert.match(source, /env\(safe-area-inset-bottom\)/);
  assert.match(source, /font-size:16px/);
  assert.match(source, /min-height:44px/);
});

test('accessibility: landmarks, live regions, focus visibility, labels', () => {
  for (const token of ['aria-live="polite"', 'role="status"', 'role="alert"', ':focus-visible', 'class="sr-only"', 'aria-current', 'aria-label', 'Skip to content']) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `missing a11y token: ${token}`);
  }
});

test('polling is bounded, visibility-aware, and abortable', () => {
  assert.match(source, /visibilitychange/);
  assert.match(source, /AbortController/);
  assert.match(source, /30000/, 'max backoff interval capped');
  assert.match(source, /Math\.min\(Math\.round\(store\.pollMs \* 1\.7\), 30000\)/, 'exponential backoff with cap');
  assert.match(source, /pagehide/, 'polling and animation resources tear down on page exit');
});

test('frontend API contracts are documented without inventing response shapes', () => {
  for (const type of ['UnifiedInputResponse', 'ConversationResponse', 'TaskRecord', 'SystemHealth']) {
    assert.match(source, new RegExp(`@typedef \\{Object\\} ${type}`), `missing API type: ${type}`);
  }
});

test('active workspace filters task and conversation summaries in the browser', () => {
  assert.match(source, /function taskInActiveWorkspace/);
  assert.match(source, /filter\(taskInActiveWorkspace\)/);
});

test('submission uses idempotency keys and blocks double submit', () => {
  assert.match(source, /idempotencyKey/);
  assert.match(source, /crypto\.randomUUID/);
  assert.match(source, /store\.inflight/);
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
  assert.match(source, /if \(applyingUpdate\) location\.reload\(\)/, 'controllerchange never reloads on first install, only on operator-chosen update');
});

test('the update bar reports update state honestly and never latches on', () => {
  assert.match(source, /const hadController = Boolean\(navigator\.serviceWorker\.controller\)/, 'a first install has no earlier worker to update from');
  assert.match(source, /hadController \? registration\.waiting : null/, 'only a genuine waiting worker over an existing controller is an update');
  assert.match(source, /classList\.toggle\('show', Boolean\(waiting\)\)/, 'the bar clears when the waiting worker activates');
  assert.doesNotMatch(source, /byId\('updateBar'\)\.classList\.add\('show'\)/, 'the update bar must never be latched on without a matching clear');
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
