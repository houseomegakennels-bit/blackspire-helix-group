// Hermes M3C, second slice: re-review modelled as an explicit, immutable successor of a prior
// review or successor. No routing, provider execution, approval, memory-promotion, memory-retrieval,
// or production behavior is tested because none is permitted in this phase - and several tests below
// exist specifically to prove that appending a successor changes none of those tables, that
// `hermes_memory_candidates.status` and `promoted_at` are still never written, and that a successor
// inherits no authority whatsoever from the record it supersedes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-hermes-m3c-rr-'));
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'm3c-rereview.sqlite');
const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { upsertWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { createUnifiedInput } = await import('../packages/unified-input/unified.js');
const { getTask } = await import('../packages/task-engine/tasks.js');
const { runHermesWorkflow } = await import('../packages/hermes-orchestrator/orchestrator.js');
const store = await import('../packages/hermes-orchestrator/store.js');
const { run, get, all, execSql } = await import('../packages/task-engine/db.js');
const authz = await import('../packages/shared/authorization.js');
const { digest } = await import('../packages/shared/canonical.js');
const { recordMemoryCandidateReview, readMemoryCandidateReview, recordMemoryCandidateRereview,
  readMemoryCandidateRereview, MEMORY_REREVIEW_VERSION, MEMORY_REVIEW_DECISION_VERSION,
  INHERITED_CONTEXT_KEYS, MAX_REREVIEW_CHAIN_DEPTH } = await import('../packages/hermes-orchestrator/memory-review.js');

const authzNow = Date.now();
function principal(workspaceId, permissions = ['evaluation.read', 'evaluation.correct']) {
  const suffix = `${workspaceId}-${permissions.join('-')}`;
  const principalId = `m3crr-admin-${suffix}`; const grantId = `m3crr-grant-${suffix}`;
  if (!get('SELECT id FROM auth_principals WHERE id=?', [principalId])) {
    run('INSERT INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [principalId, 'admin', principalId, 'bearer', null, 'active', authzNow, null, null, null, 1, authzNow]);
    run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [grantId, principalId, workspaceId, 'viewer', JSON.stringify([...permissions].sort()), 'active', 1, null, authzNow, null, null, 'test', 1, authzNow]);
  }
  return authz.resolveAdminBearer(principalId);
}
function workspace(id) { upsertWorkspace({ id, name: id, githubRepository: 'local/m3c', defaultBranch: 'main', allowedPaths: ['docs'], buildCommands: [], providerPolicy: {}, riskLevel: 'low', budgetCents: 100, secretReferences: [], enabledTools: ['read'], lastHealthStatus: 'ok', rootPath: root }); }
function task(id, nonce = '') { const i = createUnifiedInput({ channel: 'jarvis', actorId: 'm3crr-user', channelKey: 'm3crr-user', workspaceId: id, text: 'report current status', idempotencyKey: `m3crr-${id}-${nonce}` }); return getTask(i.taskId); }
function withoutImmutability(tables, callback) {
  const marks = tables.map(() => '?').join(',');
  const triggers = all(`SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name IN (${marks}) ORDER BY name`, tables);
  for (const trigger of triggers) execSql(`DROP TRIGGER ${trigger.name}`);
  try { return callback(); } finally { for (const trigger of triggers) execSql(trigger.sql); }
}

// One workspace, one verified mock run, one pending candidate, one recorded ROOT review, and an
// admin holding both `evaluation.read` and `evaluation.correct` in that workspace.
let seq = 0;
async function seedChain(workspaceId) {
  workspace(workspaceId);
  const result = await runHermesWorkflow(task(workspaceId, String(seq += 1)));
  const [candidate] = store.getMemoryCandidates(result.runId);
  assert.ok(candidate, 'the seeded run must produce a memory candidate');
  const admin = principal(workspaceId);
  const rootReview = recordMemoryCandidateReview(admin, candidate.id, {
    decision: 'reject', rationale: 'the lesson restates the task text and adds nothing', idempotencyKey: `${workspaceId}-root-key`,
  });
  return { candidate, rootReview, admin };
}
const rereview = (supersedes, overrides = {}) => ({ supersedes, decision: 'recommend_promote', rationale: 'a later run showed the lesson generalises beyond the original task', idempotencyKey: 'rr-key-1', ...overrides });

// Byte-identical state across these tables proves a successor had no execution, approval, promotion,
// or routing effect. `hermes_memory_candidates` is the load-bearing entry: it carries `status` and
// `promoted_at`, so pinning it byte-for-byte is what proves nothing was promoted.
// `hermes_memory_candidate_reviews` is the second: pinning it proves the historical ROOT review row
// was not overwritten to represent the re-review.
const SIDE_EFFECT_TABLES = [['hermes_memory_candidates', 'id'], ['hermes_memory_candidate_reviews', 'id'], ['hermes_routing_decisions', 'id'], ['hermes_policy_decisions', 'id'], ['hermes_provider_invocations', 'id'], ['hermes_provider_health', 'provider'], ['hermes_approvals', 'id'], ['approvals', 'id'], ['hermes_workflow_runs', 'id'], ['hermes_workflow_steps', 'id'], ['hermes_verification_results', 'id'], ['hermes_outcome_evaluations', 'id'], ['hermes_outcome_evaluation_components', 'id'], ['hermes_outcome_corrections', 'id'], ['hermes_outcome_source_events', 'id'], ['hermes_verified_scorecards', 'id'], ['hermes_verified_scorecard_sources', 'id'], ['tasks', 'id']];
function sideEffectSnapshot() {
  const snapshot = Object.fromEntries(SIDE_EFFECT_TABLES.map(([table, key]) => [table, digest(all(`SELECT * FROM ${table} ORDER BY ${key}`))]));
  snapshot.__schema = digest(all('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name,tbl_name'));
  return snapshot;
}
const rereviewRow = (id) => get('SELECT * FROM hermes_memory_candidate_rereviews WHERE id=?', [id]);
// Workspace-scoped: every test in this file shares one database, so a global count would measure
// other tests' rows rather than this one's.
const rereviewCount = (workspaceId) => get('SELECT COUNT(*) AS n FROM hermes_memory_candidate_rereviews WHERE workspace_id=?', [workspaceId]).n;

// --- Positive: valid successor and re-review creation ---

test('a successor records a new independent decision and links to the root review without touching it', async () => {
  const { candidate, rootReview, admin } = await seedChain('m3crr-happy');
  const rootBefore = readMemoryCandidateReview(admin, rootReview.id);
  const before = sideEffectSnapshot();

  const successor = recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id));

  assert.equal(successor.chain_version, 1);
  assert.equal(successor.root_review_id, rootReview.id);
  assert.equal(successor.supersedes_rereview_id, null, 'the first successor supersedes the root review, which lives in the other table');
  assert.equal(successor.candidate_id, candidate.id);
  assert.equal(successor.workspace_id, 'm3crr-happy');
  assert.equal(successor.rereview_version, MEMORY_REREVIEW_VERSION);
  assert.equal(successor.decision_version, MEMORY_REVIEW_DECISION_VERSION);
  // The successor's decision is the caller's, not the predecessor's.
  assert.equal(rootReview.decision, 'reject');
  assert.equal(successor.decision, 'recommend_promote');
  // The predecessor is pinned exactly as it read.
  assert.equal(successor.predecessor_content_digest, rootReview.content_digest);
  assert.equal(successor.predecessor_lineage_digest, rootReview.lineage_digest);

  // Nothing historical moved: the root review row, the candidate row, and every other table are
  // byte-identical, and the root review still reads back exactly as before.
  assert.deepEqual(sideEffectSnapshot(), before);
  assert.deepEqual(readMemoryCandidateReview(admin, rootReview.id), rootBefore);
});

test('a chain extends to bounded depth, each successor superseding the previous one', async () => {
  const { rootReview, admin } = await seedChain('m3crr-depth');
  const first = recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'depth-1' }));
  const second = recordMemoryCandidateRereview(admin, rootReview.id, rereview(first.id, { decision: 'defer_needs_evidence', rationale: 'the supporting run was later rolled back', idempotencyKey: 'depth-2' }));
  const third = recordMemoryCandidateRereview(admin, rootReview.id, rereview(second.id, { decision: 'reject', rationale: 'the rollback was confirmed as a genuine regression', idempotencyKey: 'depth-3' }));

  assert.deepEqual([first.chain_version, second.chain_version, third.chain_version], [1, 2, 3]);
  assert.deepEqual([first.supersedes_rereview_id, second.supersedes_rereview_id, third.supersedes_rereview_id], [null, first.id, second.id]);
  assert.equal(second.predecessor_content_digest, first.content_digest);
  assert.equal(third.predecessor_lineage_digest, second.lineage_digest);
  // Deterministic replay order: the chain reads back in gap-free chain_version order.
  assert.deepEqual(store.getMemoryCandidateRereviewChain(rootReview.id).map((row) => [Number(row.chain_version), row.id]),
    [[1, first.id], [2, second.id], [3, third.id]]);
  // Every link is independently readable and self-describing.
  for (const row of [first, second, third]) assert.ok(readMemoryCandidateRereview(admin, row.id));
});

test('the read surface exposes the chain link, the predecessor pin, and the carried context', async () => {
  const { candidate, rootReview, admin } = await seedChain('m3crr-read');
  const successor = recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'read-1' }));
  const read = readMemoryCandidateRereview(admin, successor.id);

  assert.equal(read.id, successor.id);
  assert.equal(read.chainVersion, 1);
  assert.equal(read.rootReviewId, rootReview.id);
  assert.deepEqual(read.predecessor, { id: rootReview.id, kind: 'review', contentDigest: rootReview.content_digest, lineageDigest: rootReview.lineage_digest });
  assert.equal(read.candidateId, candidate.id);
  assert.equal(read.decision, 'recommend_promote');
  assert.equal(read.reviewerPrincipalId, admin.principalId);
  assert.deepEqual(read.inheritedContext.keys, [...INHERITED_CONTEXT_KEYS]);
  assert.equal(read.inheritedContext.provenance.predecessorId, rootReview.id);
  assert.equal(read.inheritedContext.provenance.predecessorKind, 'review');
});

// --- Inheritance: a successor inherits context, never authority ---

test('a successor carries only allowlisted subject identity, with provenance, and no authority', async () => {
  const { candidate, rootReview, admin } = await seedChain('m3crr-inherit');
  const successor = recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'inherit-1' }));
  const inherited = JSON.parse(successor.inherited_context);

  assert.deepEqual(Object.keys(inherited.values).sort(), [...INHERITED_CONTEXT_KEYS].sort());
  assert.deepEqual(inherited.values, {
    candidateId: candidate.id, runId: candidate.run_id, taskId: candidate.task_id,
    candidateKind: candidate.kind, candidateScope: candidate.scope,
  });
  assert.deepEqual(inherited.provenance, {
    predecessorId: rootReview.id, predecessorKind: 'review', predecessorChainVersion: 0,
    predecessorContentDigest: rootReview.content_digest, predecessorLineageDigest: rootReview.lineage_digest,
  });
  // No judgement-bearing or authority-bearing value reached the carried context, at any depth.
  const serialised = successor.inherited_context;
  for (const denied of ['decision', 'rationale', 'approval', 'authoriz', 'scorecard', 'promot', 'status', 'correctness', 'verified']) {
    assert.ok(!serialised.includes(denied), `inherited context must not carry ${denied}`);
  }
  assert.ok(!serialised.includes(rootReview.decision));
  assert.ok(!serialised.includes(rootReview.rationale));
});

test('a successor requires a new independent decision and rationale rather than inheriting them', async () => {
  const { rootReview, admin } = await seedChain('m3crr-fresh');
  for (const missing of [{ decision: undefined }, { rationale: undefined }, { rationale: '   ' }, { decision: 'promote' }, { decision: 'approve' }]) {
    assert.throws(() => recordMemoryCandidateRereview(admin, rootReview.id, { ...rereview(rootReview.id, { idempotencyKey: 'fresh-1' }), ...missing }),
      /requires a canonical review decision|requires a rationale|requires a canonical predecessor id/);
  }
  assert.equal(rereviewCount('m3crr-fresh'), 0, 'no successor may be written by a call that supplied no fresh decision');
});

test('a successor of a recommend_promote predecessor promotes nothing and grants no eligibility', async () => {
  const { candidate, rootReview, admin } = await seedChain('m3crr-noeligibility');
  // Root recorded `reject`; the successor recommends promotion. Even so, nothing is promoted.
  const successor = recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'nopromote-1' }));
  const chained = recordMemoryCandidateRereview(admin, rootReview.id, rereview(successor.id, { decision: 'recommend_promote', rationale: 'a second reviewer independently reached the same conclusion', idempotencyKey: 'nopromote-2' }));
  assert.equal(chained.chain_version, 2);
  const after = get('SELECT status,promoted_at FROM hermes_memory_candidates WHERE id=?', [candidate.id]);
  assert.deepEqual(after, { status: 'pending', promoted_at: null });
  // No promoted-memory table was created by any of this.
  assert.equal(get("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name LIKE '%promot%'").n, 0);
});

// --- Negative: self-links, cycles, forks, ambiguous and invalid ancestry ---

test('a successor cannot link to itself', async () => {
  const { rootReview, admin } = await seedChain('m3crr-self');
  const successor = recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'self-1' }));
  // Through the service, self-linking is unreachable by construction: a row's own id does not exist
  // when its predecessor is chosen, and the head rule refuses every other candidate predecessor.
  const second = recordMemoryCandidateRereview(admin, rootReview.id, rereview(successor.id, { decision: 'reject', rationale: 'a second look at the same lesson', idempotencyKey: 'self-2' }));
  for (const row of [successor, second]) {
    assert.notEqual(row.supersedes_rereview_id, row.id);
    assert.notEqual(row.root_review_id, row.id);
  }
  // And the database refuses a self-link outright, so no direct writer can create one either.
  assert.throws(() => run('INSERT INTO hermes_memory_candidate_rereviews SELECT id,rereview_version,decision_version,root_review_id,id,chain_version+9,candidate_id,workspace_id,run_id,task_id,decision,rationale,candidate_kind,candidate_scope,candidate_status_at_review,candidate_digest,evaluation_id,evaluation_version,provenance_digest,predecessor_content_digest,predecessor_lineage_digest,inherited_context,reviewer_principal_id,idempotency_key||\'-self\',content_digest,lineage_digest,created_at FROM hermes_memory_candidate_rereviews WHERE id=?', [successor.id]),
    /CHECK constraint failed|UNIQUE constraint failed/);
});

test('a cycle is unreadable even when written directly around the service', async () => {
  const { rootReview, admin } = await seedChain('m3crr-cycle');
  const first = recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'cycle-1' }));
  const second = recordMemoryCandidateRereview(admin, rootReview.id, rereview(first.id, { decision: 'reject', rationale: 'later evidence contradicted the recommendation', idempotencyKey: 'cycle-2' }));
  const third = recordMemoryCandidateRereview(admin, rootReview.id, rereview(second.id, { decision: 'defer_needs_evidence', rationale: 'the contradicting run is itself under verification', idempotencyKey: 'cycle-3' }));
  assert.ok(readMemoryCandidateRereview(admin, third.id), 'the honest chain reads before it is corrupted');
  // A depth-1 cycle is already unwritable: the chain_version/supersedes CHECK forbids depth 1 from
  // naming any predecessor at all. So close the cycle deeper, between depths 2 and 3, where only the
  // application-level ancestry check stands. Reachable only by dropping the immutability triggers,
  // which is exactly the adversary this check exists to detect.
  assert.throws(() => withoutImmutability(['hermes_memory_candidate_rereviews'], () => {
    run('UPDATE hermes_memory_candidate_rereviews SET supersedes_rereview_id=? WHERE id=?', [second.id, first.id]);
  }), /CHECK constraint failed/);
  withoutImmutability(['hermes_memory_candidate_rereviews'], () => {
    run('UPDATE hermes_memory_candidate_rereviews SET supersedes_rereview_id=? WHERE id=?', [third.id, second.id]);
  });
  assert.equal(readMemoryCandidateRereview(admin, second.id), null, 'a row in a cycle is unreadable');
  assert.equal(readMemoryCandidateRereview(admin, third.id), null, 'its descendant is unreadable too');
  assert.throws(() => recordMemoryCandidateRereview(admin, rootReview.id, rereview(third.id, { decision: 'reject', rationale: 'an append onto a cyclic chain', idempotencyKey: 'cycle-4' })),
    /invalid predecessor chain|intact predecessor/);
});

test('a fork off the same predecessor is refused by the service and independently by the database', async () => {
  const { rootReview, admin } = await seedChain('m3crr-fork');
  const first = recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'fork-1' }));
  // A second successor naming the ROOT as predecessor would be a sibling of `first`.
  assert.throws(() => recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { decision: 'reject', rationale: 'an independent reviewer disagreed', idempotencyKey: 'fork-2' })),
    /stale or conflicting predecessor/);
  assert.equal(rereviewCount('m3crr-fork'), 1);
  // The UNIQUE(root_review_id,chain_version) index forbids the sibling even for a direct writer, so
  // the service check is a better error message rather than the only defence.
  assert.throws(() => run('INSERT INTO hermes_memory_candidate_rereviews SELECT ?,rereview_version,decision_version,root_review_id,supersedes_rereview_id,chain_version,candidate_id,workspace_id,run_id,task_id,decision,rationale,candidate_kind,candidate_scope,candidate_status_at_review,candidate_digest,evaluation_id,evaluation_version,provenance_digest,predecessor_content_digest,predecessor_lineage_digest,inherited_context,reviewer_principal_id,?,content_digest,lineage_digest,created_at FROM hermes_memory_candidate_rereviews WHERE id=?', ['hmrrev-fork', 'fork-sibling', first.id]),
    /UNIQUE constraint failed/);
});

test('an ambiguous depth-one row that also names a predecessor is refused by the database', async () => {
  const { rootReview, admin } = await seedChain('m3crr-ambiguous');
  const first = recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'ambig-1' }));
  // chain_version 1 must supersede the root and name no successor. Claiming both is ambiguous ancestry.
  assert.throws(() => run('INSERT INTO hermes_memory_candidate_rereviews SELECT ?,rereview_version,decision_version,root_review_id,?,1,candidate_id,workspace_id,run_id,task_id,decision,rationale,candidate_kind,candidate_scope,candidate_status_at_review,candidate_digest,evaluation_id,evaluation_version,provenance_digest,predecessor_content_digest,predecessor_lineage_digest,inherited_context,reviewer_principal_id,?,content_digest,lineage_digest,created_at FROM hermes_memory_candidate_rereviews WHERE id=?', ['hmrrev-ambig', first.id, 'ambig-2', first.id]),
    /CHECK constraint failed|UNIQUE constraint failed/);
  // The mirror shape is refused too: a row deeper than 1 that names no predecessor at all. Between
  // them these two CHECKs are what make ancestry unambiguous at every depth.
  assert.throws(() => run('INSERT INTO hermes_memory_candidate_rereviews SELECT ?,rereview_version,decision_version,root_review_id,NULL,2,candidate_id,workspace_id,run_id,task_id,decision,rationale,candidate_kind,candidate_scope,candidate_status_at_review,candidate_digest,evaluation_id,evaluation_version,provenance_digest,predecessor_content_digest,predecessor_lineage_digest,inherited_context,reviewer_principal_id,?,content_digest,lineage_digest,created_at FROM hermes_memory_candidate_rereviews WHERE id=?', ['hmrrev-ambig2', 'ambig-3', first.id]),
    /CHECK constraint failed|UNIQUE constraint failed/);
  // An existing row cannot be edited into either shape either: CHECK constraints bind UPDATE too,
  // even with the immutability triggers removed.
  assert.throws(() => withoutImmutability(['hermes_memory_candidate_rereviews'], () => run('UPDATE hermes_memory_candidate_rereviews SET chain_version=2 WHERE id=?', [first.id])),
    /CHECK constraint failed/);
});

test('a gap in the chain makes the descendant unreadable and refuses further appends', async () => {
  const { rootReview, admin } = await seedChain('m3crr-gap');
  const first = recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'gap-1' }));
  const second = recordMemoryCandidateRereview(admin, rootReview.id, rereview(first.id, { decision: 'reject', rationale: 'later evidence contradicted the recommendation', idempotencyKey: 'gap-2' }));
  // Excise the middle of the chain. Only reachable with the triggers dropped.
  withoutImmutability(['hermes_memory_candidate_rereviews'], () => run('DELETE FROM hermes_memory_candidate_rereviews WHERE id=?', [first.id]));
  assert.equal(readMemoryCandidateRereview(admin, second.id), null, 'a successor whose named predecessor is gone is unreadable');
  assert.throws(() => recordMemoryCandidateRereview(admin, rootReview.id, rereview(second.id, { decision: 'reject', rationale: 'a third reviewer looked again', idempotencyKey: 'gap-3' })),
    /invalid predecessor chain|intact predecessor/);
});

test('a successor whose predecessor pin no longer matches the record it names is unreadable', async () => {
  const { rootReview, admin } = await seedChain('m3crr-pin');
  const successor = recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'pin-1' }));
  assert.ok(readMemoryCandidateRereview(admin, successor.id));
  withoutImmutability(['hermes_memory_candidate_rereviews'], () => {
    run('UPDATE hermes_memory_candidate_rereviews SET predecessor_content_digest=? WHERE id=?', [digest('not the predecessor'), successor.id]);
  });
  assert.equal(readMemoryCandidateRereview(admin, successor.id), null);
});

test('a chain rooted in a corrupted root review refuses to grow and reads as absent', async () => {
  const { rootReview, admin } = await seedChain('m3crr-badroot');
  const successor = recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'badroot-1' }));
  withoutImmutability(['hermes_memory_candidate_reviews'], () => {
    run('UPDATE hermes_memory_candidate_reviews SET rationale=? WHERE id=?', ['a rationale nobody recorded', rootReview.id]);
  });
  assert.equal(readMemoryCandidateReview(admin, rootReview.id), null, 'the tampered root is already unreadable');
  assert.equal(readMemoryCandidateRereview(admin, successor.id), null, 'and so is everything descended from it');
  assert.throws(() => recordMemoryCandidateRereview(admin, rootReview.id, rereview(successor.id, { decision: 'reject', rationale: 'another look at the same lesson', idempotencyKey: 'badroot-2' })),
    /requires an intact root review/);
});

test('an absent or malformed root review refuses with the same message as an unauthorized one', async () => {
  const { admin } = await seedChain('m3crr-absent');
  const absent = 'hmrev-does-not-exist';
  assert.throws(() => recordMemoryCandidateRereview(admin, absent, rereview(absent, { idempotencyKey: 'absent-1' })),
    /memory candidate re-review is not authorized/);
  for (const malformed of [null, '', 'not a canonical id!', 'x'.repeat(129)]) {
    assert.throws(() => recordMemoryCandidateRereview(admin, malformed, rereview('hmrev-x', { idempotencyKey: 'absent-2' })),
      /requires a canonical root review id/);
  }
});

// --- Negative: workspace and tenant isolation ---

test('a principal granted in another workspace cannot append to, or read, this chain', async () => {
  const { rootReview, admin } = await seedChain('m3crr-tenant-a');
  await seedChain('m3crr-tenant-b');
  const outsider = principal('m3crr-tenant-b');
  assert.notEqual(outsider.principalId, admin.principalId);

  // Refuses with the SAME message an absent root gets, so a foreign principal cannot use this call
  // to learn that the review id exists in some other workspace.
  assert.throws(() => recordMemoryCandidateRereview(outsider, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'tenant-1' })),
    /memory candidate re-review is not authorized/);
  assert.equal(rereviewCount('m3crr-tenant-a'), 0);

  const successor = recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'tenant-2' }));
  assert.equal(readMemoryCandidateRereview(outsider, successor.id), null, 'a cross-workspace read is indistinguishable from absent');
  assert.ok(readMemoryCandidateRereview(admin, successor.id));
});

test('a successor whose workspace or candidate drifted away from its root is unreadable', async () => {
  const { rootReview, admin } = await seedChain('m3crr-drift');
  const other = await seedChain('m3crr-drift-other');
  const successor = recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'drift-1' }));

  withoutImmutability(['hermes_memory_candidate_rereviews'], () => run('UPDATE hermes_memory_candidate_rereviews SET workspace_id=? WHERE id=?', ['m3crr-drift-other', successor.id]));
  // Read as the principal who IS granted in the workspace the row drifted INTO. Reading as the
  // original owner would be refused by authorization alone and would never exercise the structural
  // check: the row must be unreadable because its chain crosses a boundary, not merely because this
  // particular caller lacks a grant.
  assert.equal(readMemoryCandidateRereview(other.admin, successor.id), null, 'a chain may not cross a workspace boundary');
  assert.equal(readMemoryCandidateRereview(admin, successor.id), null);
  withoutImmutability(['hermes_memory_candidate_rereviews'], () => run('UPDATE hermes_memory_candidate_rereviews SET workspace_id=?, candidate_id=? WHERE id=?', ['m3crr-drift', other.candidate.id, successor.id]));
  assert.equal(readMemoryCandidateRereview(admin, successor.id), null, 'a chain may not change which candidate it reviews');
  // And the same drift refuses a further append rather than being silently extended.
  assert.throws(() => recordMemoryCandidateRereview(admin, rootReview.id, rereview(successor.id, { decision: 'reject', rationale: 'an append onto a drifted chain', idempotencyKey: 'drift-2' })),
    /refuses a predecessor for a different candidate|intact predecessor|invalid predecessor chain/);
});

test('a successor cannot be linked to a root review belonging to a different candidate chain', async () => {
  const a = await seedChain('m3crr-crosschain-a');
  const b = await seedChain('m3crr-crosschain-b');
  const successorB = recordMemoryCandidateRereview(b.admin, b.rootReview.id, rereview(b.rootReview.id, { idempotencyKey: 'crosschain-1' }));
  // `successorB` is not in chain A, so naming it as A's predecessor is a conflicting predecessor -
  // and the cross-workspace grant refuses first regardless.
  assert.throws(() => recordMemoryCandidateRereview(a.admin, a.rootReview.id, rereview(successorB.id, { idempotencyKey: 'crosschain-2' })),
    /stale or conflicting predecessor/);
});

// --- Negative: authorization ---

test('appending a successor requires the write-capable evaluation.correct, not merely evaluation.read', async () => {
  const { rootReview } = await seedChain('m3crr-readonly');
  const viewer = principal('m3crr-readonly', ['evaluation.read']);
  assert.throws(() => recordMemoryCandidateRereview(viewer, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'readonly-1' })),
    /memory candidate re-review is not authorized/);
  assert.equal(rereviewCount('m3crr-readonly'), 0);
});

test('a grant revoked after the audited decision refuses before anything is written', async () => {
  const { rootReview, admin } = await seedChain('m3crr-revoked');
  run('UPDATE auth_workspace_grants SET status=? WHERE principal_id=?', ['revoked', admin.principalId]);
  try {
    assert.throws(() => recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'revoked-1' })),
      /memory candidate re-review is not authorized/);
    assert.equal(rereviewCount('m3crr-revoked'), 0);
  } finally { run('UPDATE auth_workspace_grants SET status=? WHERE principal_id=?', ['active', admin.principalId]); }
});

test('the reviewer is the server-resolved principal and can never be supplied by the caller', async () => {
  const { rootReview, admin } = await seedChain('m3crr-reviewer');
  const successor = recordMemoryCandidateRereview(admin, rootReview.id, { ...rereview(rootReview.id, { idempotencyKey: 'reviewer-1' }), reviewerPrincipalId: 'somebody-else', reviewer_principal_id: 'somebody-else' });
  assert.equal(successor.reviewer_principal_id, admin.principalId);
});

// --- Negative: stale predecessor, duplicates, and idempotency ---

test('naming a superseded ancestor as the predecessor is refused as stale', async () => {
  const { rootReview, admin } = await seedChain('m3crr-stale');
  const first = recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'stale-1' }));
  recordMemoryCandidateRereview(admin, rootReview.id, rereview(first.id, { decision: 'reject', rationale: 'later evidence contradicted the recommendation', idempotencyKey: 'stale-2' }));
  // The root and the depth-1 row are both now superseded ancestors.
  for (const stale of [rootReview.id, first.id]) {
    assert.throws(() => recordMemoryCandidateRereview(admin, rootReview.id, rereview(stale, { decision: 'reject', rationale: 'a reviewer working from a stale view of the chain', idempotencyKey: `stale-${stale}` })),
      /stale or conflicting predecessor/);
  }
  assert.equal(rereviewCount('m3crr-stale'), 2);
});

test('replaying one idempotency key with identical content returns the stored row and writes nothing', async () => {
  const { rootReview, admin } = await seedChain('m3crr-replay');
  const first = recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'replay-1' }));
  const replayed = recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'replay-1' }));
  assert.deepEqual(replayed, rereviewRow(first.id));
  assert.equal(rereviewCount('m3crr-replay'), 1, 'a replay must not append a second row');
});

test('reusing one idempotency key with different content is an integrity conflict, never an overwrite', async () => {
  const { rootReview, admin } = await seedChain('m3crr-conflict');
  const first = recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'conflict-1' }));
  const stored = rereviewRow(first.id);
  for (const different of [{ decision: 'reject' }, { rationale: 'a different reason entirely' }]) {
    assert.throws(() => recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'conflict-1', ...different })),
      /identity conflicts with stored decision/);
  }
  assert.deepEqual(rereviewRow(first.id), stored, 'the stored row is untouched by the conflicting call');
  assert.equal(rereviewCount('m3crr-conflict'), 1);
});

test('two re-reviewers racing the same head produce one successor and one explicit refusal', async () => {
  const { rootReview, admin } = await seedChain('m3crr-race');
  // Both callers read the same head (the root) and then both attempt to append.
  const winner = recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'race-1' }));
  assert.throws(() => recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { decision: 'reject', rationale: 'the loser of the race reached the opposite conclusion', idempotencyKey: 'race-2' })),
    /stale or conflicting predecessor/);
  assert.equal(rereviewCount('m3crr-race'), 1);
  assert.equal(store.getMemoryCandidateRereviewHead(rootReview.id).id, winner.id);
});

// --- Negative: the subject is revalidated from scratch, never inherited ---

test('a candidate that stopped being pending is no longer re-reviewable even though its root review exists', async () => {
  const { candidate, rootReview, admin } = await seedChain('m3crr-notpending');
  // The Milestone 1 candidate table carries no immutability triggers, which is precisely why the
  // subject is revalidated on every append rather than trusted from the predecessor.
  run('UPDATE hermes_memory_candidates SET status=? WHERE id=?', ['promoted', candidate.id]);
  try {
    assert.throws(() => recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'notpending-1' })),
      /refuses a candidate that is not pending/);
    assert.equal(rereviewCount('m3crr-notpending'), 0);
  } finally { run('UPDATE hermes_memory_candidates SET status=? WHERE id=?', ['pending', candidate.id]); }
});

test('a candidate deleted out from under an existing root review refuses a successor', async () => {
  const { candidate, rootReview, admin } = await seedChain('m3crr-missingsubject');
  const saved = get('SELECT * FROM hermes_memory_candidates WHERE id=?', [candidate.id]);
  run('DELETE FROM hermes_memory_candidates WHERE id=?', [candidate.id]);
  try {
    assert.throws(() => recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'missing-1' })),
      /requires an existing candidate/);
  } finally {
    const columns = Object.keys(saved);
    run(`INSERT INTO hermes_memory_candidates(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`, columns.map((column) => saved[column]));
  }
});

// --- Regression: historical records stay immutable ---

test('the database refuses every update and delete against both review tables', async () => {
  const { rootReview, admin } = await seedChain('m3crr-immutable');
  const successor = recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'immutable-1' }));
  assert.throws(() => run('UPDATE hermes_memory_candidate_reviews SET decision=? WHERE id=?', ['recommend_promote', rootReview.id]), /immutable memory candidate review/);
  assert.throws(() => run('DELETE FROM hermes_memory_candidate_reviews WHERE id=?', [rootReview.id]), /immutable memory candidate review/);
  assert.throws(() => run('UPDATE hermes_memory_candidate_rereviews SET decision=? WHERE id=?', ['reject', successor.id]), /immutable memory candidate rereview/);
  assert.throws(() => run('DELETE FROM hermes_memory_candidate_rereviews WHERE id=?', [successor.id]), /immutable memory candidate rereview/);
});

test('appending a whole chain leaves every historical record byte-identical', async () => {
  const { rootReview, admin } = await seedChain('m3crr-history');
  const before = sideEffectSnapshot();
  const first = recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'history-1' }));
  const firstRow = rereviewRow(first.id);
  const second = recordMemoryCandidateRereview(admin, rootReview.id, rereview(first.id, { decision: 'reject', rationale: 'later evidence contradicted the recommendation', idempotencyKey: 'history-2' }));
  recordMemoryCandidateRereview(admin, rootReview.id, rereview(second.id, { decision: 'defer_needs_evidence', rationale: 'the contradicting run is itself under verification', idempotencyKey: 'history-3' }));
  // The root review, the candidate, and every unrelated table are exactly as they were, and the
  // depth-1 successor is exactly as it was written.
  assert.deepEqual(sideEffectSnapshot(), before);
  assert.deepEqual(rereviewRow(first.id), firstRow);
});

// --- Isolation, reached directly rather than through an authorization refusal ---
//
// The tests above prove a foreign principal is refused, but that refusal happens at authorization,
// before any isolation check runs. These three drive the same forgeries from an AUTHORIZED caller,
// which is the only way to reach the cross-workspace and cross-candidate guards themselves.

test('an authorized caller cannot append when the candidate drifted into another workspace', async () => {
  const { candidate, rootReview, admin } = await seedChain('m3crr-xwscand');
  workspace('m3crr-xwscand-other');
  // `hermes_memory_candidates` carries no immutability triggers, so this needs no trigger removal -
  // which is exactly why the append path revalidates the candidate's workspace rather than trusting
  // the root review's.
  run('UPDATE hermes_memory_candidates SET workspace_id=? WHERE id=?', ['m3crr-xwscand-other', candidate.id]);

  assert.throws(() => recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'xwscand-1' })),
    /refuses a cross-workspace candidate/);
  assert.equal(rereviewCount('m3crr-xwscand'), 0);
});

test('an authorized caller cannot extend a chain whose head drifted into another workspace', async () => {
  const { rootReview, admin } = await seedChain('m3crr-xwshead');
  workspace('m3crr-xwshead-other');
  const first = recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'xwshead-1' }));
  // `workspace_id` is deliberately not covered by either digest - it is structural, not content - so
  // this forgery leaves the row reproducing its own digests and is caught only by the explicit
  // workspace binding.
  withoutImmutability(['hermes_memory_candidate_rereviews'], () => {
    run('UPDATE hermes_memory_candidate_rereviews SET workspace_id=? WHERE id=?', ['m3crr-xwshead-other', first.id]);
  });

  assert.throws(() => recordMemoryCandidateRereview(admin, rootReview.id, rereview(first.id, { decision: 'reject', rationale: 'an append onto a head that changed workspace', idempotencyKey: 'xwshead-2' })),
    /refuses a cross-workspace predecessor/);
  assert.equal(readMemoryCandidateRereview(admin, first.id), null, 'the drifted head is unreadable too');
});

test('an authorized caller cannot extend a chain whose head names a different candidate', async () => {
  const { rootReview, admin } = await seedChain('m3crr-xcand');
  const first = recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'xcand-1' }));
  withoutImmutability(['hermes_memory_candidate_rereviews'], () => {
    run('UPDATE hermes_memory_candidate_rereviews SET candidate_id=? WHERE id=?', ['hmcand-some-other-candidate', first.id]);
  });

  assert.throws(() => recordMemoryCandidateRereview(admin, rootReview.id, rereview(first.id, { decision: 'reject', rationale: 'an append onto a head that changed subject', idempotencyKey: 'xcand-2' })),
    /refuses a predecessor for a different candidate/);
});

test('a refused append is audited before the transaction, so the denial survives the rollback', async () => {
  const { rootReview } = await seedChain('m3crr-audit');
  // Holds `evaluation.read` but not the write-capable `evaluation.correct`.
  const reader = principal('m3crr-audit', ['evaluation.read']);
  const deniedBefore = get('SELECT COUNT(*) AS n FROM auth_decisions WHERE workspace_id=? AND allowed=0', ['m3crr-audit']).n;

  assert.throws(() => recordMemoryCandidateRereview(reader, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'audit-1' })),
    /is not authorized/);

  // The audited denial is durable: it is decided before the transaction opens, so the rollback that
  // the refusal triggers cannot erase it. An in-transaction-only check would leave no trace.
  assert.ok(get('SELECT COUNT(*) AS n FROM auth_decisions WHERE workspace_id=? AND allowed=0', ['m3crr-audit']).n > deniedBefore,
    'the denial must be audited durably');
  assert.equal(rereviewCount('m3crr-audit'), 0);
});

// --- Bounded ancestry ---

test('a chain refuses to grow past the maximum depth, and the bound is enforced before validation', async () => {
  const { rootReview, admin } = await seedChain('m3crr-bound');
  let head = rootReview.id;
  for (let depth = 1; depth <= MAX_REREVIEW_CHAIN_DEPTH; depth += 1) {
    head = recordMemoryCandidateRereview(admin, rootReview.id, rereview(head, { idempotencyKey: `bound-${depth}` })).id;
  }
  const depthReached = Number(store.getMemoryCandidateRereviewHead(rootReview.id).chain_version);
  assert.equal(depthReached, MAX_REREVIEW_CHAIN_DEPTH, 'the chain must reach exactly the bound');
  const before = rereviewCount('m3crr-bound');

  assert.throws(() => recordMemoryCandidateRereview(admin, rootReview.id, rereview(head, { idempotencyKey: 'bound-over' })),
    /refuses a chain beyond the maximum depth/);

  // The refusal wrote nothing, and the chain at the bound is still fully readable.
  assert.equal(rereviewCount('m3crr-bound'), before);
  assert.ok(readMemoryCandidateRereview(admin, head));
});

test('a successor written around the service past the maximum depth is unreadable', async () => {
  const { rootReview, admin } = await seedChain('m3crr-overdepth');
  const first = recordMemoryCandidateRereview(admin, rootReview.id, rereview(rootReview.id, { idempotencyKey: 'overdepth-1' }));
  assert.ok(readMemoryCandidateRereview(admin, first.id), 'the in-bound successor reads before the forgery');

  // Forge a row whose depth exceeds the bound. Its own digests are irrelevant: the read side must
  // refuse on depth alone, so a database-write actor cannot reintroduce unbounded ancestry work.
  const forged = { ...rereviewRow(first.id), id: 'hmrrev-overdepth-forged', chain_version: MAX_REREVIEW_CHAIN_DEPTH + 1,
    supersedes_rereview_id: first.id, idempotency_key: 'overdepth-forged' };
  withoutImmutability(['hermes_memory_candidate_rereviews'], () => store.insertMemoryCandidateRereview(forged));

  assert.equal(readMemoryCandidateRereview(admin, forged.id), null);
  // The legitimate part of the chain is unaffected.
  assert.ok(readMemoryCandidateRereview(admin, first.id));
});

// --- Boundary: the slice activates nothing ---

test('the module and its route expose no writer for candidates, no promotion, and no mutating route', async () => {
  const source = fs.readFileSync(new URL('../packages/hermes-orchestrator/memory-review.js', import.meta.url), 'utf8');
  const storeSource = fs.readFileSync(new URL('../packages/hermes-orchestrator/store.js', import.meta.url), 'utf8');
  const serverSource = fs.readFileSync(new URL('../apps/api/server.js', import.meta.url), 'utf8');
  // No UPDATE or DELETE is issued anywhere against the candidate or review tables.
  for (const forbidden of [/UPDATE\s+hermes_memory_candidates/i, /DELETE\s+FROM\s+hermes_memory_candidates/i,
    /UPDATE\s+hermes_memory_candidate_reviews/i, /DELETE\s+FROM\s+hermes_memory_candidate_reviews/i,
    /UPDATE\s+hermes_memory_candidate_rereviews/i, /DELETE\s+FROM\s+hermes_memory_candidate_rereviews/i]) {
    assert.ok(!forbidden.test(source), `memory-review.js must not issue ${forbidden}`);
    assert.ok(!forbidden.test(storeSource), `store.js must not issue ${forbidden}`);
  }
  // The re-review surface is GET-only.
  assert.match(serverSource, /memoryRereviewMatch && req\.method === 'GET'/);
  assert.ok(!/memory-candidate-rereviews[\s\S]{0,400}method === 'POST'/.test(serverSource));
  // No routing, provider, memory-write, retrieval, or scorecard dependency was introduced.
  for (const forbidden of ['./route.js', './execute.js', './memory.js', './scorecard.js', './registries.js', 'adapters/']) {
    assert.ok(!source.includes(forbidden), `memory-review.js must not import ${forbidden}`);
  }
  // The decision vocabulary still contains no promotion-shaped value.
  const schema = get("SELECT sql FROM sqlite_master WHERE type='table' AND name='hermes_memory_candidate_rereviews'").sql;
  assert.ok(!/'promote'/.test(schema));
  assert.match(schema, /CHECK\(decision IN \('recommend_promote','reject','defer_needs_evidence'\)\)/);
});
