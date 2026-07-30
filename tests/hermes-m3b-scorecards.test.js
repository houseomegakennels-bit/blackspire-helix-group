// Hermes M3B: deterministic, append-only verified scorecards derived only from intact M3A evidence.
// No routing, provider execution, approval, memory-promotion, or production behavior is tested
// because none is permitted in this phase - and several tests below exist specifically to prove
// that deriving a scorecard changes none of those tables.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-hermes-m3b-'));
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'm3b.sqlite');
const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { upsertWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { createUnifiedInput } = await import('../packages/unified-input/unified.js');
const { getTask } = await import('../packages/task-engine/tasks.js');
const { runHermesWorkflow } = await import('../packages/hermes-orchestrator/orchestrator.js');
const store = await import('../packages/hermes-orchestrator/store.js');
const { run, get, all, execSql } = await import('../packages/task-engine/db.js');
const authz = await import('../packages/shared/authorization.js');
const { appendOutcomeCorrection, appendOutcomeSourceEvent } = await import('../packages/hermes-orchestrator/outcome.js');
const { canonicalJson, digest } = await import('../packages/shared/canonical.js');
const { deriveVerifiedScorecards, readVerifiedScorecard, confidenceBand, SCORECARD_VERSION, SCORECARD_DERIVATION_VERSION, UNKNOWN_DIMENSION } = await import('../packages/hermes-orchestrator/scorecard.js');

const authzNow = Date.now();
function principal(workspaceId, permissions = ['evaluation.read', 'evaluation.correct']) {
  const suffix = `${workspaceId}-${permissions.join('-')}`;
  const principalId = `m3b-admin-${suffix}`; const grantId = `m3b-grant-${suffix}`;
  run('INSERT INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', [principalId, 'admin', principalId, 'bearer', null, 'active', authzNow, null, null, null, 1, authzNow]);
  run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [grantId, principalId, workspaceId, 'viewer', JSON.stringify([...permissions].sort()), 'active', 1, null, authzNow, null, null, 'test', 1, authzNow]);
  return authz.resolveAdminBearer(principalId);
}
function workspace(id) { upsertWorkspace({ id, name: id, githubRepository: 'local/m3b', defaultBranch: 'main', allowedPaths: ['docs'], buildCommands: [], providerPolicy: {}, riskLevel: 'low', budgetCents: 100, secretReferences: [], enabledTools: ['read'], lastHealthStatus: 'ok', rootPath: root }); }
function task(id, text = 'report current status', nonce = '') { const i = createUnifiedInput({ channel: 'jarvis', actorId: 'm3b-user', channelKey: 'm3b-user', workspaceId: id, text, idempotencyKey: `m3b-${id}-${text}-${nonce}` }); return getTask(i.taskId); }
function withoutImmutability(tables, callback) {
  const placeholders = tables.map(() => '?').join(',');
  const triggers = all(`SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name IN (${placeholders}) ORDER BY name`, tables);
  for (const trigger of triggers) execSql(`DROP TRIGGER ${trigger.name}`);
  try { return callback(); } finally { for (const trigger of triggers) execSql(trigger.sql); }
}
// Mints `count` verified mock evaluations in one workspace, all sharing a dimension group, and
// returns them in the canonical (created_at, id) selection order.
async function seedSources(workspaceId, count, text = 'report current status') {
  workspace(workspaceId);
  const evaluations = [];
  for (let index = 0; index < count; index += 1) {
    const result = await runHermesWorkflow(task(workspaceId, text, String(index)));
    evaluations.push(store.getOutcomeEvaluation(result.evaluationId));
  }
  return evaluations.sort((left, right) => (`${left.created_at} ${left.id}` < `${right.created_at} ${right.id}` ? -1 : 1));
}
const cutoffAt = (evaluation) => ({ createdAt: evaluation.created_at, id: evaluation.id });
const lastCutoff = (evaluations) => cutoffAt(evaluations.at(-1));

// Tables whose byte-identical state proves derivation had no execution, approval, or memory effect.
const SIDE_EFFECT_TABLES = [['hermes_routing_decisions', 'id'], ['hermes_policy_decisions', 'id'], ['hermes_provider_invocations', 'id'], ['hermes_provider_health', 'provider'], ['hermes_approvals', 'id'], ['approvals', 'id'], ['hermes_workflow_runs', 'id'], ['hermes_workflow_steps', 'id'], ['hermes_memory_candidates', 'id'], ['hermes_verification_results', 'id'], ['hermes_outcome_evaluations', 'id'], ['hermes_outcome_evaluation_components', 'id'], ['hermes_outcome_corrections', 'id'], ['hermes_outcome_source_events', 'id'], ['tasks', 'id']];
function sideEffectSnapshot() {
  const snapshot = Object.fromEntries(SIDE_EFFECT_TABLES.map(([table, key]) => [table, digest(all(`SELECT * FROM ${table} ORDER BY ${key}`))]));
  // Promoted memory has no table yet, so "promoted memory is untouched" is proven by pinning the
  // memory-candidate rows above (including status and promoted_at) and by proving derivation
  // creates no new table, index, or trigger anywhere in the schema.
  snapshot.__schema = digest(all('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name,tbl_name'));
  return snapshot;
}

test('derivation is deterministic: identical evidence reproduces byte-identical metrics and lineage digest', async () => {
  const sources = await seedSources('m3b-deterministic', 6);
  const reader = principal('m3b-deterministic');
  const cutoff = lastCutoff(sources);
  const [first] = deriveVerifiedScorecards(reader, { workspaceId: 'm3b-deterministic', cutoff });
  assert.equal(first.source_evaluation_count, 6);
  assert.equal(first.scorecard_version, SCORECARD_VERSION);
  assert.equal(first.derivation_version, SCORECARD_DERIVATION_VERSION);
  assert.match(first.lineage_digest, /^[a-f0-9]{64}$/);
  // Replay over the same scope, cutoff, and version returns the stored snapshot and writes nothing.
  const before = all('SELECT id FROM hermes_verified_scorecards').length;
  const [replayed] = deriveVerifiedScorecards(reader, { workspaceId: 'm3b-deterministic', cutoff });
  assert.equal(replayed.id, first.id, 'replay returns the existing snapshot');
  assert.deepEqual(replayed, first, 'replay returns byte-identical content');
  assert.equal(all('SELECT id FROM hermes_verified_scorecards').length, before, 'replay appends no second snapshot');
  // Lineage is persisted in an explicit, gap-free seq order, and its digest covers that order.
  const lineage = store.getVerifiedScorecardSources(first.id);
  assert.deepEqual(lineage.map((row) => row.seq), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(lineage.map((row) => row.evaluation_id), sources.map((row) => row.id), 'lineage follows the canonical (created_at, id) order');
  assert.deepEqual(lineage.map((row) => row.provenance_digest), sources.map((row) => row.provenance_digest));
});

test('lineage order is the canonical source order, not any caller-visible or arrival order', async () => {
  const sources = await seedSources('m3b-order', 5);
  const reader = principal('m3b-order');
  const [derived] = deriveVerifiedScorecards(reader, { workspaceId: 'm3b-order', cutoff: lastCutoff(sources) });
  // "Any input order produces the same result" holds structurally rather than by defence: the
  // service accepts no caller-supplied source list at all, only a workspace and a cutoff. What is
  // worth pinning is that the persisted lineage is the canonical (created_at, id) order even when
  // the caller's own view of the sources is shuffled.
  const shuffled = [...sources].reverse();
  const reordered = [...shuffled].sort((left, right) => (`${left.created_at} ${left.id}` < `${right.created_at} ${right.id}` ? -1 : 1));
  assert.notDeepEqual(shuffled.map((row) => row.id), reordered.map((row) => row.id), 'the fixture really was shuffled');
  assert.deepEqual(store.getVerifiedScorecardSources(derived.id).map((row) => row.evaluation_id), reordered.map((row) => row.id));
});

test('confidence bands are exact at 4, 5, 19, and 20 intact sources and authorize nothing', async () => {
  const sources = await seedSources('m3b-bands', 20);
  const reader = principal('m3b-bands');
  for (const [count, expected] of [[4, 'insufficient'], [5, 'limited'], [19, 'limited'], [20, 'established']]) {
    const [card] = deriveVerifiedScorecards(reader, { workspaceId: 'm3b-bands', cutoff: cutoffAt(sources[count - 1]) });
    assert.equal(card.source_evaluation_count, count, `cutoff selects exactly ${count} sources`);
    assert.equal(card.confidence_band, expected, `${count} sources is ${expected}`);
  }
  assert.equal(confidenceBand(0), 'insufficient', 'no evidence is an explicit insufficient state, never a zero score');
  assert.throws(() => confidenceBand(-1), /malformed source count/);
  assert.throws(() => confidenceBand(1.5), /malformed source count/);
  // Successive cutoffs over one scope append successors and never touch a predecessor.
  const chain = all("SELECT id,scope_version,supersedes_scorecard_id FROM hermes_verified_scorecards WHERE workspace_id='m3b-bands' ORDER BY scope_version");
  assert.deepEqual(chain.map((row) => row.scope_version), [1, 2, 3, 4]);
  assert.equal(chain[0].supersedes_scorecard_id, null);
  assert.deepEqual(chain.slice(1).map((row) => row.supersedes_scorecard_id), chain.slice(0, -1).map((row) => row.id));
});

test('the cutoff tuple is inclusive at its boundary, and a rewritten timestamp fails closed', async () => {
  const sources = await seedSources('m3b-cutoff', 4);
  const reader = principal('m3b-cutoff');
  const [inclusive] = deriveVerifiedScorecards(reader, { workspaceId: 'm3b-cutoff', cutoff: cutoffAt(sources[2]) });
  assert.equal(inclusive.source_evaluation_count, 3, 'the boundary evaluation is included');
  assert.deepEqual(store.getVerifiedScorecardSources(inclusive.id).map((row) => row.evaluation_id), sources.slice(0, 3).map((row) => row.id));
  assert.ok(!store.getVerifiedScorecardSources(inclusive.id).some((row) => row.evaluation_id === sources[3].id), 'the next evaluation is excluded');
  // Force every source onto one timestamp so only the id tiebreak can order and cut them. Rewriting
  // created_at breaks each evaluation's provenance digest, so this must fail closed rather than
  // silently derive from tampered evidence.
  withoutImmutability(['hermes_outcome_evaluations'], () => {
    for (const source of sources) run('UPDATE hermes_outcome_evaluations SET created_at=? WHERE id=?', ['2026-01-01T00:00:00.000Z', source.id]);
  });
  assert.throws(() => deriveVerifiedScorecards(reader, { workspaceId: 'm3b-cutoff', cutoff: { createdAt: '2026-01-01T00:00:00.000Z', id: sources[3].id } }), /does not revalidate/);
  assert.throws(() => deriveVerifiedScorecards(reader, { workspaceId: 'm3b-cutoff', cutoff: { createdAt: '2999-01-01T00:00:00.000Z', id: sources[0].id } }), /future cutoff/);
  assert.throws(() => deriveVerifiedScorecards(reader, { workspaceId: 'm3b-cutoff', cutoff: { createdAt: 'not-a-timestamp', id: sources[0].id } }), /canonical cutoff tuple/);
  assert.throws(() => deriveVerifiedScorecards(reader, { workspaceId: 'm3b-cutoff', cutoff: cutoffAt(sources[0]), scorecardVersion: 'unreviewed-v2' }), /canonical scorecard version/);
});

test('unknown acceptance, rollback, and stability are first-class counts, never zero and never success', async () => {
  const sources = await seedSources('m3b-unknown', 5);
  const reader = principal('m3b-unknown');
  const [card] = deriveVerifiedScorecards(reader, { workspaceId: 'm3b-unknown', cutoff: lastCutoff(sources) });
  // Milestone 3A records no acceptance, rollback, or stability determination, so every source is
  // unknown on all three axes. Unknown must not be readable as a zero rate or as a success.
  assert.equal(card.unknown_acceptance_count, 5);
  assert.equal(card.unknown_rollback_count, 5);
  assert.equal(card.unknown_stability_count, 5);
  assert.equal(card.accepted_count, 0);
  assert.equal(card.rollback_count, 0);
  assert.equal(card.acceptance_denominator, 0, 'an unknown acceptance yields no derivable ratio');
  assert.equal(card.acceptance_numerator, 0);
  assert.equal(card.positive_eligible_count, 5);
  assert.equal(card.verified_success_numerator, 5);
  assert.equal(card.verified_success_denominator, 5);
  // Every stored metric is an exact integer; no ratio is stored as a float.
  for (const [column, value] of Object.entries(card)) {
    if (/_count$|_total$|_numerator$|_denominator$|^known_/.test(column)) assert.ok(Number.isInteger(value), `${column} is an exact integer`);
  }
});

test('unknown timeout and unknown retry are counted, never summed as a confirmed zero', async () => {
  // A policy-blocked run never reaches a provider, so Milestone 3A records its timeout and retry
  // components as `unknown` while the NOT NULL row columns necessarily read 0 and NULL. Those must
  // not be aggregated as "did not time out" and "zero retries".
  const blocked = await seedSources('m3b-unknown-usage', 3, 'deploy to production');
  const reader = principal('m3b-unknown-usage');
  for (const evaluation of blocked) {
    assert.equal(evaluation.learning_eligibility, 'ineligible_blocked');
    assert.equal(evaluation.provider_invocation_id, null, 'a blocked run has no provider invocation');
    assert.equal(evaluation.timed_out, 0, 'the NOT NULL column still reads zero');
    assert.equal(evaluation.retry_count, null, 'retry is NULL, meaning unknown');
    assert.equal(get("SELECT status FROM hermes_outcome_evaluation_components WHERE evaluation_id=? AND name='timeout'", [evaluation.id]).status, 'unknown', 'M3A itself calls this unknown');
  }
  const [card] = deriveVerifiedScorecards(reader, { workspaceId: 'm3b-unknown-usage', cutoff: lastCutoff(blocked) });
  assert.equal(card.unknown_timeout_count, 3, 'an absent provider invocation is an unknown timeout');
  assert.equal(card.timeout_count, 0, 'and is never counted as a confirmed timeout either');
  assert.equal(card.known_retry_evaluations, 0, 'no source contributes a known retry count');
  assert.equal(card.retry_total, 0, 'so the retry total has an explicitly empty denominator');
  assert.equal(card.blocked_ineligible_count, 3);
  assert.equal(card.positive_eligible_count, 0);
  // A verified mock run does reach a provider, so its timeout determination is known.
  const verified = await seedSources('m3b-known-usage', 3);
  const [known] = deriveVerifiedScorecards(principal('m3b-known-usage'), { workspaceId: 'm3b-known-usage', cutoff: lastCutoff(verified) });
  assert.equal(known.unknown_timeout_count, 0);
  assert.equal(known.known_retry_evaluations, 3, 'a known zero retry count is counted as known');
});

test('recorded acceptance evidence is counted exactly and changes the derived content at the same identity', async () => {
  const sources = await seedSources('m3b-acceptance', 5);
  const reader = principal('m3b-acceptance');
  const cutoff = lastCutoff(sources);
  const [before] = deriveVerifiedScorecards(reader, { workspaceId: 'm3b-acceptance', cutoff });
  assert.equal(before.acceptance_denominator, 0);
  appendOutcomeSourceEvent(reader, sources[0].id, { idempotencyKey: 'm3b-accept-1', eventType: 'accepted', evidence: 'operator confirmed the change' });
  appendOutcomeSourceEvent(reader, sources[1].id, { idempotencyKey: 'm3b-accept-2', eventType: 'rejected', evidence: 'operator rejected the change' });
  appendOutcomeSourceEvent(reader, sources[2].id, { idempotencyKey: 'm3b-accept-3', eventType: 'stability_confirmed', evidence: 'stable after follow up' });
  // The identity (scope, cutoff, version) is unchanged but the underlying evidence is not, so the
  // stored snapshot and current evidence now disagree. That refuses - never a silent overwrite of an
  // immutable snapshot and never a silently stale read. Because the cause here is append-only
  // evidence arriving normally rather than corruption, it is named as appended evidence and the
  // caller is told to derive a later cutoff, which the rest of this test then does.
  assert.throws(() => deriveVerifiedScorecards(reader, { workspaceId: 'm3b-acceptance', cutoff }), /source evidence was appended: derive a later cutoff/);
  // A later cutoff is a different identity, so it derives cleanly as a successor and shows the
  // newly recorded evidence with unknown counts reduced by exactly the sources now determined.
  const extra = await seedSources('m3b-acceptance', 1, 'write documentation summary');
  const [after] = deriveVerifiedScorecards(reader, { workspaceId: 'm3b-acceptance', cutoff: cutoffAt(extra.at(-1)) }).filter((card) => card.source_evaluation_count === 5);
  assert.equal(after.accepted_count, 1);
  assert.equal(after.rejected_count, 1);
  assert.equal(after.stability_confirmed_count, 1);
  assert.equal(after.acceptance_denominator, 2, 'only sources with acceptance evidence enter the denominator');
  assert.equal(after.acceptance_numerator, 1);
  assert.equal(after.unknown_acceptance_count, 3, 'the three undetermined sources stay unknown');
  assert.equal(after.unknown_stability_count, 4);
  assert.equal(after.supersedes_scorecard_id, before.id, 'the successor links to its predecessor');
  assert.deepEqual(store.getVerifiedScorecard(before.id), before, 'the predecessor is byte-identical after a successor exists');
});

test('scorecards are grouped only by canonical workspace, provider, agent, capability, and classification', async () => {
  const verified = await seedSources('m3b-groups', 3, 'report current status');
  const documented = await seedSources('m3b-groups', 2, 'write documentation summary');
  const reader = principal('m3b-groups');
  const ordered = [...verified, ...documented].sort((left, right) => (`${left.created_at} ${left.id}` < `${right.created_at} ${right.id}` ? -1 : 1));
  const cards = deriveVerifiedScorecards(reader, { workspaceId: 'm3b-groups', cutoff: cutoffAt(ordered.at(-1)) });
  assert.ok(cards.length >= 2, 'distinct classifications derive distinct scorecards');
  assert.equal(cards.reduce((sum, card) => sum + card.source_evaluation_count, 0), 5, 'every intact source lands in exactly one group');
  for (const card of cards) {
    assert.equal(card.workspace_id, 'm3b-groups');
    for (const column of ['dimension_provider_id', 'dimension_agent_id', 'dimension_capability', 'dimension_classification']) {
      assert.equal(typeof card[column], 'string');
      assert.notEqual(card[column], '', `${column} is never an empty string`);
      assert.notEqual(card[column], null, `${column} is never NULL, so a UNIQUE identity cannot be defeated`);
    }
    assert.doesNotMatch(card.dimension_classification, /requiredCapabilities/, 'capabilities are their own dimension');
  }
  // Group output order is a total order over the canonical dimension key, not source arrival order.
  const keys = cards.map((card) => canonicalJson({ providerId: card.dimension_provider_id, agentId: card.dimension_agent_id, capability: card.dimension_capability, classification: card.dimension_classification }));
  assert.deepEqual(keys, [...keys].sort(), 'groups are emitted in canonical order');
});

test('workspace isolation: sources, reads, and authorization all derive scope from stored evidence', async () => {
  const alpha = await seedSources('m3b-scope-a', 5);
  await seedSources('m3b-scope-b', 5);
  const alphaReader = principal('m3b-scope-a');
  const betaReader = principal('m3b-scope-b');
  const decisionsBefore = all("SELECT id FROM auth_decisions WHERE workspace_id='m3b-scope-a'").length;
  const [card] = deriveVerifiedScorecards(alphaReader, { workspaceId: 'm3b-scope-a', cutoff: lastCutoff(alpha) });
  assert.equal(card.source_evaluation_count, 5, 'another workspace\'s evidence never enters the snapshot');
  assert.ok(store.getVerifiedScorecardSources(card.id).every((row) => row.workspace_id === 'm3b-scope-a'));
  // Exactly one decision per permission per derivation, scoped to the derived workspace - not one
  // per source. Both permissions are audited because deriving reads evidence and writes a snapshot.
  const decisions = all("SELECT permission,allowed FROM auth_decisions WHERE workspace_id='m3b-scope-a' ORDER BY permission");
  assert.equal(decisions.length, decisionsBefore + 2);
  assert.deepEqual(decisions.slice(-2).map((row) => row.permission), ['evaluation.correct', 'evaluation.read']);
  // Deriving persists rows, so a read-only grant must not be able to do it - but may still read.
  const viewer = principal('m3b-scope-a', ['evaluation.read']);
  assert.throws(() => deriveVerifiedScorecards(viewer, { workspaceId: 'm3b-scope-a', cutoff: lastCutoff(alpha) }), /not authorized/, 'a read-only grant cannot append snapshots');
  assert.ok(readVerifiedScorecard(viewer, card.id), 'but a read-only grant can still read one');
  // A denied attempt leaves durable audit evidence: the decision is recorded before the transaction
  // that a refusal rolls back, so scope probing cannot be silent.
  const deniedBefore = all("SELECT id FROM auth_decisions WHERE allowed=0").length;
  assert.throws(() => deriveVerifiedScorecards(betaReader, { workspaceId: 'm3b-scope-a', cutoff: lastCutoff(alpha) }), /not authorized/);
  assert.ok(all("SELECT id FROM auth_decisions WHERE allowed=0").length > deniedBefore, 'a denied derivation is durably audited');
  assert.throws(() => deriveVerifiedScorecards({ principalId: alphaReader.principalId }, { workspaceId: 'm3b-scope-a', cutoff: lastCutoff(alpha) }), /not authorized/, 'a forged principal object is not trusted');
  assert.equal(readVerifiedScorecard(betaReader, card.id), null, 'a cross-workspace read is refused');
  assert.equal(readVerifiedScorecard({ principalId: alphaReader.principalId }, card.id), null, 'a forged principal cannot read');
  assert.equal(readVerifiedScorecard(alphaReader, 'unknown-scorecard'), null, 'an unknown id is indistinguishable from a cross-workspace object');
  const readable = readVerifiedScorecard(alphaReader, card.id);
  assert.equal(readable.workspaceId, 'm3b-scope-a');
  assert.equal(readable.confidenceBand, 'limited');
  assert.equal(readable.sources.length, 5);
  assert.equal(readable.metrics.source_evaluation_count, 5);
});

test('malformed, missing, corrected, and contradictory evidence fails the whole snapshot closed', async () => {
  const reader = principal('m3b-closed');
  const cases = [
    ['a tampered provenance digest', (source) => run('UPDATE hermes_outcome_evaluations SET provenance_digest=? WHERE id=?', ['0'.repeat(64), source.id]), /does not revalidate/],
    ['a whitespace-padded evaluation version', (source) => run('UPDATE hermes_outcome_evaluations SET evaluation_version=? WHERE id=?', ['m3a-v1 ', source.id]), /mixed source evaluation version/],
    ['an unreviewed evaluation version', (source) => run('UPDATE hermes_outcome_evaluations SET evaluation_version=? WHERE id=?', ['m3a-v2', source.id]), /mixed source evaluation version/],
    // A plausible, in-enum forgery must fail on the provenance digest, not merely on shape checks.
    ['a forged learning eligibility', (source) => run('UPDATE hermes_outcome_evaluations SET learning_eligibility=? WHERE id=?', ['negative_factual', source.id]), /does not revalidate/],
    ['an out-of-enum learning eligibility', (source) => run('UPDATE hermes_outcome_evaluations SET learning_eligibility=? WHERE id=?', ['fabricated_positive', source.id]), /does not revalidate/],
    ['a malformed classification dimension', (source) => run('UPDATE hermes_outcome_evaluations SET classification=? WHERE id=?', ['{}', source.id]), /does not revalidate/],
    // Planted child evidence belonging to another workspace must fail the whole snapshot rather
    // than contribute a count. (Reassigning the parent row's own workspace_id is not tested here:
    // that removes it from the query scope entirely, the same undetectable class as deletion below.)
    ['cross-workspace planted source-event evidence', (source) => run('INSERT INTO hermes_outcome_source_events(id,evaluation_id,workspace_id,run_id,event_type,evidence,actor_principal_id,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?,?,?)', [`planted-${source.id}`, source.id, 'm3b-elsewhere', source.run_id, 'accepted', 'planted evidence', 'm3b-planted-actor', `planted-key-${source.id}`, source.created_at]), /does not revalidate/],
    ['a deleted source', (source) => { run('DELETE FROM hermes_outcome_evaluation_components WHERE evaluation_id=?', [source.id]); run('DELETE FROM hermes_outcome_evaluations WHERE id=?', [source.id]); }, /does not revalidate|refuses/],
  ];
  for (const [index, [label, mutate, message]] of cases.entries()) {
    const workspaceId = `m3b-closed-${index}`;
    const sources = await seedSources(workspaceId, 3);
    const scoped = principal(workspaceId);
    const target = sources[1];
    withoutImmutability(['hermes_outcome_evaluations', 'hermes_outcome_evaluation_components'], () => mutate(target));
    const cutoff = lastCutoff(sources);
    if (label === 'a deleted source') {
      // Pinned limitation, not a silent skip we endorse: selection is "every evaluation in scope",
      // so with no independent manifest of what should exist, a row physically removed from the
      // database is indistinguishable from one that was never written. Deletion is impossible
      // through the application - it requires dropping the immutability triggers, as this fixture
      // does - and the snapshot never claims a source count including evidence that is gone.
      const [card] = deriveVerifiedScorecards(scoped, { workspaceId, cutoff });
      assert.equal(card.source_evaluation_count, 2, `${label} is never counted`);
      assert.ok(!store.getVerifiedScorecardSources(card.id).some((row) => row.evaluation_id === target.id), `${label} is absent from lineage`);
      continue;
    }
    assert.throws(() => deriveVerifiedScorecards(scoped, { workspaceId, cutoff }), message, label);
    assert.equal(all('SELECT id FROM hermes_verified_scorecards WHERE workspace_id=?', [workspaceId]).length, 0, `${label} writes no partial snapshot`);
  }
  // Milestone 3A permits an accepted and a rejected event on one evaluation. Aggregating that would
  // resolve a contradiction in the favorable direction, so it must fail the snapshot closed.
  const contradictory = await seedSources('m3b-contradictory', 3);
  const contradictoryReader = principal('m3b-contradictory');
  appendOutcomeSourceEvent(contradictoryReader, contradictory[0].id, { idempotencyKey: 'm3b-contra-accept', eventType: 'accepted', evidence: 'operator accepted the change' });
  appendOutcomeSourceEvent(contradictoryReader, contradictory[0].id, { idempotencyKey: 'm3b-contra-reject', eventType: 'rejected', evidence: 'operator later rejected the change' });
  assert.throws(() => deriveVerifiedScorecards(contradictoryReader, { workspaceId: 'm3b-contradictory', cutoff: lastCutoff(contradictory) }), /contradictory acceptance evidence/);
  assert.equal(all("SELECT id FROM hermes_verified_scorecards WHERE workspace_id='m3b-contradictory'").length, 0, 'contradictory evidence writes no partial snapshot');
  // A corrected evaluation is disputed evidence and fails closed rather than being aggregated.
  const corrected = await seedSources('m3b-corrected', 3);
  const correctedReader = principal('m3b-corrected');
  appendOutcomeCorrection(correctedReader, corrected[1].id, { reason: 'operator disputed the recorded outcome', sourceEvidence: 'follow-up review' });
  assert.throws(() => deriveVerifiedScorecards(correctedReader, { workspaceId: 'm3b-corrected', cutoff: lastCutoff(corrected) }), /corrected source evaluation/);
  assert.equal(all("SELECT id FROM hermes_verified_scorecards WHERE workspace_id='m3b-corrected'").length, 0, 'a corrected source writes no partial snapshot');
  assert.ok(reader, 'the closed-path fixture principal resolved');
});

test('canonical Phase 3B snapshot and lineage tables reject update and delete', async () => {
  const sources = await seedSources('m3b-immutable', 5);
  const reader = principal('m3b-immutable');
  const [card] = deriveVerifiedScorecards(reader, { workspaceId: 'm3b-immutable', cutoff: lastCutoff(sources) });
  const lineage = store.getVerifiedScorecardSources(card.id);
  assert.throws(() => run('UPDATE hermes_verified_scorecards SET confidence_band=? WHERE id=?', ['established', card.id]), /immutable verified scorecard/);
  assert.throws(() => run('DELETE FROM hermes_verified_scorecards WHERE id=?', [card.id]), /immutable verified scorecard/);
  assert.throws(() => run('UPDATE hermes_verified_scorecard_sources SET seq=? WHERE id=?', [99, lineage[0].id]), /immutable verified scorecard source/);
  assert.throws(() => run('DELETE FROM hermes_verified_scorecard_sources WHERE id=?', [lineage[0].id]), /immutable verified scorecard source/);
});

test('a stored snapshot whose persisted content no longer matches its digest is unreadable', async () => {
  const sources = await seedSources('m3b-tamper', 5);
  const reader = principal('m3b-tamper');
  const [card] = deriveVerifiedScorecards(reader, { workspaceId: 'm3b-tamper', cutoff: lastCutoff(sources) });
  assert.ok(readVerifiedScorecard(reader, card.id), 'the intact snapshot reads');
  for (const [label, mutate] of [
    ['an inflated positive count', () => run('UPDATE hermes_verified_scorecards SET positive_eligible_count=? WHERE id=?', [99, card.id])],
    ['a promoted confidence band', () => run('UPDATE hermes_verified_scorecards SET confidence_band=? WHERE id=?', ['established', card.id])],
    ['a truncated lineage', () => run('DELETE FROM hermes_verified_scorecard_sources WHERE scorecard_id=? AND seq=?', [card.id, 5])],
    ['a reordered lineage', () => run('UPDATE hermes_verified_scorecard_sources SET seq=? WHERE scorecard_id=? AND seq=?', [7, card.id, 1])],
    // These four are caught only because the lineage digest is recomputed on read. Without it a
    // snapshot could be re-attributed to another provider, or hand back forged lineage, and still
    // read as authentic.
    ['a re-attributed provider dimension', () => run('UPDATE hermes_verified_scorecards SET dimension_provider_id=? WHERE id=?', ['trusted-provider', card.id])],
    ['a rewritten cutoff', () => run('UPDATE hermes_verified_scorecards SET cutoff_created_at=? WHERE id=?', ['2026-01-01T00:00:00.000Z', card.id])],
    ['a forged lineage evaluation id', () => run('UPDATE hermes_verified_scorecard_sources SET evaluation_id=? WHERE scorecard_id=? AND seq=?', ['forged-evaluation', card.id, 2])],
    ['a forged lineage provenance digest', () => run('UPDATE hermes_verified_scorecard_sources SET provenance_digest=? WHERE scorecard_id=? AND seq=?', ['0'.repeat(64), card.id, 2])],
    ['a swapped lineage digest', () => run('UPDATE hermes_verified_scorecards SET lineage_digest=? WHERE id=?', ['a'.repeat(64), card.id])],
  ]) {
    const original = { card: get('SELECT * FROM hermes_verified_scorecards WHERE id=?', [card.id]), sources: store.getVerifiedScorecardSources(card.id) };
    withoutImmutability(['hermes_verified_scorecards', 'hermes_verified_scorecard_sources'], () => {
      mutate();
      assert.equal(readVerifiedScorecard(reader, card.id), null, `${label} makes the snapshot unreadable`);
      run('DELETE FROM hermes_verified_scorecards WHERE id=?', [card.id]);
      run('DELETE FROM hermes_verified_scorecard_sources WHERE scorecard_id=?', [card.id]);
      const columns = Object.keys(original.card);
      run(`INSERT INTO hermes_verified_scorecards(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`, columns.map((column) => original.card[column]));
      for (const source of original.sources) {
        const sourceColumns = Object.keys(source);
        run(`INSERT INTO hermes_verified_scorecard_sources(${sourceColumns.join(',')}) VALUES(${sourceColumns.map(() => '?').join(',')})`, sourceColumns.map((column) => source[column]));
      }
    });
    assert.ok(readVerifiedScorecard(reader, card.id), `${label} fixture restored`);
  }
});

test('deriving a scorecard leaves every routing, provider, approval, workflow, and memory table byte-identical', async () => {
  const sources = await seedSources('m3b-inert', 6);
  const reader = principal('m3b-inert');
  const before = sideEffectSnapshot();
  const [card] = deriveVerifiedScorecards(reader, { workspaceId: 'm3b-inert', cutoff: lastCutoff(sources) });
  const afterDerive = sideEffectSnapshot();
  assert.deepEqual(afterDerive, before, 'a successful derivation changes no execution, approval, or memory state');
  readVerifiedScorecard(reader, card.id);
  assert.deepEqual(sideEffectSnapshot(), before, 'a read changes nothing either');
  // A refused derivation must also leave everything untouched, including the scorecard tables.
  const scorecardsBefore = digest(all('SELECT * FROM hermes_verified_scorecards ORDER BY id'));
  assert.throws(() => deriveVerifiedScorecards(reader, { workspaceId: 'm3b-inert', cutoff: { createdAt: '2999-01-01T00:00:00.000Z', id: sources[0].id } }), /future cutoff/);
  assert.deepEqual(sideEffectSnapshot(), before, 'a refused derivation changes no execution, approval, or memory state');
  assert.equal(digest(all('SELECT * FROM hermes_verified_scorecards ORDER BY id')), scorecardsBefore, 'a refused derivation writes no snapshot');
  // Memory candidates specifically remain pending and unpromoted: 3B promotes nothing.
  for (const candidate of all('SELECT status,promoted_at FROM hermes_memory_candidates')) {
    assert.equal(candidate.status, 'pending');
    assert.equal(candidate.promoted_at, null);
  }
});

test('the scorecard module imports no router, executor, provider, health, or memory surface', () => {
  const source = fs.readFileSync(new URL('../packages/hermes-orchestrator/scorecard.js', import.meta.url), 'utf8');
  const imports = source.split('\n').filter((line) => line.startsWith('import '));
  for (const forbidden of ['./route.js', './execute.js', './memory.js', './registries.js', './health.js', './orchestrator.js', './approvals.js', './adapters/']) {
    assert.ok(!imports.some((line) => line.includes(forbidden)), `scorecard.js must not import ${forbidden}`);
  }
  assert.doesNotMatch(source, /routeTask|runHermesWorkflow|upsertProviderHealth|insertMemoryCandidate|promote/i, 'no routing, execution, provider-health, or memory-promotion call exists');
  assert.doesNotMatch(source, /BLACKSPIRE_RUNTIME_MODE|BLACKSPIRE_GATE4|process\.env/, 'the derivation reads no environment flag and cannot be switched into another mode');
  assert.equal(UNKNOWN_DIMENSION, '*', 'the unknown sentinel stays outside the safe-id character set');
});

// --- Review-cycle regressions (PR #60 confirmation review) ---

test('a successor may never walk a scope backwards to an earlier cutoff', async () => {
  const sources = await seedSources('m3b-monotonic', 6);
  const reader = principal('m3b-monotonic');
  const scope = { workspaceId: 'm3b-monotonic' };
  const [rich] = deriveVerifiedScorecards(reader, { ...scope, cutoff: cutoffAt(sources[5]) });
  assert.equal(rich.source_evaluation_count, 6);
  assert.equal(rich.scope_version, 1);
  const before = digest(all('SELECT * FROM hermes_verified_scorecards ORDER BY id'));
  // Without the guard this appended a 1-source `insufficient` snapshot at scope_version 2 that
  // claimed to supersede the 6-source predecessor, silently regressing the scope head.
  assert.throws(() => deriveVerifiedScorecards(reader, { ...scope, cutoff: cutoffAt(sources[0]) }),
    /successor behind its predecessor cutoff/);
  assert.equal(digest(all('SELECT * FROM hermes_verified_scorecards ORDER BY id')), before, 'a refused successor writes nothing');
  const head = store.getVerifiedScorecardScopeHead({
    workspace_id: 'm3b-monotonic', scorecard_version: rich.scorecard_version,
    dimension_provider_id: rich.dimension_provider_id, dimension_agent_id: rich.dimension_agent_id,
    dimension_capability: rich.dimension_capability, dimension_classification: rich.dimension_classification,
  });
  assert.equal(head.id, rich.id, 'the scope head is still the richer snapshot');
  assert.equal(head.source_evaluation_count, 6);
  // Replay at the identical cutoff must still short-circuit rather than trip the new guard: the
  // guard refuses regression only, never an equal or later cutoff.
  const [replayed] = deriveVerifiedScorecards(reader, { ...scope, cutoff: cutoffAt(sources[5]) });
  assert.equal(replayed.id, rich.id, 'replay at the head cutoff still returns the stored snapshot');
});

test('legitimately appended source evidence is named as such, not reported as an integrity conflict', async () => {
  const sources = await seedSources('m3b-appended', 5);
  const reader = principal('m3b-appended');
  const cutoff = lastCutoff(sources);
  const [card] = deriveVerifiedScorecards(reader, { workspaceId: 'm3b-appended', cutoff });
  assert.equal(card.accepted_count, 0);
  // A human accepting a change is routine, expected Milestone 3A activity - not corruption.
  appendOutcomeSourceEvent(reader, sources[0].id, { eventType: 'accepted', evidence: 'human accepted the change', idempotencyKey: 'm3b-appended-accept-1' });
  assert.throws(() => deriveVerifiedScorecards(reader, { workspaceId: 'm3b-appended', cutoff }),
    /source evidence was appended: derive a later cutoff/,
    'appended evidence must not masquerade as an evidence-store integrity conflict');
  // Genuine divergence still fails closed with the integrity error, so the two causes stay distinct
  // and an operator is never told to "derive a later cutoff" in response to real corruption.
  withoutImmutability(['hermes_verified_scorecards'], () => {
    run('UPDATE hermes_verified_scorecards SET lineage_digest=? WHERE id=?', ['0'.repeat(64), card.id]);
  });
  assert.throws(() => deriveVerifiedScorecards(reader, { workspaceId: 'm3b-appended', cutoff }),
    /identity conflicts with stored derived content/);
});

test('the successor chain is proven against its real predecessor, not merely self-consistent', async () => {
  const sources = await seedSources('m3b-chain', 4);
  const reader = principal('m3b-chain');
  const [first] = deriveVerifiedScorecards(reader, { workspaceId: 'm3b-chain', cutoff: cutoffAt(sources[1]) });
  const [second] = deriveVerifiedScorecards(reader, { workspaceId: 'm3b-chain', cutoff: cutoffAt(sources[3]) });
  assert.equal(second.scope_version, 2);
  assert.equal(second.supersedes_scorecard_id, first.id);
  assert.ok(readVerifiedScorecard(reader, second.id), 'an intact chain reads');
  // `scope_version` and `supersedes_scorecard_id` are returned by the read API. They are covered by
  // neither digest, so before this check a corrupted chain read back as authentic.
  for (const [column, value] of [['scope_version', 99], ['supersedes_scorecard_id', null]]) {
    const original = second[column];
    withoutImmutability(['hermes_verified_scorecards'], () => run(`UPDATE hermes_verified_scorecards SET ${column}=? WHERE id=?`, [value, second.id]));
    assert.equal(readVerifiedScorecard(reader, second.id), null, `a corrupted ${column} must not read as authentic`);
    withoutImmutability(['hermes_verified_scorecards'], () => run(`UPDATE hermes_verified_scorecards SET ${column}=? WHERE id=?`, [original, second.id]));
  }
  assert.ok(readVerifiedScorecard(reader, second.id), 'the restored chain reads again');
});

test('an unauthorized read performs no lineage work and reveals nothing by timing', async () => {
  const sources = await seedSources('m3b-oracle', 3);
  const owner = principal('m3b-oracle');
  const [card] = deriveVerifiedScorecards(owner, { workspaceId: 'm3b-oracle', cutoff: lastCutoff(sources) });
  workspace('m3b-oracle-other');
  const stranger = principal('m3b-oracle-other');
  // The integrity check is a full lineage read plus two digests. Deciding authorization first means
  // a caller with no grant cannot measure the size of a scorecard they cannot see.
  const source = fs.readFileSync(new URL('../packages/hermes-orchestrator/scorecard.js', import.meta.url), 'utf8');
  const readBody = source.slice(source.indexOf('export function readVerifiedScorecard'));
  assert.ok(readBody.indexOf('canReadEvaluation') < readBody.indexOf('storedScorecardIntact'),
    'authorization must be decided before any lineage or digest work');
  assert.equal(readVerifiedScorecard(stranger, card.id), null, 'a cross-workspace read is refused');
  assert.ok(readVerifiedScorecard(owner, card.id), 'the owning workspace still reads');
});

test('classification dimension facets are enumerated, not merely non-empty strings', async () => {
  const sources = await seedSources('m3b-facets', 2);
  const reader = principal('m3b-facets');
  const [card] = deriveVerifiedScorecards(reader, { workspaceId: 'm3b-facets', cutoff: lastCutoff(sources) });
  assert.ok(card, 'in-enum evidence derives');
  // `dimension_classification` is echoed to a browser, so an out-of-enum facet must be refused here
  // rather than relying solely on the upstream provenance revalidation to catch it.
  const evaluation = store.getOutcomeEvaluation(sources[0].id);
  const tampered = { ...JSON.parse(evaluation.classification), domain: '<script>alert(1)</script>' };
  withoutImmutability(['hermes_outcome_evaluations'], () => {
    run('UPDATE hermes_outcome_evaluations SET classification=? WHERE id=?', [canonicalJson(tampered), sources[0].id]);
  });
  assert.throws(() => deriveVerifiedScorecards(reader, { workspaceId: 'm3b-facets', cutoff: cutoffAt(sources[1]) }),
    /does not revalidate|malformed classification dimension/);
});

test('an extended-year cutoff is refused outright rather than silently selecting nothing', async () => {
  const sources = await seedSources('m3b-yearform', 2);
  const reader = principal('m3b-yearform');
  // `toISOString()` round-trips the extended form for years outside 1000-9999, so this passed
  // canonical validation and then string-compared against no rows - an empty result, not a refusal.
  assert.throws(() => deriveVerifiedScorecards(reader, { workspaceId: 'm3b-yearform', cutoff: { createdAt: '-000001-01-01T00:00:00.000Z', id: sources[0].id } }),
    /canonical cutoff tuple/);
  assert.ok(deriveVerifiedScorecards(reader, { workspaceId: 'm3b-yearform', cutoff: lastCutoff(sources) }).length, 'a canonical cutoff still derives');
});
