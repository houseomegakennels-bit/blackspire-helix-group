import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { PORT, ADMIN_TOKEN, NODE_ENV } from '../../packages/shared/config.js';
import { json, readJson, id } from '../../packages/shared/util.js';
import { createTask, getTask, listTasks, logs, transition, setFlag, getFlag, audit, decideApproval } from '../../packages/task-engine/tasks.js';
import { listWorkspaces } from '../../packages/workspace-registry/workspaces.js';
import { activeModes } from '../../packages/providers/providers.js';
import { createSession, lookupSession, revokeSession, revokeAll, rotateSession, sessionCookies, clearCookies, parseCookies, requireCsrf, clientIp, assertProductionSafe } from '../../packages/security/session-store.js';
import { checkRateLimit } from '../../packages/security/rate-limit.js';
import { exportEvidence } from '../../packages/evidence/export.js';

let emergencyStopMemory = false;

function isPublicAsset(url = '') {
  return url === '/health' || url === '/ready' || url === '/' || url === '/jarvis' || url.startsWith('/manifest') || url.startsWith('/sw.js');
}

function getSession(req) { return lookupSession(parseCookies(req.headers.cookie || '')['__Host-bsc_session']); }
function auth(req) {
  if (isPublicAsset(req.url) || req.url === '/api/login') return true;
  const session = getSession(req);
  if (session && requireCsrf(req, session)) return true;
  return NODE_ENV !== 'production' && req.headers.authorization === `Bearer ${ADMIN_TOKEN}`;
}

async function route(req, res) {
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:");
  const ip = clientIp(req);
  const apiLimit = checkRateLimit({ scope: 'api', key: ip, limit: 1000, windowMs: 60000 });
  if (!apiLimit.allowed) return json(res, 429, { error: 'rate limit exceeded' });
  if (!auth(req)) return json(res, 401, { error: 'unauthorized' });

  const u = new URL(req.url, `http://${req.headers.host}`);
  try {
    
    if (u.pathname === '/api/login' && req.method === 'POST') {
      const loginLimit = checkRateLimit({ scope: 'login', key: ip, limit: 10, windowMs: 60000 });
      if (!loginLimit.allowed) return json(res, 429, { error: 'login rate limit exceeded' });
      const body = await readJson(req);
      if (body.adminToken !== ADMIN_TOKEN) return json(res, 401, { error: 'invalid credentials' });
      const session = createSession({ ip, userAgent: req.headers['user-agent'] || '' });
      res.setHeader('set-cookie', sessionCookies(session));
      res.setHeader('cache-control', 'no-store');
      return json(res, 200, { ok: true, csrfToken: session.csrfToken, expiresAt: session.expiresAt });
    }
    if (u.pathname === '/api/session' && req.method === 'GET') {
      const session = getSession(req);
      res.setHeader('cache-control', 'no-store');
      return json(res, 200, { authenticated: Boolean(session), csrfToken: session?.csrf_token, expiresAt: session?.expires_at });
    }
    if (u.pathname === '/api/session/rotate' && req.method === 'POST') {
      const current = getSession(req);
      if (!current) return json(res, 401, { error: 'unauthorized' });
      const session = rotateSession(current.id, { ip, userAgent: req.headers['user-agent'] || '' });
      res.setHeader('set-cookie', sessionCookies(session));
      res.setHeader('cache-control', 'no-store');
      return json(res, 200, { ok: true, csrfToken: session.csrfToken });
    }
    if (u.pathname === '/api/logout' && req.method === 'POST') {
      const current = getSession(req);
      if (current) revokeSession(current.id);
      res.setHeader('set-cookie', clearCookies());
      res.setHeader('cache-control', 'no-store');
      return json(res, 200, { ok: true });
    }
    if (u.pathname === '/api/session/revoke_all' && req.method === 'POST') {
      revokeAll('admin');
      res.setHeader('set-cookie', clearCookies());
      res.setHeader('cache-control', 'no-store');
      return json(res, 200, { ok: true });
    }
    if (u.pathname === '/health') return json(res, 200, { ok: true, service: 'blackspire-command-api', emergencyStop: getFlag('emergency_stop') === 'active' || emergencyStopMemory });
    if (u.pathname === '/ready') return json(res, 200, { ok: true, providers: activeModes() });
    if (u.pathname === '/api/workspaces') return json(res, 200, { workspaces: listWorkspaces() });
    if (u.pathname === '/api/tasks' && req.method === 'GET') return json(res, 200, { tasks: listTasks() });
    if (u.pathname === '/api/tasks' && req.method === 'POST') {
      if (emergencyStopMemory || getFlag('emergency_stop') === 'active') return json(res, 423, { error: 'emergency stop active' });
      const body = await readJson(req);
      const request = String(body.request || '').trim();
      if (!request || request.length > 4000) return json(res, 422, { error: 'request is required and must be under 4000 characters' });
      const task = createTask({ workspaceId: body.workspaceId || 'blackspire-command', request, idempotencyKey: body.idempotencyKey || id('idem') });
      return json(res, 202, { task });
    }

    
    const ev = u.pathname.match(/^\/api\/tasks\/([^/]+)\/(evidence\.json|evidence\.md)$/);
    if (ev) {
      const exported = exportEvidence(ev[1], ev[2].endsWith('.md') ? 'md' : 'json');
      if (!exported) return json(res, 404, { error: 'not found' });
      res.writeHead(200, { 'content-type': exported.contentType, 'content-disposition': `attachment; filename="${exported.filename.replace(/[^a-zA-Z0-9_.-]/g,'_')}"`, 'cache-control': 'no-store' });
      return res.end(exported.content);
    }
    const match = u.pathname.match(/^\/api\/tasks\/([^/]+)(?:\/(logs|approve|reject|pause|resume|cancel))?$/);
    if (match) {
      const task = getTask(match[1]);
      if (!task) return json(res, 404, { error: 'not found' });
      if (!match[2]) return json(res, 200, { task });
      if (match[2] === 'logs') return json(res, 200, { logs: logs(task.id) });
      if (match[2] === 'approve') { decideApproval(task.id, 'approved', 'Approved by administrator'); return json(res, 200, { task: transition(task.id, 'queued', { summary: 'Approved by administrator' }) }); }
      if (match[2] === 'reject') { decideApproval(task.id, 'rejected', 'Rejected by administrator'); return json(res, 200, { task: transition(task.id, 'cancelled', { error: 'Rejected by administrator' }) }); }
      if (match[2] === 'pause') return json(res, 200, { task: transition(task.id, 'waiting_for_approval', { summary: 'Paused by administrator' }) });
      if (match[2] === 'resume') return json(res, 200, { task: transition(task.id, 'queued') });
      if (match[2] === 'cancel') return json(res, 200, { task: transition(task.id, 'cancelled', { error: 'Cancelled by administrator' }) });
    }

    if (u.pathname === '/api/stop' && req.method === 'POST') {
      emergencyStopMemory = true;
      setFlag('emergency_stop', 'active');
      audit(null, 'administrator', 'emergency_stop.activated');
      return json(res, 200, { ok: true, emergencyStop: true });
    }
    if (u.pathname === '/api/stop/reset' && req.method === 'POST') {
      emergencyStopMemory = false;
      setFlag('emergency_stop', 'inactive');
      audit(null, 'administrator', 'emergency_stop.reset');
      return json(res, 200, { ok: true, emergencyStop: false });
    }

    if (u.pathname === '/' || u.pathname === '/jarvis') return serve(res, 'apps/jarvis-pwa/public/index.html', 'text/html');
    if (u.pathname === '/manifest.webmanifest') return serve(res, 'apps/jarvis-pwa/public/manifest.webmanifest', 'application/manifest+json');
    if (u.pathname === '/sw.js') return serve(res, 'apps/jarvis-pwa/public/sw.js', 'text/javascript');
    return json(res, 404, { error: 'not found' });
  } catch {
    return json(res, 500, { error: 'internal error' });
  }
}

function serve(res, file, type) {
  res.writeHead(200, { 'content-type': type });
  fs.createReadStream(path.resolve(file)).pipe(res);
}

export function start(port = PORT) {
  const startup = assertProductionSafe();
  if (!startup.ok) throw new Error(`Unsafe production configuration: ${startup.failures.join(', ')}`);
  return http.createServer(route).listen(port, () => console.log(JSON.stringify({ service: 'api', port })));
}

if (import.meta.url === `file://${process.argv[1]}`) start();
