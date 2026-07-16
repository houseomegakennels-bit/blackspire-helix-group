import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { PORT, ADMIN_TOKEN } from '../../packages/shared/config.js';
import { json, readJson, id, redact } from '../../packages/shared/util.js';
import { createTask, getTask, listTasks, logs, transition, setFlag, getFlag, audit, decideApproval, taskRecords } from '../../packages/task-engine/tasks.js';
import { listWorkspaces } from '../../packages/workspace-registry/workspaces.js';
import { activeModes } from '../../packages/providers/providers.js';
import { handleTelegramUpdate } from '../telegram/bot.js';
import { createSession, getSession, destroySession, revokeAllSessions, parseCookies, sessionCookie, clearSessionCookies, checkCsrf, rateLimit, safeError, requireProductionSafeConfig } from '../../packages/shared/security.js';

let emergencyStopMemory = false;

function isPublicAsset(url = '') {
  return url === '/health' || url === '/ready' || url === '/' || url === '/jarvis' || url.startsWith('/manifest') || url.startsWith('/sw.js') || url === '/api/auth/login' || url === '/api/auth/session';
}

function authContext(req) {
  if (req.headers.authorization === `Bearer ${ADMIN_TOKEN}`) return { ok: true, mode: 'bearer', session: null };
  const session = getSession(parseCookies(req.headers.cookie || '').bc_session);
  if (session) return { ok: true, mode: 'session', session };
  return { ok: false, mode: 'none', session: null };
}

function writeJson(res, status, body, headers = {}) {
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  return json(res, status, body);
}

async function route(req, res) {
  setSecurityHeaders(req, res);
  const u = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (u.pathname === '/api/auth/login' && req.method === 'POST') return login(req, res);
    if (u.pathname === '/telegram/webhook' && req.method === 'POST') return telegramWebhook(req, res);

    const auth = authContext(req);
    if (!isPublicAsset(req.url) && !auth.ok) return json(res, 401, { error: 'unauthorized' });
    if (isStateChanging(req) && auth.mode === 'session' && !checkCsrf(req, auth.session)) return json(res, 403, { error: 'invalid csrf token' });

    if (u.pathname === '/api/auth/session') return json(res, 200, { authenticated: auth.ok, csrfToken: auth.session?.csrfToken, expiresAt: auth.session?.expiresAt });
    if (u.pathname === '/api/auth/logout' && req.method === 'POST') { if (auth.session) destroySession(auth.session.sessionId); return writeJson(res, 200, { ok: true }, { 'set-cookie': clearSessionCookies() }); }
    if (u.pathname === '/api/auth/revoke-all' && req.method === 'POST') { revokeAllSessions(); audit(null, 'administrator', 'sessions.revoked'); return writeJson(res, 200, { ok: true }, { 'set-cookie': clearSessionCookies() }); }
    if (u.pathname === '/health') return json(res, 200, { ok: true, service: 'blackspire-command-api', emergencyStop: getFlag('emergency_stop') === 'active' || emergencyStopMemory, telegramMode: process.env.TELEGRAM_MODE || (process.env.TELEGRAM_BOT_TOKEN ? 'polling' : 'dry-run') });
    if (u.pathname === '/ready') return json(res, 200, { ok: true, providers: activeModes(), productionConfig: requireProductionSafeConfig() });
    if (u.pathname === '/api/workspaces') return json(res, 200, { workspaces: listWorkspaces() });
    if (u.pathname === '/api/tasks' && req.method === 'GET') return json(res, 200, { tasks: listTasks() });
    if (u.pathname === '/api/tasks' && req.method === 'POST') return createTaskRoute(req, res);

    const exportMatch = u.pathname.match(/^\/api\/tasks\/([^/]+)\/export\.(json|md)$/);
    if (exportMatch) return exportTask(res, exportMatch[1], exportMatch[2]);

    const match = u.pathname.match(/^\/api\/tasks\/([^/]+)(?:\/(logs|approvals|approve|reject|pause|resume|cancel))?$/);
    if (match) return taskRoute(req, res, match);

    if (u.pathname === '/api/stop' && req.method === 'POST') {
      const limit = checkLimit(req, 'stop', 5, 60000); if (!limit.allowed) return limited(res, limit);
      emergencyStopMemory = true;
      setFlag('emergency_stop', 'active');
      audit(null, 'administrator', 'emergency_stop.activated');
      return json(res, 200, { ok: true, emergencyStop: true });
    }
    if (u.pathname === '/api/stop/reset' && req.method === 'POST') {
      const limit = checkLimit(req, 'stop-reset', 3, 60000); if (!limit.allowed) return limited(res, limit);
      if (auth.mode !== 'session' || req.headers['x-confirmation-token'] !== `${auth.session.csrfToken}:RESET`) return json(res, 403, { error: 'fresh session confirmation required' });
      emergencyStopMemory = false;
      setFlag('emergency_stop', 'inactive');
      audit(null, 'administrator', 'emergency_stop.reset');
      return json(res, 200, { ok: true, emergencyStop: false });
    }

    if (u.pathname === '/' || u.pathname === '/jarvis') return serve(res, 'apps/jarvis-pwa/public/index.html', 'text/html');
    if (u.pathname === '/manifest.webmanifest') return serve(res, 'apps/jarvis-pwa/public/manifest.webmanifest', 'application/manifest+json');
    if (u.pathname === '/sw.js') return serve(res, 'apps/jarvis-pwa/public/sw.js', 'text/javascript');
    return json(res, 404, { error: 'not found' });
  } catch (error) {
    return json(res, 500, { error: safeError(error) });
  }
}

async function login(req, res) {
  const limit = checkLimit(req, 'login', Number(process.env.LOGIN_RATE_LIMIT || 5), 60000); if (!limit.allowed) return limited(res, limit);
  const body = await readJson(req);
  const session = createSession(body.adminToken, { ip: ip(req), userAgent: req.headers['user-agent'] || '' });
  if (!session) { audit(null, 'auth', 'login.failed', { ip: ip(req) }); return json(res, 401, { error: 'invalid credentials' }); }
  audit(null, 'auth', 'login.succeeded', { ip: ip(req) });
  return writeJson(res, 200, { ok: true, csrfToken: session.csrfToken, expiresAt: session.expiresAt }, { 'set-cookie': sessionCookie(session) });
}

async function createTaskRoute(req, res) {
  const limit = checkLimit(req, 'task-create', Number(process.env.TASK_RATE_LIMIT || 20), 60000); if (!limit.allowed) return limited(res, limit);
  if (emergencyStopMemory || getFlag('emergency_stop') === 'active') return json(res, 423, { error: 'emergency stop active' });
  const body = await readJson(req);
  const request = String(body.request || '').trim();
  if (!request || request.length > 4000) return json(res, 422, { error: 'request is required and must be under 4000 characters' });
  const task = createTask({ workspaceId: body.workspaceId || 'blackspire-command', request, idempotencyKey: body.idempotencyKey || id('idem') });
  return json(res, 202, { task });
}

function taskRoute(req, res, match) {
  const task = getTask(match[1]);
  if (!task) return json(res, 404, { error: 'not found' });
  if (!match[2]) return json(res, 200, { task });
  if (match[2] === 'logs') return json(res, 200, { logs: logs(task.id) });
  if (match[2] === 'approvals') return json(res, 200, { approvals: taskRecords(task.id).approvals });
  const limit = checkLimit(req, 'approval-action', 20, 60000); if (!limit.allowed) return limited(res, limit);
  if (match[2] === 'approve') { const decision = decideApproval(task.id, 'approved', 'Approved by administrator'); if (decision === 'expired') return json(res, 409, { error: 'approval expired' }); return json(res, 200, { task: transition(task.id, 'queued', { summary: 'Approved by administrator' }) }); }
  if (match[2] === 'reject') { decideApproval(task.id, 'rejected', 'Rejected by administrator'); return json(res, 200, { task: transition(task.id, 'cancelled', { error: 'Rejected by administrator' }) }); }
  if (match[2] === 'pause') return json(res, 200, { task: transition(task.id, 'waiting_for_approval', { summary: 'Paused by administrator' }) });
  if (match[2] === 'resume') return json(res, 200, { task: transition(task.id, 'queued') });
  if (match[2] === 'cancel') return json(res, 200, { task: transition(task.id, 'cancelled', { error: 'Cancelled by administrator' }) });
  return json(res, 404, { error: 'not found' });
}

function exportTask(res, taskId, format) {
  const task = getTask(taskId);
  if (!task) return json(res, 404, { error: 'task not found' });
  const bundle = redact(JSON.stringify({ task, ...taskRecords(taskId) }, null, 2));
  if (bundle.length > Number(process.env.EVIDENCE_BUNDLE_MAX_BYTES || 500000)) return json(res, 413, { error: 'evidence bundle too large' });
  audit(taskId, 'administrator', 'evidence.exported', { format });
  if (format === 'json') return writeJson(res, 200, JSON.parse(bundle), { 'content-disposition': `attachment; filename="${taskId}-evidence.json"` });
  res.writeHead(200, { 'content-type': 'text/markdown', 'content-disposition': `attachment; filename="${taskId}-evidence.md"` });
  return res.end(`# Task Evidence ${taskId}\n\n\`\`\`json\n${bundle}\n\`\`\`\n`);
}

async function telegramWebhook(req, res) {
  if (process.env.TELEGRAM_WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== process.env.TELEGRAM_WEBHOOK_SECRET) return json(res, 401, { error: 'invalid telegram secret' });
  const body = await readJson(req);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
  setTimeout(() => handleTelegramUpdate(body), 0).unref();
}

function checkLimit(req, bucket, limit, windowMs) { const result = rateLimit(`${bucket}:${ip(req)}`, { limit, windowMs }); if (!result.allowed) audit(null, 'rate-limit', 'rate_limit.exceeded', { bucket, ip: ip(req) }); return result; }
function limited(res, limit) { res.setHeader('retry-after', String(limit.retryAfter)); return json(res, 429, { error: 'rate limit exceeded', retryAfter: limit.retryAfter }); }
function ip(req) { return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'local'; }
function isStateChanging(req) { return !['GET', 'HEAD', 'OPTIONS'].includes(req.method); }
function setSecurityHeaders(req, res) { res.setHeader('x-frame-options', 'DENY'); res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('referrer-policy', 'no-referrer'); res.setHeader('permissions-policy', 'microphone=(self), camera=(), geolocation=()'); res.setHeader('cache-control', req.url?.startsWith('/api/') ? 'no-store' : 'no-cache'); if (process.env.NODE_ENV === 'production') res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains'); const inline = process.env.NODE_ENV === 'production' ? '' : " 'unsafe-inline'"; res.setHeader('content-security-policy', `default-src 'self'; script-src 'self'${inline}; style-src 'self'${inline}; connect-src 'self'; img-src 'self' data:`); }
function serve(res, file, type) { res.writeHead(200, { 'content-type': type }); fs.createReadStream(path.resolve(file)).pipe(res); }
export function start(port = PORT) { return http.createServer(route).listen(port, () => console.log(JSON.stringify({ service: 'api', port }))); }
if (import.meta.url === `file://${process.argv[1]}`) start();
