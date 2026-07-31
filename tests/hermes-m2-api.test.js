// Hermes Milestone 2 — API status surface tests.
// Verifies the read-only /api/hermes/runtime endpoint requires auth and returns only redacted
// metadata (never a credential value).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-hermes-m2api-'));
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'm2api.sqlite');
process.env.COMMAND_ADMIN_TOKEN = 'm2-api-token';
process.env.SESSION_SECRET = 'm2-api-session-secret-not-real-000000000000';
process.env.TELEGRAM_ALLOWED_USERS = '1001';
process.env.ANTHROPIC_API_KEY = 'super-secret-should-never-appear';
process.env.ALLOW_BEARER_AUTH = 'true';
process.env.PORT = '8906';
process.env.BLACKSPIRE_EVALUATION_ADMIN_PRINCIPAL_ID = 'm2-evaluation-admin';

const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { run } = await import('../packages/task-engine/db.js');
const authNow = Date.now();
run('INSERT INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', ['m2-evaluation-admin','admin','m2-evaluation-admin','bearer',null,'active',authNow,null,null,null,1,authNow]);
run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['m2-evaluation-grant','m2-evaluation-admin','m2-api-workspace','viewer','["evaluation.read"]','active',1,null,authNow,null,null,'test',1,authNow]);
const { upsertWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { createUnifiedInput } = await import('../packages/unified-input/unified.js');
const { getTask } = await import('../packages/task-engine/tasks.js');
const { runHermesWorkflow } = await import('../packages/hermes-orchestrator/orchestrator.js');
upsertWorkspace({ id: 'm2-api-workspace', name: 'm2-api-workspace', githubRepository: 'local/m2-api', defaultBranch: 'main', allowedPaths: ['docs'], buildCommands: [], providerPolicy: {}, riskLevel: 'low', budgetCents: 100, secretReferences: [], enabledTools: ['read'], lastHealthStatus: 'ok', rootPath: root });
const m2EvaluationInput = createUnifiedInput({ channel: 'jarvis', actorId: 'm2-api-user', channelKey: 'm2-api-user', workspaceId: 'm2-api-workspace', text: 'report current status', idempotencyKey: 'm2-api-evaluation' });
const m2Evaluation = await runHermesWorkflow(getTask(m2EvaluationInput.taskId));
upsertWorkspace({ id: 'm2-api-other', name: 'm2-api-other', githubRepository: 'local/m2-api-other', defaultBranch: 'main', allowedPaths: ['docs'], buildCommands: [], providerPolicy: {}, riskLevel: 'low', budgetCents: 100, secretReferences: [], enabledTools: ['read'], lastHealthStatus: 'ok', rootPath: root });
const otherInput = createUnifiedInput({ channel: 'jarvis', actorId: 'm2-api-user', channelKey: 'm2-api-user', workspaceId: 'm2-api-other', text: 'report other status', idempotencyKey: 'm2-api-other-evaluation' });
const otherEvaluation = await runHermesWorkflow(getTask(otherInput.taskId));

// Milestone 3B read-route fixtures. Derivation persists immutable rows and so demands the
// write-capable `evaluation.correct`, which the read-only session principal above deliberately does
// not hold; a separate derivation principal mints the snapshots out of band. There is no derivation
// route, so this is the only way a scorecard can exist, which is itself part of what is asserted.
const authz = await import('../packages/shared/authorization.js');
const { deriveVerifiedScorecards } = await import('../packages/hermes-orchestrator/scorecard.js');
const { getOutcomeEvaluation } = await import('../packages/hermes-orchestrator/store.js');
run('INSERT INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', ['m2-scorecard-deriver','admin','m2-scorecard-deriver','bearer',null,'active',authNow,null,null,null,1,authNow]);
run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['m2-scorecard-grant','m2-scorecard-deriver','m2-api-workspace','viewer','["evaluation.correct","evaluation.read"]','active',1,null,authNow,null,null,'test',1,authNow]);
run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', ['m2-scorecard-grant-other','m2-scorecard-deriver','m2-api-other','viewer','["evaluation.correct","evaluation.read"]','active',1,null,authNow,null,null,'test',1,authNow]);
const deriver = authz.resolveAdminBearer('m2-scorecard-deriver');
const cutoffOf = (evaluationId) => { const row = getOutcomeEvaluation(evaluationId); return { createdAt: row.created_at, id: row.id }; };
const [m2Scorecard] = deriveVerifiedScorecards(deriver, { workspaceId: 'm2-api-workspace', cutoff: cutoffOf(m2Evaluation.evaluationId) });
const [otherScorecard] = deriveVerifiedScorecards(deriver, { workspaceId: 'm2-api-other', cutoff: cutoffOf(otherEvaluation.evaluationId) });

const { start } = await import('../apps/api/server.js');

const server = start(8906, '127.0.0.1', { exitOnListenError: false });
await new Promise((r) => setTimeout(r, 150));
const base = 'http://127.0.0.1:8906';

test.after(() => { try { server.close(); } catch { /* ignore */ } });

test('GET /api/hermes/runtime requires authentication', async () => {
  const res = await fetch(`${base}/api/hermes/runtime`);
  assert.equal(res.status, 401);
});

test('authenticated status returns redacted metadata and never the credential value', async () => {
  const res = await fetch(`${base}/api/hermes/runtime`, { headers: { authorization: 'Bearer m2-api-token' } });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.ok(!body.includes('super-secret-should-never-appear'), 'credential value must never appear in the status response');
  const json = JSON.parse(body);
  assert.equal(json.executionModeDefault, 'mock');
  const anthropic = json.providers.find((p) => p.id === 'anthropic');
  assert.equal(anthropic.enabled, false, 'anthropic is disabled by default');
  assert.equal(anthropic.authentication, 'configured', 'auth reported as a boolean state, not a value');
  assert.equal(anthropic.productionEligible, false);
});

test('the read-only hermes-runtime page is served', async () => {
  const res = await fetch(`${base}/hermes-runtime`);
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Hermes Runtime Status/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.doesNotMatch(html, /<style(?:\s|>)/i);
  assert.equal((await fetch(`${base}/hermes-runtime.js`)).status, 200);
  assert.equal((await fetch(`${base}/hermes-runtime.css`)).status, 200);
});

test('a verified admin login session can read its configured, workspace-authorized evaluation without exposing a bearer', async (t) => {
  // This test revokes the shared evaluation admin principal to prove the 403. Restore it through
  // `after` rather than a trailing statement so an assertion failure here cannot also leave every
  // later test failing against a revoked principal, which would misdirect debugging.
  t.after(() => run(`UPDATE auth_principals SET status='active',revoked_at=NULL WHERE id='m2-evaluation-admin'`));
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: 'm2-api-token' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const res = await fetch(`${base}/api/hermes/evaluations/${encodeURIComponent(m2Evaluation.evaluationId)}`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.ok(!body.includes('m2-api-token'));
  const evaluation = JSON.parse(body).evaluation;
  assert.equal(evaluation.id, m2Evaluation.evaluationId);
  assert.deepEqual(Object.keys(evaluation).sort(), ['acceptanceStatus','corrections','createdAt','evaluationVersion','failureCategory','id','learningEligibility','runId','sourceEvents','terminalOutcome','terminalStatus','verificationStatus','workspaceId'].sort());
  assert.equal((await fetch(`${base}/api/hermes/evaluations/${encodeURIComponent(otherEvaluation.evaluationId)}`, { headers: { cookie } })).status, 404);
  assert.equal((await fetch(`${base}/api/hermes/evaluations/unknown-evaluation`, { headers: { cookie } })).status, 404);
  assert.equal((await fetch(`${base}/api/hermes/evaluations/${encodeURIComponent(m2Evaluation.evaluationId)}`, { headers: { authorization: 'Bearer m2-api-token' } })).status, 200);
  const sessionId = cookie.slice(cookie.indexOf('=') + 1);
  run('UPDATE sessions SET principal_id=NULL WHERE id=?', [sessionId]);
  assert.equal((await fetch(`${base}/api/hermes/evaluations/${encodeURIComponent(m2Evaluation.evaluationId)}`, { headers: { cookie } })).status, 403);
  run('UPDATE sessions SET principal_id=? WHERE id=?', ['m2-evaluation-admin', sessionId]);
  run(`UPDATE auth_principals SET status='revoked',revoked_at=? WHERE id='m2-evaluation-admin'`, [Date.now()]);
  assert.equal((await fetch(`${base}/api/hermes/evaluations/${encodeURIComponent(m2Evaluation.evaluationId)}`, { headers: { cookie } })).status, 403);
});

// Milestone 3B: the only read surface for a verified scorecard. The doc claims this route refuses a
// principal that is not the configured evaluation admin and returns an indistinguishable 404 for an
// unknown and a cross-workspace id; nothing pinned those claims, so they are pinned here alongside
// the 3A twin above. Test mode is deliberately NOT covered: this suite authenticates through
// `POST /api/auth/login`, which 404s when test mode is enabled, so that branch is unreachable from
// here. `testModeAllowsRequest` has no scorecard clause and falls through to deny, which is correct
// but is pinned by the test-mode suite rather than by this one.
test('the verified scorecard read route is admin-bound and discloses nothing across workspaces', async () => {
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ adminToken: 'm2-api-token' }) });
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const res = await fetch(`${base}/api/hermes/scorecards/${encodeURIComponent(m2Scorecard.id)}`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.ok(!body.includes('m2-api-token'), 'the admin credential must never appear in a scorecard response');
  assert.ok(!body.includes('super-secret-should-never-appear'));
  const scorecard = JSON.parse(body).scorecard;
  assert.equal(scorecard.id, m2Scorecard.id);
  assert.equal(scorecard.workspaceId, 'm2-api-workspace');
  // A scorecard in another workspace and an id that does not exist must be indistinguishable, so a
  // caller cannot use the status code to probe which ids are real.
  assert.equal((await fetch(`${base}/api/hermes/scorecards/${encodeURIComponent(otherScorecard.id)}`, { headers: { cookie } })).status, 404);
  assert.equal((await fetch(`${base}/api/hermes/scorecards/unknown-scorecard`, { headers: { cookie } })).status, 404);
  // Unauthenticated is refused before any lookup. A non-GET method never reaches the route at all:
  // the CSRF gate refuses an unsafe method on a cookie session first, so the assertion is that it is
  // refused, not which layer refuses it.
  assert.equal((await fetch(`${base}/api/hermes/scorecards/${encodeURIComponent(m2Scorecard.id)}`)).status, 401);
  assert.equal((await fetch(`${base}/api/hermes/scorecards/${encodeURIComponent(m2Scorecard.id)}`, { method: 'POST', headers: { cookie } })).status, 403);
  // A session that is authenticated but not bound to the configured evaluation admin principal is
  // refused with 403 rather than being allowed to read anything.
  const sessionId = cookie.slice(cookie.indexOf('=') + 1);
  run('UPDATE sessions SET principal_id=NULL WHERE id=?', [sessionId]);
  assert.equal((await fetch(`${base}/api/hermes/scorecards/${encodeURIComponent(m2Scorecard.id)}`, { headers: { cookie } })).status, 403);
  run('UPDATE sessions SET principal_id=? WHERE id=?', ['m2-evaluation-admin', sessionId]);
  assert.equal((await fetch(`${base}/api/hermes/scorecards/${encodeURIComponent(m2Scorecard.id)}`, { headers: { cookie } })).status, 200);
});
