// Hermes M3C: append-only, workspace-isolated human review decisions over M1 memory candidates.
// No routing, provider execution, approval, memory-promotion, memory-retrieval, or production
// behavior is tested because none is permitted in this phase - and several tests below exist
// specifically to prove that recording a review changes none of those tables, and in particular
// that `hermes_memory_candidates.status` and `promoted_at` are never written.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-hermes-m3c-'));
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'm3c.sqlite');
const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { upsertWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { createUnifiedInput } = await import('../packages/unified-input/unified.js');
const { getTask } = await import('../packages/task-engine/tasks.js');
const { runHermesWorkflow } = await import('../packages/hermes-orchestrator/orchestrator.js');
const store = await import('../packages/hermes-orchestrator/store.js');
const { run, all, execSql } = await import('../packages/task-engine/db.js');
const authz = await import('../packages/shared/authorization.js');
const { digest } = await import('../packages/shared/canonical.js');
const { recordMemoryCandidateReview, readMemoryCandidateReview, MEMORY_REVIEW_VERSION,
  MEMORY_REVIEW_DECISION_VERSION, MEMORY_REVIEW_DECISIONS } = await import('../packages/hermes-orchestrator/memory-review.js');

const authzNow = Date.now();
function principal(workspaceId, permissions = ['evaluation.read', 'evaluation.correct']) {
  const suffix = `${workspaceId}-${permissions.join('-')}`;
  const principalId = `m3c-admin-${suffix}`; const grantId = `m3c-grant-${suffix}`;
  run('INSERT INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [principalId, 'admin', principalId, 'bearer', null, 'active', authzNow, null, null, null, 1, authzNow]);
  run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [grantId, principalId, workspaceId, 'viewer', JSON.stringify([...permissions].sort()), 'active', 1, null, authzNow, null, null, 'test', 1, authzNow]);
  return authz.resolveAdminBearer(principalId);
}
function workspace(id) { upsertWorkspace({ id, name: id, githubRepository: 'local/m3c', defaultBranch: 'main', allowedPaths: ['docs'], buildCommands: [], providerPolicy: {}, riskLevel: 'low', budgetCents: 100, secretReferences: [], enabledTools: ['read'], lastHealthStatus: 'ok', rootPath: root }); }
function task(id, text = 'report current status', nonce = '') { const i = createUnifiedInput({ channel: 'jarvis', actorId: 'm3c-user', channelKey: 'm3c-user', workspaceId: id, text, idempotencyKey: `m3c-${id}-${text}-${nonce}` }); return getTask(i.taskId); }
function withoutImmutability(tables, callback) {
  const placeholders = tables.map(() => '?').join(',');
  const triggers = all(`SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name IN (${placeholders}) ORDER BY name`, tables);
  for (const trigger of triggers) execSql(`DROP TRIGGER ${trigger.name}`);
  try { return callback(); } finally { for (const trigger of triggers) execSql(trigger.sql); }
}
// Mints `count` verified mock runs in one workspace and returns their pending memory candidates in
// canonical (created_at, id) order.
async function seedCandidates(workspaceId, count) {
  workspace(workspaceId);
  const candidates = [];
  for (let index = 0; index < count; index += 1) {
    const result = await runHermesWorkflow(task(workspaceId, 'report current status', String(index)));
    for (const candidate of store.getMemoryCandidates(result.runId)) candidates.push(candidate);
  }
  return candidates.sort((left, right) => (`${left.created_at} ${left.id}` < `${right.created_at} ${right.id}` ? -1 : 1));
}
const review = (overrides = {}) => ({ decision: 'reject', rationale: 'the lesson restates the task text and adds nothing', idempotencyKey: 'm3c-key-1', ...overrides });

// Tables whose byte-identical state proves a review had no execution, approval, promotion, or
// routing effect. `hermes_memory_candidates` is the load-bearing entry: it carries `status` and
// `promoted_at`, so pinning it byte-for-byte is what proves nothing was promoted.
const SIDE_EFFECT_TABLES = [['hermes_memory_candidates', 'id'], ['hermes_routing_decisions', 'id'], ['hermes_policy_decisions', 'id'], ['hermes_provider_invocations', 'id'], ['hermes_provider_health', 'provider'], ['hermes_approvals', 'id'], ['approvals', 'id'], ['hermes_workflow_runs', 'id'], ['hermes_workflow_steps', 'id'], ['hermes_verification_results', 'id'], ['hermes_outcome_evaluations', 'id'], ['hermes_outcome_evaluation_components', 'id'], ['hermes_outcome_corrections', 'id'], ['hermes_outcome_source_events', 'id'], ['hermes_verified_scorecards', 'id'], ['hermes_verified_scorecard_sources', 'id'], ['tasks', 'id']];
function sideEffectSnapshot() {
  const snapshot = Object.fromEntries(SIDE_EFFECT_TABLES.map(([table, key]) => [table, digest(all(`SELECT * FROM ${table} ORDER BY ${key}`))]));
  // Promoted memory has no table yet, so "no promotion happened" is proven by pinning every
  // candidate column above and by proving a review creates no table, index, or trigger anywhere.
  snapshot.__schema = digest(all('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name,tbl_name'));
  return snapshot;
}

test('a review records the decision, rationale, and pinned lineage for a pending candidate', async () => {
  const [candidate] = await seedCandidates('m3c-happy', 1);
  const reader = principal('m3c-happy');
  const recorded = recordMemoryCandidateReview(reader, candidate.id, review());
  assert.equal(recorded.candidate_id, candidate.id);
  assert.equal(recorded.workspace_id, 'm3c-happy');
  assert.equal(recorded.decision, 'reject');
  assert.equal(recorded.review_version, MEMORY_REVIEW_VERSION);
  assert.equal(recorded.decision_version, MEMORY_REVIEW_DECISION_VERSION);
  assert.equal(recorded.candidate_status_at_review, 'pending');
  assert.match(recorded.content_digest, /^[a-f0-9]{64}$/);
  assert.match(recorded.lineage_digest, /^[a-f0-9]{64}$/);
  assert.match(recorded.candidate_digest, /^[a-f0-9]{64}$/);
  // Lineage binds the review to intact Milestone 3A evidence, not merely to the candidate row.
  const evaluation = store.getOutcomeEvaluationForRun(candidate.run_id, recorded.evaluation_version);
  assert.equal(recorded.evaluation_id, evaluation.id);
  assert.equal(recorded.provenance_digest, evaluation.provenance_digest);
  // The reviewer is the server-resolved principal, never a caller-supplied field.
  assert.equal(recorded.reviewer_principal_id, reader.principalId);
  const read = readMemoryCandidateReview(reader, recorded.id);
  assert.deepEqual(Object.keys(read).sort(), ['candidate','candidateId','contentDigest','createdAt','decision','decisionVersion','evaluation','id','lineageDigest','rationale','reviewVersion','reviewerPrincipalId','runId','taskId','workspaceId'].sort());
  assert.equal(read.decision, 'reject');
});

test('recommending promotion records an opinion and promotes nothing', async () => {
  const [candidate] = await seedCandidates('m3c-recommend', 1);
  const reader = principal('m3c-recommend');
  const recorded = recordMemoryCandidateReview(reader, candidate.id, review({ decision: 'recommend_promote', rationale: 'the lesson generalizes beyond this run' }));
  assert.equal(recorded.decision, 'recommend_promote');
  // Asserted in the same test as the recommendation itself so no future edit can separate the
  // recommendation from the proof that it promoted nothing.
  const after = store.getMemoryCandidate(candidate.id);
  assert.equal(after.status, 'pending', 'a recommendation must never change candidate status');
  assert.equal(after.promoted_at, null, 'a recommendation must never set promoted_at');
  assert.deepEqual(after, candidate, 'the candidate row is byte-identical after a recommendation');
  // There is no `promote` decision at all, and the database refuses one independently.
  assert.ok(!MEMORY_REVIEW_DECISIONS.includes('promote'));
  assert.throws(() => withoutImmutability(['hermes_memory_candidate_reviews'], () =>
    run('UPDATE hermes_memory_candidate_reviews SET decision=? WHERE id=?', ['promote', recorded.id])), /CHECK constraint failed/);
});

test('an unreviewed candidate reads as an explicit absence, never as a defaulted decision', async () => {
  const [candidate] = await seedCandidates('m3c-unreviewed', 1);
  const reader = principal('m3c-unreviewed');
  assert.ok(!store.getMemoryCandidateReviewForCandidate(candidate.id), 'no review row exists for an unreviewed candidate');
  assert.equal(readMemoryCandidateReview(reader, 'hmrev-does-not-exist'), null);
});

test('recording requires the write-capable permission and reading does not', async () => {
  const [candidate] = await seedCandidates('m3c-authz', 1);
  const readOnly = principal('m3c-authz', ['evaluation.read']);
  assert.throws(() => recordMemoryCandidateReview(readOnly, candidate.id, review()), /not authorized/);
  assert.equal(all('SELECT id FROM hermes_memory_candidate_reviews WHERE workspace_id=?', ['m3c-authz']).length, 0, 'a denied recording writes no review');
  const writer = principal('m3c-authz');
  const recorded = recordMemoryCandidateReview(writer, candidate.id, review());
  assert.ok(readMemoryCandidateReview(readOnly, recorded.id), 'a read-only grant can still read');
  // The denial is audited durably even though the transaction it precedes never ran.
  const denials = all(`SELECT id FROM auth_decisions WHERE workspace_id=? AND allowed=0`, ['m3c-authz']);
  assert.ok(denials.length > 0, 'a refused recording leaves a durable audited denial');
});

test('a review is isolated to the candidate workspace and discloses nothing across workspaces', async () => {
  const [ownCandidate] = await seedCandidates('m3c-iso-a', 1);
  await seedCandidates('m3c-iso-b', 1);
  const owner = principal('m3c-iso-a');
  const outsider = principal('m3c-iso-b');
  assert.throws(() => recordMemoryCandidateReview(outsider, ownCandidate.id, review()), /not authorized/);
  const recorded = recordMemoryCandidateReview(owner, ownCandidate.id, review());
  // A cross-workspace review and an id that does not exist must be indistinguishable, so a caller
  // cannot use the result to probe which review ids are real.
  assert.deepEqual(readMemoryCandidateReview(outsider, recorded.id), readMemoryCandidateReview(outsider, 'hmrev-unknown-id'));
  assert.equal(readMemoryCandidateReview(outsider, recorded.id), null);
});

test('malformed, missing, and non-reviewable subjects fail closed and write nothing', async () => {
  const [candidate, second] = await seedCandidates('m3c-closed', 2);
  const reader = principal('m3c-closed');
  const cases = [
    ['an out-of-enum decision', () => recordMemoryCandidateReview(reader, candidate.id, review({ decision: 'promote' })), /canonical review decision/],
    ['a promotion-shaped decision with padding', () => recordMemoryCandidateReview(reader, candidate.id, review({ decision: 'recommend_promote ' })), /canonical review decision/],
    ['an empty rationale', () => recordMemoryCandidateReview(reader, candidate.id, review({ rationale: '   ' })), /requires a rationale/],
    ['an over-long rationale', () => recordMemoryCandidateReview(reader, candidate.id, review({ rationale: 'x'.repeat(2001) })), /requires a rationale/],
    ['a malformed candidate id', () => recordMemoryCandidateReview(reader, 'not a candidate id', review()), /canonical candidate id/],
    ['a missing candidate', () => recordMemoryCandidateReview(reader, 'hmc-absent', review()), /existing candidate/],
    ['a malformed idempotency key', () => recordMemoryCandidateReview(reader, candidate.id, review({ idempotencyKey: 'has spaces' })), /canonical idempotency key/],
  ];
  const before = digest(all('SELECT * FROM hermes_memory_candidate_reviews ORDER BY id'));
  for (const [label, act, pattern] of cases) {
    assert.throws(act, pattern, label);
    assert.equal(digest(all('SELECT * FROM hermes_memory_candidate_reviews ORDER BY id')), before, `${label} writes no review row`);
  }
  // A candidate that is not pending, has been promoted, is globally scoped, or has a NULL workspace
  // is unreviewable. These require trigger-free direct writes because no application path creates
  // them - `hermes_memory_candidates` has no immutability triggers at all.
  const tampered = [
    ['a non-pending candidate', () => run('UPDATE hermes_memory_candidates SET status=? WHERE id=?', ['reviewed', second.id]), /not pending/],
    ['an already-promoted candidate', () => run('UPDATE hermes_memory_candidates SET promoted_at=? WHERE id=?', ['2026-07-31T00:00:00.000Z', second.id]), /already-promoted/],
    ['a global candidate scope', () => run('UPDATE hermes_memory_candidates SET scope=? WHERE id=?', ['global', second.id]), /non-workspace candidate scope/],
    ['a null workspace', () => run('UPDATE hermes_memory_candidates SET workspace_id=NULL WHERE id=?', [second.id]), /canonical workspace id/],
    ['an empty lesson', () => run('UPDATE hermes_memory_candidates SET lesson=? WHERE id=?', ['', second.id]), /empty candidate lesson/],
  ];
  const original = store.getMemoryCandidate(second.id);
  for (const [label, tamper, pattern] of tampered) {
    tamper();
    assert.throws(() => recordMemoryCandidateReview(reader, second.id, review({ idempotencyKey: 'm3c-key-tampered' })), pattern, label);
    assert.equal(digest(all('SELECT * FROM hermes_memory_candidate_reviews ORDER BY id')), before, `${label} writes no review row`);
    run('UPDATE hermes_memory_candidates SET status=?,promoted_at=?,scope=?,workspace_id=?,lesson=? WHERE id=?',
      [original.status, original.promoted_at, original.scope, original.workspace_id, original.lesson, second.id]);
  }
  // The restore actually restored, so the cases above were not passing against a broken fixture.
  assert.deepEqual(store.getMemoryCandidate(second.id), original);
});

test('a candidate whose run has no intact outcome evidence is unreviewable, and its neighbours are not', async () => {
  const candidates = await seedCandidates('m3c-evidence', 2);
  const reader = principal('m3c-evidence');
  const [broken, intact] = candidates;
  withoutImmutability(['hermes_outcome_evaluations'], () => {
    run('UPDATE hermes_outcome_evaluations SET provenance_digest=? WHERE run_id=?', ['0'.repeat(64), broken.run_id]);
  });
  assert.throws(() => recordMemoryCandidateReview(reader, broken.id, review()), /intact outcome evaluation/);
  // Unlike Milestone 3B aggregation, one bad subject must not make the workspace unusable: the
  // neighbouring candidate still reviews.
  const recorded = recordMemoryCandidateReview(reader, intact.id, review({ idempotencyKey: 'm3c-key-neighbour' }));
  assert.equal(recorded.candidate_id, intact.id);
});

test('replay returns the stored review, and a conflicting replay refuses instead of overwriting', async () => {
  const [candidate] = await seedCandidates('m3c-replay', 1);
  const reader = principal('m3c-replay');
  const first = recordMemoryCandidateReview(reader, candidate.id, review());
  const before = all('SELECT id FROM hermes_memory_candidate_reviews').length;
  const replayed = recordMemoryCandidateReview(reader, candidate.id, review());
  assert.deepEqual(replayed, first, 'replay returns byte-identical content');
  assert.equal(all('SELECT id FROM hermes_memory_candidate_reviews').length, before, 'replay writes no second row');
  assert.throws(() => recordMemoryCandidateReview(reader, candidate.id, review({ decision: 'recommend_promote' })),
    /identity conflicts with stored decision/, 'the same key with a different decision is an integrity conflict');
  assert.deepEqual(store.getMemoryCandidateReview(first.id), first, 'the conflicting replay overwrote nothing');
  // One terminal review per candidate in m3c-v1: a different key is not a second opinion.
  assert.throws(() => recordMemoryCandidateReview(reader, candidate.id, review({ idempotencyKey: 'm3c-key-2' })),
    /already-reviewed candidate/);
  assert.equal(all('SELECT id FROM hermes_memory_candidate_reviews').length, before);
});

test('an idempotency key is scoped per workspace', async () => {
  const [first] = await seedCandidates('m3c-keyscope-a', 1);
  const [second] = await seedCandidates('m3c-keyscope-b', 1);
  const a = recordMemoryCandidateReview(principal('m3c-keyscope-a'), first.id, review({ idempotencyKey: 'shared-key' }));
  const b = recordMemoryCandidateReview(principal('m3c-keyscope-b'), second.id, review({ idempotencyKey: 'shared-key' }));
  assert.notEqual(a.id, b.id, 'the same key in another workspace is a distinct review');
});

test('the canonical review table rejects update and delete', async () => {
  const [candidate] = await seedCandidates('m3c-immutable', 1);
  const reader = principal('m3c-immutable');
  const recorded = recordMemoryCandidateReview(reader, candidate.id, review());
  assert.throws(() => run('UPDATE hermes_memory_candidate_reviews SET decision=? WHERE id=?', ['recommend_promote', recorded.id]), /immutable memory candidate review/);
  assert.throws(() => run('DELETE FROM hermes_memory_candidate_reviews WHERE id=?', [recorded.id]), /immutable memory candidate review/);
});

test('a review whose stored content no longer reproduces its digests is unreadable', async () => {
  const [candidate] = await seedCandidates('m3c-corrupt', 1);
  const reader = principal('m3c-corrupt');
  const recorded = recordMemoryCandidateReview(reader, candidate.id, review());
  const mutations = [
    ['a silently upgraded decision', () => run('UPDATE hermes_memory_candidate_reviews SET decision=? WHERE id=?', ['recommend_promote', recorded.id])],
    ['a rewritten rationale', () => run('UPDATE hermes_memory_candidate_reviews SET rationale=? WHERE id=?', ['actually this was excellent', recorded.id])],
    ['a re-attributed candidate', () => run('UPDATE hermes_memory_candidate_reviews SET candidate_id=? WHERE id=?', ['hmc-someone-else', recorded.id])],
    ['a forged candidate pin', () => run('UPDATE hermes_memory_candidate_reviews SET candidate_digest=? WHERE id=?', ['0'.repeat(64), recorded.id])],
    ['a forged provenance digest', () => run('UPDATE hermes_memory_candidate_reviews SET provenance_digest=? WHERE id=?', ['0'.repeat(64), recorded.id])],
    ['a swapped content digest', () => run('UPDATE hermes_memory_candidate_reviews SET content_digest=? WHERE id=?', ['0'.repeat(64), recorded.id])],
  ];
  for (const [label, mutate] of mutations) {
    withoutImmutability(['hermes_memory_candidate_reviews'], mutate);
    assert.equal(readMemoryCandidateReview(reader, recorded.id), null, `${label} makes the review unreadable`);
    withoutImmutability(['hermes_memory_candidate_reviews'], () => run('DELETE FROM hermes_memory_candidate_reviews WHERE id=?', [recorded.id]));
    withoutImmutability(['hermes_memory_candidate_reviews'], () => store.insertMemoryCandidateReview({ ...recorded }));
    // The restore actually restored: without this a broken restore would make every later
    // iteration pass trivially against a missing row.
    assert.ok(readMemoryCandidateReview(reader, recorded.id), `${label} restored the intact review`);
  }
});

test('a candidate mutated after review keeps the review readable and pinned to what was decided', async () => {
  const [candidate] = await seedCandidates('m3c-pin', 1);
  const reader = principal('m3c-pin');
  const recorded = recordMemoryCandidateReview(reader, candidate.id, review());
  // `hermes_memory_candidates` has no immutability triggers, so this needs no trigger bypass - which
  // is exactly why the review pins a digest of the row as it read at decision time.
  run('UPDATE hermes_memory_candidates SET lesson=? WHERE id=?', ['a completely different lesson', candidate.id]);
  const read = readMemoryCandidateReview(reader, recorded.id);
  assert.ok(read, 'the review remains readable: it pinned the candidate, it does not re-read it');
  assert.equal(read.candidate.digest, recorded.candidate_digest, 'the pin still describes the reviewed content');
  assert.notEqual(digest([store.getMemoryCandidate(candidate.id)]), digest([candidate]), 'the candidate really did change');
});

test('recording a review leaves every candidate, routing, provider, approval, workflow, and scorecard table byte-identical', async () => {
  const candidates = await seedCandidates('m3c-inert', 2);
  const reader = principal('m3c-inert');
  const before = sideEffectSnapshot();
  const recorded = recordMemoryCandidateReview(reader, candidates[0].id, review({ decision: 'recommend_promote' }));
  assert.deepEqual(sideEffectSnapshot(), before, 'a recorded review changes no execution, approval, promotion, or routing state');
  readMemoryCandidateReview(reader, recorded.id);
  assert.deepEqual(sideEffectSnapshot(), before, 'a read changes nothing either');
  const reviewsBefore = digest(all('SELECT * FROM hermes_memory_candidate_reviews ORDER BY id'));
  assert.throws(() => recordMemoryCandidateReview(reader, candidates[1].id, review({ decision: 'promote', idempotencyKey: 'm3c-key-refused' })), /canonical review decision/);
  assert.deepEqual(sideEffectSnapshot(), before, 'a refused review changes nothing');
  assert.equal(digest(all('SELECT * FROM hermes_memory_candidate_reviews ORDER BY id')), reviewsBefore, 'a refused review writes no row');
  // Named directly as well as digested, so a reader sees the invariant and not only a hash compare.
  for (const candidate of all('SELECT status,promoted_at FROM hermes_memory_candidates')) {
    assert.equal(candidate.status, 'pending');
    assert.equal(candidate.promoted_at, null);
  }
});

test('reviews do not inform routing: an identical task routes identically before and after', async () => {
  const workspaceId = 'm3c-routing';
  const candidates = await seedCandidates(workspaceId, 1);
  const reader = principal(workspaceId);
  const beforeRun = await runHermesWorkflow(task(workspaceId, 'report current status', 'route-before'));
  const beforeRoute = store.getRoutingDecisions(beforeRun.runId).map(({ id: _id, run_id: _runId, task_id: _taskId, created_at: _createdAt, ...rest }) => rest);
  recordMemoryCandidateReview(reader, candidates[0].id, review({ decision: 'recommend_promote' }));
  const afterRun = await runHermesWorkflow(task(workspaceId, 'report current status', 'route-after'));
  const afterRoute = store.getRoutingDecisions(afterRun.runId).map(({ id: _id, run_id: _runId, task_id: _taskId, created_at: _createdAt, ...rest }) => rest);
  assert.ok(beforeRoute.length > 0, 'the fixture actually produced a routing decision to compare');
  assert.deepEqual(afterRoute, beforeRoute, 'an existing review must not change any later routing decision');
});

test('the memory-review module imports no router, executor, provider, health, memory, or scorecard surface', () => {
  const source = fs.readFileSync(new URL('../packages/hermes-orchestrator/memory-review.js', import.meta.url), 'utf8');
  const lines = source.split('\n');
  const imports = lines.filter((line) => line.startsWith('import '));
  assert.ok(imports.length > 0, 'the import scan actually found imports to check');
  // Comment lines are excluded: the module header legitimately describes what it must never do, and
  // scanning prose would make this assertion fail on its own documentation.
  const code = lines.filter((line) => !line.trim().startsWith('//')).join('\n');
  assert.ok(code.includes('recordMemoryCandidateReview'), 'the code scan actually found the module body');
  for (const forbidden of ['./route.js', './execute.js', './memory.js', './registries.js', './health.js', './orchestrator.js', './approvals.js', './scorecard.js', './adapters/']) {
    assert.ok(!imports.some((line) => line.includes(forbidden)), `memory-review.js must not import ${forbidden}`);
  }
  assert.doesNotMatch(code, /routeTask|runHermesWorkflow|upsertProviderHealth|insertMemoryCandidate\b|retrieveMemory|recallMemory/i, 'no routing, execution, provider-health, memory-write, or retrieval call exists');
  assert.doesNotMatch(code, /BLACKSPIRE_RUNTIME_MODE|BLACKSPIRE_GATE4|process\.env/, 'the review path reads no environment flag and cannot be switched into another mode');
  // No writer of any kind for the candidate table exists anywhere in the shipped code.
  const storeSource = fs.readFileSync(new URL('../packages/hermes-orchestrator/store.js', import.meta.url), 'utf8');
  assert.doesNotMatch(storeSource, /UPDATE hermes_memory_candidates|DELETE FROM hermes_memory_candidates/, 'no update or delete path for memory candidates exists');
  assert.doesNotMatch(storeSource, /UPDATE hermes_memory_candidate_reviews|DELETE FROM hermes_memory_candidate_reviews/, 'no update or delete helper for reviews exists');
});

test('a review is unaffected by whether the workspace has verified scorecards', async () => {
  const withScorecard = await seedCandidates('m3c-nocouple-a', 1);
  const without = await seedCandidates('m3c-nocouple-b', 1);
  const { deriveVerifiedScorecards } = await import('../packages/hermes-orchestrator/scorecard.js');
  const readerA = principal('m3c-nocouple-a');
  const evaluationA = store.getOutcomeEvaluationForRun(withScorecard[0].run_id, 'm3a-v1');
  deriveVerifiedScorecards(readerA, { workspaceId: 'm3c-nocouple-a', cutoff: { createdAt: evaluationA.created_at, id: evaluationA.id } });
  const a = recordMemoryCandidateReview(readerA, withScorecard[0].id, review());
  const b = recordMemoryCandidateReview(principal('m3c-nocouple-b'), without[0].id, review());
  // Same decision and rationale over structurally identical evidence: only the pinned subject
  // differs, so a scorecard's presence cannot have influenced the recorded content.
  assert.equal(a.decision, b.decision);
  assert.equal(a.review_version, b.review_version);
  assert.ok(all("SELECT id FROM hermes_verified_scorecards WHERE workspace_id='m3c-nocouple-a'").length > 0);
  assert.equal(all("SELECT id FROM hermes_verified_scorecards WHERE workspace_id='m3c-nocouple-b'").length, 0);
});

test('the workspace-scoped pending reader never returns another workspace', async () => {
  await seedCandidates('m3c-scoped-a', 2);
  await seedCandidates('m3c-scoped-b', 1);
  const scoped = store.getPendingMemoryCandidatesForWorkspace('m3c-scoped-a');
  assert.ok(scoped.length >= 2);
  assert.ok(scoped.every((candidate) => candidate.workspace_id === 'm3c-scoped-a'), 'the scoped reader is workspace-isolated');
  // Ordering is total: created_at is millisecond-resolution and ties are routine, so the id
  // tiebreak is what makes this deterministic rather than planner-dependent.
  const shuffled = [...scoped].reverse();
  const reordered = [...shuffled].sort((left, right) => (`${left.created_at} ${left.id}` < `${right.created_at} ${right.id}` ? -1 : 1));
  assert.notDeepEqual(shuffled, reordered, 'the fixture really was shuffled, so the comparison below is not vacuous');
  assert.deepEqual(reordered.map((row) => row.id), scoped.map((row) => row.id));
});

test('authorization is decided before any candidate or lineage work on the read path', () => {
  const source = fs.readFileSync(new URL('../packages/hermes-orchestrator/memory-review.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('export function readMemoryCandidateReview'));
  assert.ok(body.indexOf('canReadEvaluation') < body.indexOf('storedReviewIntact'),
    'an unauthorized caller must cause no digest or candidate work, so nothing about a review they cannot read is measurable');
});
