import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ADMIN_TOKEN, ALLOW_BEARER_AUTH } from '../../packages/shared/config.js';
import { buildRuntimeStatus as buildHermesRuntimeStatus } from '../../packages/hermes-orchestrator/status.js';
import { resolveBindTarget } from '../../packages/shared/bind.js';
import { json, readJson, id, redact } from '../../packages/shared/util.js';
import { createTask, getTask, listTasks, logs, transition, setFlag, getFlag, audit, createApproval, decideApproval, taskRecords } from '../../packages/task-engine/tasks.js';
import { attachmentsForTask } from '../../packages/task-engine/attachments.js';
import { listWorkspaces, getWorkspace, upsertWorkspace } from '../../packages/workspace-registry/workspaces.js';
import { activeModes } from '../../packages/providers/providers.js';
import { handleTelegramUpdate, dispatchReply } from '../telegram/bot.js';
import { createSession, getSession, rotateSession, destroySession, revokeAllSessions, cleanupExpiredSessions, parseCookies, sessionCookie, clearSessionCookies, checkCsrf, rateLimit, safeError, requireProductionSafeConfig } from '../../packages/shared/security.js';
import { clientIp } from '../../packages/shared/net.js';
import { cleanupRateLimits } from '../../packages/shared/rateLimits.js';
import { createUnifiedInput, getConversation, requestCancellation } from '../../packages/unified-input/unified.js';
import { conversationEvents } from '../../packages/task-engine/tasks.js';
import { requireSafeTestMode, isSameOrigin, testModeAllowsRequest, publicTestModeStatus } from '../../packages/shared/testMode.js';
import { evaluateRequestPolicy } from '../../packages/policy/policy.js';
import { assertSchemaCompatible, closeDb } from '../../packages/task-engine/db.js';
import { resolveAdminBearer, resolveBoundSession } from '../../packages/shared/authorization.js';
import { readOutcomeEvaluation } from '../../packages/hermes-orchestrator/outcome.js';
import { readVerifiedScorecard } from '../../packages/hermes-orchestrator/scorecard.js';
import { readMemoryCandidateReview, readMemoryCandidateRereview, listMemoryCandidateReviewQueue } from '../../packages/hermes-orchestrator/memory-review.js';
import { createDeploymentIdentityProvider, serializeDeploymentIdentity, validateDeploymentIdentityForStartup } from '../../packages/shared/deployment-identity.js';
import { schedulerRuntimeStatus, workerRuntimeStatus } from '../../packages/task-engine/runtime-status.js';

let emergencyStopMemory = false;
let lifecyclePhase = 'starting';
let startupConfigValidation = { ok: false };
const deploymentIdentityProvider = createDeploymentIdentityProvider();
const TEST_MODE = requireSafeTestMode();

// Exact-match allowlist of publicly servable frontend assets. Lookup is by literal
// pathname key only: no path segment from the request ever reaches the filesystem, so
// traversal is not possible. Add an entry here to expose a new asset; nothing else.
const PUBLIC_ASSETS = {
  '/manifest.webmanifest': { file: 'apps/jarvis-pwa/public/manifest.webmanifest', type: 'application/manifest+json; charset=utf-8', immutable: false },
  '/sw.js': { file: 'apps/jarvis-pwa/public/sw.js', type: 'text/javascript; charset=utf-8', immutable: false },
  // The three assets below are the externalized Jarvis shell: index.html carries no inline
  // script or style, so the sign-in view cannot render without them and they must resolve
  // before authentication. They ship on the Jarvis UI branch; until that branch lands these
  // routes answer 404 rather than serving a truncated shell.
  '/jarvis.css': { file: 'apps/jarvis-pwa/public/jarvis.css', type: 'text/css; charset=utf-8', immutable: false },
  '/jarvis.js': { file: 'apps/jarvis-pwa/public/jarvis.js', type: 'text/javascript; charset=utf-8', immutable: false },
  '/helix-core.js': { file: 'apps/jarvis-pwa/public/helix-core.js', type: 'text/javascript; charset=utf-8', immutable: true },
  '/hermes-runtime.css': { file: 'apps/jarvis-pwa/public/hermes-runtime.css', type: 'text/css; charset=utf-8', immutable: false },
  '/hermes-runtime.js': { file: 'apps/jarvis-pwa/public/hermes-runtime.js', type: 'text/javascript; charset=utf-8', immutable: false },
};

// Assets are matched on the normalized pathname alone so cache-busting query strings
// (/jarvis.css?v=2) resolve before login. Every other public route keeps its existing
// whole-URL comparison, so this widens nothing beyond the asset allowlist itself.
function isPublicAsset(url = '', pathname = '') {
  return url === '/health' || url === '/ready' || url === '/' || url === '/jarvis' || url === '/hermes-runtime' || Object.hasOwn(PUBLIC_ASSETS, pathname) || url === '/api/auth/login' || url === '/api/auth/session';
}

function authContext(req) {
  if (ALLOW_BEARER_AUTH && req.headers.authorization === `Bearer ${ADMIN_TOKEN}`) return { ok: true, mode: 'bearer', session: null };
  const session = getSession(parseCookies(req.headers.cookie || '').bc_session);
  if (session && TEST_MODE.enabled && !testModeActive()) return { ok: false, mode: 'none', session: null };
  if (session) return { ok: true, mode: 'session', session };
  return { ok: false, mode: 'none', session: null };
}

function writeJson(res, status, body, headers = {}) {
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
  return json(res, status, body);
}

async function route(req, res) {
  setSecurityHeaders(req, res);
  // A malformed request line must not reach routing: reject it before any lookup rather
  // than throwing past the handler below.
  let u;
  try {
    u = new URL(req.url, `http://${req.headers.host}`);
  } catch {
    return json(res, 400, { error: 'bad request' });
  }
  try {
    if (u.pathname === '/api/test-mode' && req.method === 'GET') return json(res, 200, publicTestModeStatus(TEST_MODE));
    if (u.pathname === '/api/test-mode/session' && req.method === 'POST') return testModeLogin(req, res);
    if (TEST_MODE.enabled && (u.pathname === '/api/auth/login' || u.pathname === '/telegram/webhook')) return json(res, 404, { error: 'not found' });
    if (u.pathname === '/api/auth/login' && req.method === 'POST') return login(req, res);
    if (u.pathname === '/telegram/webhook' && req.method === 'POST') return telegramWebhook(req, res);

    const auth = authContext(req);
    if (!isPublicAsset(req.url, u.pathname) && !auth.ok) return json(res, 401, { error: 'unauthorized' });
    if (isStateChanging(req) && auth.mode === 'session' && !checkCsrf(req, auth.session)) return json(res, 403, { error: 'invalid csrf token' });
    if (TEST_MODE.enabled && !testModeAllowsRequest(u.pathname, req.method)) return json(res, 404, { error: 'not found' });

    if (u.pathname === '/api/auth/session') return json(res, 200, { authenticated: auth.ok, csrfToken: auth.session?.csrfToken, expiresAt: auth.session?.expiresAt });
    if (u.pathname === '/api/auth/logout' && req.method === 'POST') { if (auth.session) destroySession(auth.session.sessionId); return writeJson(res, 200, { ok: true }, { 'set-cookie': clearSessionCookies() }); }
    if (u.pathname === '/api/auth/rotate' && req.method === 'POST') {
      if (auth.mode !== 'session') return json(res, 401, { error: 'session required' });
      const rotated = rotateSession(auth.session.sessionId);
      if (!rotated) return json(res, 401, { error: 'session expired' });
      audit(null, 'auth', 'session.rotated', { ip: clientIp(req) });
      return writeJson(res, 200, { ok: true, csrfToken: rotated.csrfToken, expiresAt: rotated.expiresAt }, { 'set-cookie': sessionCookie(rotated) });
    }
    if (u.pathname === '/api/auth/revoke-all' && req.method === 'POST') { revokeAllSessions(); audit(null, 'administrator', 'sessions.revoked'); return writeJson(res, 200, { ok: true }, { 'set-cookie': clearSessionCookies() }); }
    if (u.pathname === '/health') return json(res, 200, healthSnapshot());
    if (u.pathname === '/ready') {
      const readiness = readinessSnapshot();
      return json(res, readiness.ok ? 200 : 503, readiness);
    }
    if (u.pathname === '/api/test-mode/telegram-input' && req.method === 'POST') return testTelegramInput(req, res);
    if (u.pathname === '/api/test-mode/queued-task' && req.method === 'POST') return testQueuedTask(req, res);
    if (u.pathname === '/api/test-mode/delivery-failure' && req.method === 'POST') return testDeliveryFailure(req, res);
    if (u.pathname === '/api/hermes/runtime' && req.method === 'GET') return json(res, 200, buildHermesRuntimeStatus());
    const evaluationMatch = u.pathname.match(/^\/api\/hermes\/evaluations\/([A-Za-z0-9._:-]{1,128})$/);
    if (evaluationMatch && req.method === 'GET') return outcomeEvaluationRoute(res, auth, evaluationMatch[1]);
    const scorecardMatch = u.pathname.match(/^\/api\/hermes\/scorecards\/([A-Za-z0-9._:-]{1,128})$/);
    if (scorecardMatch && req.method === 'GET') return verifiedScorecardRoute(res, auth, scorecardMatch[1]);
    const memoryReviewMatch = u.pathname.match(/^\/api\/hermes\/memory-candidate-reviews\/([A-Za-z0-9._:-]{1,128})$/);
    if (memoryReviewMatch && req.method === 'GET') return memoryCandidateReviewRoute(res, auth, memoryReviewMatch[1]);
    const memoryRereviewMatch = u.pathname.match(/^\/api\/hermes\/memory-candidate-rereviews\/([A-Za-z0-9._:-]{1,128})$/);
    if (memoryRereviewMatch && req.method === 'GET') return memoryCandidateRereviewRoute(res, auth, memoryRereviewMatch[1]);
    const memoryQueueMatch = u.pathname.match(/^\/api\/hermes\/workspaces\/([A-Za-z0-9._:-]{1,128})\/memory-candidate-review-queue$/);
    if (memoryQueueMatch && req.method === 'GET') return memoryCandidateReviewQueueRoute(req, res, auth, u, memoryQueueMatch[1]);
    if (u.pathname === '/api/workspaces') return json(res, 200, { workspaces: TEST_MODE.enabled ? [getWorkspace(TEST_MODE.workspaceId)] : listWorkspaces() });
    if (u.pathname === '/api/tasks' && req.method === 'GET') return json(res, 200, { tasks: listTasks().filter((task) => !TEST_MODE.enabled || task.workspace_id === TEST_MODE.workspaceId) });
    if (u.pathname === '/api/tasks' && req.method === 'POST') return createTaskRoute(req, res);
    if (u.pathname === '/api/unified-input' && req.method === 'POST') return unifiedInputRoute(req, res, auth);

    const conversationMatch = u.pathname.match(/^\/api\/conversations\/([^/]+)(?:\/(events))?$/);
    if (conversationMatch && req.method === 'GET') {
      const conversation = getConversation(conversationMatch[1]);
      if (!conversation) return json(res, 404, { error: 'conversation not found' });
      if (TEST_MODE.enabled && conversation.conversation.workspace_id !== TEST_MODE.workspaceId) return json(res, 404, { error: 'conversation not found' });
      if (conversationMatch[2] === 'events') return json(res, 200, { conversationId: conversationMatch[1], events: conversationEvents(conversationMatch[1], u.searchParams.get('after') || '') });
      return json(res, 200, conversation);
    }

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

    if (u.pathname === '/' || u.pathname === '/jarvis') return serve(res, TEST_MODE.enabled ? 'apps/jarvis-pwa/public/test-mode.html' : 'apps/jarvis-pwa/public/index.html', 'text/html');
    if (u.pathname === '/hermes-runtime') return serve(res, 'apps/jarvis-pwa/public/hermes-runtime.html', 'text/html');
    if (Object.hasOwn(PUBLIC_ASSETS, u.pathname)) {
      const asset = PUBLIC_ASSETS[u.pathname];
      return serve(res, asset.file, asset.type, asset.immutable ? 'public, max-age=31536000, immutable' : undefined);
    }
    return json(res, 404, { error: 'not found' });
  } catch (error) {
    return json(res, 500, { error: safeError(error) });
  }
}

// This is intentionally narrower than the legacy API authentication: a session is not a
// canonical principal, and a request cannot nominate one.  A deployment must explicitly map its
// already-authenticated administrator bearer path to an existing canonical admin principal.
function configuredEvaluationAdminPrincipal() {
  const configuredPrincipalId = process.env.BLACKSPIRE_EVALUATION_ADMIN_PRINCIPAL_ID;
  return typeof configuredPrincipalId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(configuredPrincipalId)
    ? resolveAdminBearer(configuredPrincipalId) : null;
}

function outcomeEvaluationRoute(res, auth, evaluationId) {
  const configuredPrincipal = configuredEvaluationAdminPrincipal();
  const principal = auth.mode === 'bearer' ? configuredPrincipal : auth.mode === 'session' ? resolveBoundSession(auth.session) : null;
  // A session can use this read surface only when the server bound it to the configured admin
  // principal at login.  A browser cannot nominate a different principal or workspace.
  if (!configuredPrincipal || !principal || principal.principalId !== configuredPrincipal.principalId) return json(res, 403, { error: 'evaluation authorization unavailable' });
  const evaluation = principal && readOutcomeEvaluation(principal, evaluationId);
  // Do not distinguish a guessed identifier from a cross-workspace object.
  return evaluation ? json(res, 200, { evaluation }) : json(res, 404, { error: 'evaluation not found' });
}

// Milestone 3B read surface. It is GET-only and reuses the evaluation principal binding and the
// canonical `evaluation.read` permission unchanged: there is no scorecard-specific permission, no
// caller-supplied workspace, and deliberately no route that derives or mutates a scorecard.
function verifiedScorecardRoute(res, auth, scorecardId) {
  const configuredPrincipal = configuredEvaluationAdminPrincipal();
  const principal = auth.mode === 'bearer' ? configuredPrincipal : auth.mode === 'session' ? resolveBoundSession(auth.session) : null;
  if (!configuredPrincipal || !principal || principal.principalId !== configuredPrincipal.principalId) return json(res, 403, { error: 'evaluation authorization unavailable' });
  const scorecard = principal && readVerifiedScorecard(principal, scorecardId);
  // Do not distinguish a guessed identifier from a cross-workspace object.
  return scorecard ? json(res, 200, { scorecard }) : json(res, 404, { error: 'scorecard not found' });
}

// Milestone 3C read surface. GET-only and byte-parallel to the 3B route above: the same evaluation
// principal binding, the same canonical `evaluation.read` permission, no review-specific permission,
// no caller-supplied workspace, and deliberately no route that records, mutates, or promotes
// anything. Recording a review is an internal service call only in `m3c-v1`.
function memoryCandidateReviewRoute(res, auth, reviewId) {
  const configuredPrincipal = configuredEvaluationAdminPrincipal();
  const principal = auth.mode === 'bearer' ? configuredPrincipal : auth.mode === 'session' ? resolveBoundSession(auth.session) : null;
  if (!configuredPrincipal || !principal || principal.principalId !== configuredPrincipal.principalId) return json(res, 403, { error: 'evaluation authorization unavailable' });
  const review = principal && readMemoryCandidateReview(principal, reviewId);
  // Do not distinguish a guessed identifier from a cross-workspace object.
  return review ? json(res, 200, { review }) : json(res, 404, { error: 'memory candidate review not found' });
}

// Read surface for a re-review successor. Byte-parallel to the route above in every respect: GET
// only, the same evaluation principal binding, the same canonical `evaluation.read` permission, no
// caller-supplied workspace, and still no route anywhere that records, mutates, or promotes.
// Appending a successor remains an internal service call with no HTTP surface.
function memoryCandidateRereviewRoute(res, auth, rereviewId) {
  const configuredPrincipal = configuredEvaluationAdminPrincipal();
  const principal = auth.mode === 'bearer' ? configuredPrincipal : auth.mode === 'session' ? resolveBoundSession(auth.session) : null;
  if (!configuredPrincipal || !principal || principal.principalId !== configuredPrincipal.principalId) return json(res, 403, { error: 'evaluation authorization unavailable' });
  const rereview = principal && readMemoryCandidateRereview(principal, rereviewId);
  // Do not distinguish a guessed identifier from a cross-workspace object.
  return rereview ? json(res, 200, { rereview }) : json(res, 404, { error: 'memory candidate re-review not found' });
}

// Read-only, bounded workspace queue. The path workspace is syntax only until the service decides
// canonical `evaluation.read`; no candidate count, existence check, or review read occurs first.
function memoryCandidateReviewQueueRoute(req, res, auth, url, workspaceId) {
  const configuredPrincipal = configuredEvaluationAdminPrincipal();
  const principal = auth.mode === 'bearer' ? configuredPrincipal : auth.mode === 'session' ? resolveBoundSession(auth.session) : null;
  if (!configuredPrincipal || !principal || principal.principalId !== configuredPrincipal.principalId) {
    return json(res, 403, { error: 'evaluation authorization unavailable' });
  }
  for (const key of ['limit', 'cursor', 'reviewState']) {
    if (url.searchParams.getAll(key).length > 1) return json(res, 400, { error: 'invalid memory candidate review queue request' });
  }
  const rawLimit = url.searchParams.get('limit');
  const limit = rawLimit === null ? 20 : (/^(?:[1-9]|[1-4][0-9]|50)$/.test(rawLimit) ? Number(rawLimit) : Number.NaN);
  const cursor = url.searchParams.get('cursor');
  const reviewState = url.searchParams.get('reviewState') ?? 'all';
  const rate = checkLimit(req, 'memory-review-queue', 30, 60000);
  if (!rate.allowed) return limited(res, rate);
  try {
    const queue = listMemoryCandidateReviewQueue(principal, workspaceId, { limit, cursor, reviewState });
    if (!queue) return json(res, 404, { error: 'memory candidate review queue not found' });
    return json(res, 200, { queue });
  } catch (error) {
    if (/integrity conflict/.test(String(error?.message || ''))) {
      return json(res, 409, { error: 'memory candidate review queue integrity conflict' });
    }
    if (/memory candidate review queue requires/.test(String(error?.message || ''))) {
      return json(res, 400, { error: 'invalid memory candidate review queue request' });
    }
    throw error;
  }
}

async function login(req, res) {
  const limit = checkLimit(req, 'login', Number(process.env.LOGIN_RATE_LIMIT || 5), 60000); if (!limit.allowed) return limited(res, limit);
  const body = await readJson(req);
  const session = createSession(body.adminToken, { ip: clientIp(req), userAgent: req.headers['user-agent'] || '', principalId: configuredEvaluationAdminPrincipal()?.principalId || null });
  if (!session) { audit(null, 'auth', 'login.failed', { ip: clientIp(req) }); return json(res, 401, { error: 'invalid credentials' }); }
  audit(null, 'auth', 'login.succeeded', { ip: clientIp(req) });
  return writeJson(res, 200, { ok: true, csrfToken: session.csrfToken, expiresAt: session.expiresAt }, { 'set-cookie': sessionCookie(session) });
}

async function testModeLogin(req, res) {
  if (!TEST_MODE.enabled || !TEST_MODE.ok || !testModeActive() || !isSameOrigin(req)) return json(res, 404, { error: 'not found' });
  const limit = checkLimit(req, 'test-login', 10, 60000); if (!limit.allowed) return limited(res, limit);
  const body = await readJson(req);
  const supplied = Buffer.from(String(body.accessCode || ''));
  const expected = Buffer.from(String(process.env.UNIFIED_TEST_ACCESS_CODE || ''));
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    audit(null, 'test-mode', 'session.denied', { actor: TEST_MODE.testActor });
    return json(res, 404, { error: 'test session unavailable' });
  }
  const session = createSession(ADMIN_TOKEN, { ip: clientIp(req), userAgent: req.headers['user-agent'] || '', principalId: configuredEvaluationAdminPrincipal()?.principalId || null, maxExpiresAt: Date.parse(TEST_MODE.expiresAt) });
  if (!session) return json(res, 503, { error: 'test session unavailable' });
  audit(null, 'test-mode', 'session.created', { actor: TEST_MODE.testActor });
  return writeJson(res, 200, { ok: true, csrfToken: session.csrfToken, expiresAt: Math.min(session.expiresAt, Date.parse(TEST_MODE.expiresAt)) }, { 'set-cookie': sessionCookie(session, { secure: true }) });
}
function testModeActive() { return Number.isFinite(Date.parse(TEST_MODE.expiresAt)) && Date.now() < Date.parse(TEST_MODE.expiresAt); }

async function testTelegramInput(req, res) {
  const body = await readJson(req);
  const updateId = String(body.updateId || '').trim();
  if (!updateId || updateId.length > 120) return json(res, 422, { error: 'updateId is required' });
  const result = createUnifiedInput({ channel: 'telegram', actorId: TEST_MODE.testActor, channelKey: TEST_MODE.channelKey, conversationId: body.conversationId || null, workspaceId: TEST_MODE.workspaceId, text: body.text, idempotencyKey: `test-telegram:${updateId}`, metadata: { testMode: true }, authority: 'test_operator' });
  return json(res, result.status && result.status >= 400 ? result.status : (result.denied ? 403 : 202), result);
}

async function testQueuedTask(req, res) {
  const body = await readJson(req);
  setFlag('test_worker_hold', 'active');
  const result = createUnifiedInput({ channel: 'jarvis', actorId: TEST_MODE.testActor, channelKey: `test-session:${TEST_MODE.testActor}`, conversationId: body.conversationId || null, workspaceId: TEST_MODE.workspaceId, text: 'Report queued task status without changing files.', idempotencyKey: body.idempotencyKey || id('test-held'), authority: 'test_operator' });
  if (result.taskId) audit(result.taskId, 'test-mode', 'task.held', { reason: 'eligible cancellation fixture' });
  return json(res, 202, { ...result, task: result.taskId ? getTask(result.taskId) : null });
}

async function testDeliveryFailure(req, res) {
  const body = await readJson(req);
  const requested = Number(body.attempts || 1);
  if (!Number.isInteger(requested)) return json(res, 422, { error: 'attempts must be an integer from 1 to 3' });
  const attempts = Math.max(1, Math.min(3, requested));
  setFlag('test_mock_delivery_failures', String(attempts));
  return json(res, 200, { ok: true, failuresRemaining: attempts });
}

async function createTaskRoute(req, res) {
  const limit = checkLimit(req, 'task-create', Number(process.env.TASK_RATE_LIMIT || 20), 60000); if (!limit.allowed) return limited(res, limit);
  if (emergencyStopMemory || getFlag('emergency_stop') === 'active') return json(res, 423, { error: 'emergency stop active' });
  const body = await readJson(req);
  const request = String(body.request || '').trim();
  if (!request || request.length > 4000) return json(res, 422, { error: 'request is required and must be under 4000 characters' });
  const decision = evaluateRequestPolicy({ request, channel: 'api', authority: 'authenticated_admin' });
  const task = createTask({ workspaceId: body.workspaceId || 'blackspire-command', request, idempotencyKey: body.idempotencyKey || id('idem'), sourceChannel: 'api', actionClass: decision.actionClass, authorityClass: 'authenticated_admin', policyDecision: decision.allowed ? (decision.requiresApproval ? 'approval_required' : 'allowed') : 'denied', initialStatus: decision.allowed ? 'queued' : 'failed', initialError: decision.allowed ? null : decision.reason, initialSummary: decision.allowed ? null : 'Denied by Blackspire policy', initialEventType: decision.allowed ? 'task.queued' : 'policy.denied', initialEventPayload: decision.allowed ? {} : { reason: decision.reason } });
  return json(res, decision.allowed ? 202 : 403, decision.allowed ? { task } : { task, denied: true, error: decision.reason });
}

async function unifiedInputRoute(req, res, auth) {
  const limit = checkLimit(req, 'unified-input', Number(process.env.TASK_RATE_LIMIT || 20), 60000); if (!limit.allowed) return limited(res, limit);
  const body = await readJson(req);
  const result = createUnifiedInput({
    channel: TEST_MODE.enabled ? 'jarvis' : (body.channel === 'api' ? 'api' : 'jarvis'),
    actorId: TEST_MODE.enabled ? TEST_MODE.testActor : (auth.session?.sessionId || auth.mode),
    channelKey: TEST_MODE.enabled ? `test-session:${TEST_MODE.testActor}` : (body.channelKey || auth.session?.sessionId || `bearer:${clientIp(req)}`),
    conversationId: body.conversationId || null,
    workspaceId: TEST_MODE.enabled ? TEST_MODE.workspaceId : (body.workspaceId || 'blackspire-command'),
    text: body.text || body.request,
    idempotencyKey: body.idempotencyKey || id('idem'),
    authority: TEST_MODE.enabled ? 'test_operator' : 'authenticated_admin',
  });
  return json(res, result.status && result.status >= 400 ? result.status : (result.denied ? 403 : 202), result);
}

function taskRoute(req, res, match) {
  const task = getTask(match[1]);
  if (!task) return json(res, 404, { error: 'not found' });
  if (TEST_MODE.enabled && task.workspace_id !== TEST_MODE.workspaceId) return json(res, 404, { error: 'not found' });
  if (!match[2]) return json(res, 200, { task });
  if (match[2] === 'logs') return json(res, 200, { logs: logs(task.id) });
  if (match[2] === 'approvals') return json(res, 200, { approvals: taskRecords(task.id).approvals });
  const limit = checkLimit(req, 'approval-action', 20, 60000); if (!limit.allowed) return limited(res, limit);
  if (match[2] === 'approve') {
    if (task.policy_decision === 'denied' || task.source_channel === 'telegram' || ['telegram', 'test_operator', 'untrusted'].includes(task.authority_class)) return json(res, 403, { error: 'task authority cannot be elevated by approval' });
    if (!taskRecords(task.id).approvals.some((approval) => approval.status === 'pending') && task.policy_decision === 'approval_required') createApproval(task.id, 'high_risk_execution', 'High-impact task requires administrator approval before execution', { requestedBy: 'api' });
    const decision = decideApproval(task.id, 'approved', 'Approved by administrator');
    if (decision === 'expired') return json(res, 409, { error: 'approval expired' });
    return json(res, 200, { task: transition(task.id, 'queued', { summary: 'Approved by administrator' }) });
  }
  if (match[2] === 'reject') { decideApproval(task.id, 'rejected', 'Rejected by administrator'); return json(res, 200, { task: transition(task.id, 'cancelled', { error: 'Rejected by administrator' }) }); }
  if (match[2] === 'pause') {
    if (task.policy_decision === 'denied' || task.source_channel === 'telegram' || ['telegram', 'test_operator', 'untrusted'].includes(task.authority_class)) return json(res, 403, { error: 'task authority cannot be elevated by pause' });
    return json(res, 200, { task: transition(task.id, 'waiting_for_approval', { summary: 'Paused by administrator' }) });
  }
  if (match[2] === 'resume') {
    if (task.policy_decision === 'denied' || task.source_channel === 'telegram' || ['telegram', 'test_operator', 'untrusted'].includes(task.authority_class)) return json(res, 403, { error: 'task authority cannot be elevated by resume' });
    return json(res, 200, { task: transition(task.id, 'queued') });
  }
  if (match[2] === 'cancel') {
    const result = requestCancellation(task.id, { actor: TEST_MODE.enabled ? TEST_MODE.testActor : 'administrator' });
    if (TEST_MODE.enabled) setFlag('test_worker_hold', 'inactive');
    return json(res, 200, result);
  }
  return json(res, 404, { error: 'not found' });
}

function buildEvidenceBundle(taskId) {
  const task = getTask(taskId);
  if (!task) return null;
  const records = taskRecords(taskId);
  const finalEvidence = records.evidence.find((entry) => entry.kind === 'final');
  const finalDetails = finalEvidence ? JSON.parse(finalEvidence.details || '{}') : {};
  // Explicit top-level keys (in this fixed order) so every export has the same stable shape, with
  // branch/commit/PR-or-manual-handoff pulled up from the buried "final" evidence record for easy reading.
  return {
    taskId: task.id,
    taskRequest: task.request,
    status: task.status,
    workspace: getWorkspace(task.workspace_id),
    plan: task.plan ? JSON.parse(task.plan) : null,
    subtasks: records.subtasks,
    providerAttempts: records.providerAttempts,
    usage: records.usage,
    approvalHistory: records.approvals,
    changedFiles: records.changedFiles,
    commandResults: records.commands,
    logs: records.logs,
    attachments: attachmentsForTask(taskId),
    branch: finalDetails.branch?.branch || finalDetails.branch || null,
    commit: finalDetails.commit || null,
    pullRequestOrManualHandoff: finalDetails.pullRequest || null,
    finalEvidence: records.evidence,
    task,
  };
}

function exportTask(res, taskId, format) {
  const bundle = buildEvidenceBundle(taskId);
  if (!bundle) return json(res, 404, { error: 'task not found' });
  const redacted = redact(JSON.stringify(bundle, null, 2));
  if (redacted.length > Number(process.env.EVIDENCE_BUNDLE_MAX_BYTES || 500000)) return json(res, 413, { error: 'evidence bundle too large' });
  audit(taskId, 'administrator', 'evidence.exported', { format });
  const safeName = String(taskId).replace(/[^A-Za-z0-9_-]/g, '_');
  if (format === 'json') return writeJson(res, 200, JSON.parse(redacted), { 'content-disposition': `attachment; filename="${safeName}-evidence.json"`, 'cache-control': 'no-store' });
  res.writeHead(200, { 'content-type': 'text/markdown', 'content-disposition': `attachment; filename="${safeName}-evidence.md"`, 'cache-control': 'no-store' });
  return res.end(`# Task Evidence ${safeName}\n\n\`\`\`json\n${redacted}\n\`\`\`\n`);
}

async function telegramWebhook(req, res) {
  if (process.env.TELEGRAM_WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== process.env.TELEGRAM_WEBHOOK_SECRET) return json(res, 401, { error: 'invalid telegram secret' });
  const body = await readJson(req);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
  setTimeout(async () => {
    const reply = await handleTelegramUpdate(body);
    await dispatchReply(process.env.TELEGRAM_BOT_TOKEN, reply);
  }, 0).unref();
}

function checkLimit(req, bucket, limit, windowMs) { const result = rateLimit(`${bucket}:${clientIp(req)}`, { limit, windowMs }); if (!result.allowed) audit(null, 'rate-limit', 'rate_limit.exceeded', { bucket, ip: clientIp(req) }); return result; }
function limited(res, limit) { res.setHeader('retry-after', String(limit.retryAfter)); return json(res, 429, { error: 'rate limit exceeded', retryAfter: limit.retryAfter }); }
function isStateChanging(req) { return !['GET', 'HEAD', 'OPTIONS'].includes(req.method); }
function setSecurityHeaders(req, res) { res.setHeader('x-frame-options', 'DENY'); res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('referrer-policy', 'no-referrer'); res.setHeader('permissions-policy', 'microphone=(self), camera=(), geolocation=()'); res.setHeader('cache-control', req.url?.startsWith('/api/') ? 'no-store' : 'no-cache'); if (process.env.NODE_ENV === 'production') res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains'); const inline = process.env.NODE_ENV === 'production' ? '' : " 'unsafe-inline'"; res.setHeader('content-security-policy', `default-src 'self'; script-src 'self'${inline}; style-src 'self'${inline}; connect-src 'self'; img-src 'self' data:`); }
function serve(res, file, type, cacheControl) {
  const resolved = path.resolve(file);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return json(res, 404, { error: 'not found' });
  const headers = { 'content-type': type };
  if (cacheControl) headers['cache-control'] = cacheControl;
  res.writeHead(200, headers);
  const stream = fs.createReadStream(resolved);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

const IS_ENTRY_POINT = import.meta.url === `file://${process.argv[1]}`;

export function start(port, host) {
  lifecyclePhase = 'starting';
  try {
    assertSchemaCompatible();
  } catch (error) {
    console.error(JSON.stringify({ service: 'api', fatal: true, error: String(error.message || error) }));
    throw error;
  }
  const validation = requireProductionSafeConfig();
  const identityValidation = validateDeploymentIdentityForStartup(deploymentIdentityProvider.get());
  startupConfigValidation = { ok: validation.ok && identityValidation.ok, deploymentIdentity: identityValidation };
  if ((process.env.NODE_ENV === 'production' && !validation.ok) || !identityValidation.ok) {
    console.error(JSON.stringify({ service: 'api', fatal: true, errors: validation.errors, deploymentIdentityReasonCode: identityValidation.reasonCode }));
    throw new Error(`production configuration refused: ${[...validation.errors, ...(identityValidation.ok ? [] : [`deployment identity ${identityValidation.reasonCode}`])].join('; ')}`);
  }
  // The canonical bind contract decides host and port. Explicit arguments stay supported for
  // in-process tests and the restricted staging launcher, but a production profile is always
  // validated so no caller can widen the loopback boundary or reintroduce a default port.
  const bind = resolveBindTarget();
  if (bind.production && !bind.ok) {
    console.error(JSON.stringify({ service: 'api', fatal: true, errors: bind.errors }));
    throw new Error(`production bind refused: ${bind.errors.join('; ')}`);
  }
  const boundPort = port === undefined ? bind.port : port;
  const boundHost = host === undefined ? bind.host : host;
  if (bind.production && (boundPort !== bind.port || boundHost !== bind.host)) {
    console.error(JSON.stringify({ service: 'api', fatal: true, errors: ['Production listener arguments must match the canonical BIND_HOST/PORT contract.'] }));
    throw new Error('production listener arguments must match the canonical BIND_HOST/PORT contract');
  }
  if (TEST_MODE.enabled) upsertWorkspace({ id: TEST_MODE.workspaceId, name: 'Unified Jarvis iPhone Test', description: 'Disposable read-only test workspace', githubRepository: 'local/iphone-test', defaultBranch: 'test', allowedPaths: [], buildCommands: [], providerPolicy: { preferred: ['mock'] }, riskLevel: 'low', budgetCents: 100, secretReferences: [], enabledTools: ['status'], lastHealthStatus: 'test', rootPath: TEST_MODE.workspaceRoot });
  const server = http.createServer(route);
  // Fail closed on an occupied port. There is no retry and no fallback port: the existing
  // listener keeps the port and is never contacted, signalled, or replaced.
  server.on('error', (error) => {
    const occupied = error.code === 'EADDRINUSE';
    console.error(JSON.stringify({
      service: 'api',
      fatal: true,
      error: occupied ? `port ${boundPort} is already in use; refusing to start without a fallback` : String(error.message || error),
      code: error.code || null,
    }));
  });
  server.listen(boundPort, boundHost, () => {
    lifecyclePhase = 'ready';
    console.log(JSON.stringify({ service: 'api', port: boundPort, host: boundHost || 'default' }));
  });
  const cleanupTimer = setInterval(() => { cleanupExpiredSessions(); cleanupRateLimits(); }, Number(process.env.CLEANUP_INTERVAL_MS || 15 * 60 * 1000));
  cleanupTimer.unref();
  server.on('close', () => { lifecyclePhase = 'stopped'; clearInterval(cleanupTimer); });
  return server;
}

export function healthSnapshot() {
  let database = 'available';
  let persistentEmergencyStop = false;
  try { persistentEmergencyStop = getFlag('emergency_stop') === 'active'; }
  catch { database = 'unavailable'; persistentEmergencyStop = true; }
  let worker = { required: false, ok: false, state: 'unknown', heartbeatAgeMs: null, activeTask: false, restartDetected: false };
  let scheduler = { required: false, ok: true, state: 'disabled' };
  if (database === 'available') {
    worker = workerRuntimeStatus();
    scheduler = schedulerRuntimeStatus();
  }
  return {
    ok: true,
    service: 'blackspire-command-api',
    lifecycle: lifecyclePhase,
    database,
    emergencyStop: persistentEmergencyStop || emergencyStopMemory,
    telegramMode: process.env.TELEGRAM_MODE || (process.env.TELEGRAM_BOT_TOKEN ? 'polling' : 'dry-run'),
    dependencies: { worker, scheduler },
    deploymentIdentity: serializeDeploymentIdentity(deploymentIdentityProvider.get()),
  };
}

export function readinessSnapshot({ schemaCheck = assertSchemaCompatible } = {}) {
  let database = 'compatible';
  try { schemaCheck(); } catch { database = 'unavailable_or_incompatible'; }
  let worker = { required: false, ok: false, state: 'unknown', heartbeatAgeMs: null, activeTask: false, restartDetected: false };
  let scheduler = { required: false, ok: true, state: 'disabled' };
  if (database === 'compatible') {
    worker = workerRuntimeStatus();
    scheduler = schedulerRuntimeStatus();
  }
  const checks = {
    lifecycle: lifecyclePhase === 'ready',
    database: database === 'compatible',
    productionConfig: startupConfigValidation.ok === true,
    worker: worker.ok,
    scheduler: scheduler.ok,
    deploymentIdentity: validateDeploymentIdentityForStartup(deploymentIdentityProvider.get()).ok,
  };
  return {
    ok: Object.values(checks).every(Boolean),
    service: 'blackspire-command-api',
    lifecycle: lifecyclePhase,
    checks,
    database,
    providers: activeModes(),
    productionConfig: startupConfigValidation,
    dependencies: { worker, scheduler },
    deploymentIdentity: serializeDeploymentIdentity(deploymentIdentityProvider.get()),
  };
}

export function beginGracefulShutdown(server, { deadlineMs = 10_000 } = {}) {
  if (lifecyclePhase === 'draining' || lifecyclePhase === 'stopped') return Promise.resolve();
  lifecyclePhase = 'draining';
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      closeDb();
      resolve();
    };
    const deadline = setTimeout(() => {
      server.closeAllConnections?.();
      finish();
    }, deadlineMs);
    deadline.unref();
    server.close(finish);
  });
}

if (IS_ENTRY_POINT) {
  let server;
  let shutdownPromise = null;
  const shutdown = (signal) => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      if (signal) console.log(JSON.stringify({ service: 'api', lifecycle: 'draining', signal }));
      try { if (server) await beginGracefulShutdown(server); }
      finally { closeDb(); }
    })();
    return shutdownPromise;
  };
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    if (shutdownPromise) {
      server?.closeAllConnections?.();
      process.exitCode = 1;
      return;
    }
    void shutdown(signal);
  });
  try {
    server = start();
    server.once('error', () => { process.exitCode = 1; void shutdown(); });
  } catch {
    process.exitCode = 1;
    void shutdown();
  }
}
