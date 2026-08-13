import test from 'node:test';
import assert from 'node:assert/strict';
import { postDeployReportObservation } from '../packages/health-transitions/post-deploy-integration.js';
import { MemoryHealthTransitionStore } from '../packages/health-transitions/store.js';
import { HealthTransitionEngine } from '../packages/health-transitions/engine.js';

const report = (classification) => ({ schemaVersion:1, kind:'blackspire-post-deploy-verification', readOnly:true, automaticActionTaken:false, classification, environment:'disposable-staging', expected:{ environment:'disposable-staging', commit:'a'.repeat(40), buildFingerprint:'build-1', migrationVersion:'v1' }, reasons:[] });
const context = { workspaceId:'workspace-a', correlationId:'deploy-1', timestamp:'2026-08-05T02:00:00.000Z' };
test('post-deploy classifications become advisory transitions only', () => {
  // 'observe' maps to state 'recovering'. This expected 'none' when it was written against the
  // earlier PR #90 head, where 'recovering' was absent from recommendation()'s observe bucket.
  // PR #90's remediation added it, so a post-deploy 'observe' classification now surfaces as the
  // 'observe' recommendation -- the coherent result, and current main's behavior.
  // Every classification now records on the single 'post_deploy' component; this comment named the
  // old per-classification runtime components ('startup' here) until that routing was removed as a
  // defect, and said so after it no longer did.
  // The load-bearing claims of this test are unchanged: every classification stays advisory and
  // automaticActionTaken stays false.
  const expected = new Map([['proceed','none'],['observe','observe'],['rollback recommended','rollback_recommended'],['operator intervention required','operator_intervention_required']]);
  for (const [classification, recommendation] of expected) { const engine = new HealthTransitionEngine(new MemoryHealthTransitionStore()); const result = engine.observe(postDeployReportObservation(report(classification), context)); assert.equal(result.event.rollbackRecommendation, recommendation); assert.equal(result.event.automaticActionTaken, false); }
});
test('integration rejects mutable, actionable, or cross-environment reports', () => {
  assert.throws(() => postDeployReportObservation({ ...report('proceed'), automaticActionTaken:true }, context), /invalid post-deploy/);
  assert.throws(() => postDeployReportObservation({ ...report('proceed'), environment:'production' }, context), /environment mismatch/);
  assert.throws(() => postDeployReportObservation({ ...report('proceed'), classification:'rollback executed' }, context), /classification/);
});

// Each contract check below is a SOLE guard: targeted mutation showed that removing any one of
// them left every other assertion in this file green, because the cases above trip two checks at
// once. The `environment:'production'` case above, for example, breaks the allowlist AND the
// expected-environment match simultaneously, so neither was individually pinned -- and this module
// exists precisely to refuse mutable, actionable, or cross-environment reports. Each case here
// therefore violates exactly ONE clause and leaves the rest of the report valid.
test('integration fails closed when any single contract clause is violated', () => {
  const base = report('proceed');
  // Only readOnly is wrong: an advisory path must never accept a report that claims write intent.
  assert.throws(() => postDeployReportObservation({ ...base, readOnly:false }, context), /invalid post-deploy verification contract/);
  // Only kind is wrong: a foreign document must not be interpreted as a verification report.
  assert.throws(() => postDeployReportObservation({ ...base, kind:'blackspire-other-report' }, context), /invalid post-deploy verification contract/);
  // Only schemaVersion is wrong: a future schema must be refused, not guessed at.
  assert.throws(() => postDeployReportObservation({ ...base, schemaVersion:2 }, context), /invalid post-deploy verification contract/);
  // Only the environment ALLOWLIST is violated -- expected.environment agrees, so the mismatch
  // clause passes and the allowlist alone must reject production.
  assert.throws(() => postDeployReportObservation({ ...base, environment:'production', expected:{ ...base.expected, environment:'production' } }, context), /environment mismatch/);
  // Only the MISMATCH clause is violated -- both values are allowlisted, but they disagree, so a
  // report generated for one environment cannot be recorded against another.
  assert.throws(() => postDeployReportObservation({ ...base, environment:'staging' }, context), /environment mismatch/);
  // The valid report still passes, so the guards above are not rejecting everything.
  assert.equal(postDeployReportObservation(base, context).state, 'healthy');
});

// The store keys latest state by (environment, workspaceId, component) and NOT by source, so an
// advisory observation written to a runtime component silently replaces that component's live
// state. This was measured before the fix: runtime build dependency_failure ->
// operator_intervention_required, then an advisory 'proceed' one second later -> none / healthy.
// Every classification is asserted, because 'proceed' was only the loudest case: each arm used to
// land on 'build', 'startup', or 'api_readiness'.
test('advisory post-deploy observations never overwrite runtime component state', () => {
  const runtime = (component, state, reasonCode) => ({ environment:'disposable-staging', workspaceId:'workspace-a', component, state, reasonCode, reason:`${component} runtime observation`, timestamp:'2026-08-05T02:00:00.000Z', correlationId:'runtime-1', commit:'b'.repeat(40), buildFingerprint:'running-build', dependency:null, source:'runtime', metadata:{} });
  for (const classification of ['proceed','observe','rollback recommended','operator intervention required']) {
    const store = new MemoryHealthTransitionStore();
    const engine = new HealthTransitionEngine(store);
    // A live, failing runtime picture across exactly the components the adapter used to target.
    engine.observe(runtime('build','dependency_failure','check_failed'));
    engine.observe(runtime('api_readiness','unavailable','check_failed'));
    engine.observe(runtime('startup','recovering','startup_pending'));
    const before = engine.summary('disposable-staging','workspace-a');
    assert.equal(before.rollbackRecommendation, 'operator_intervention_required');
    // The advisory report arrives one second later and is accepted.
    const advisory = postDeployReportObservation(report(classification), { ...context, timestamp:'2026-08-05T02:00:01.000Z' });
    assert.equal(advisory.component, 'post_deploy');
    assert.equal(engine.observe(advisory).accepted, true);
    const after = engine.summary('disposable-staging','workspace-a');
    // Each runtime component keeps its own state and its own running-build identity.
    for (const [component, state] of [['build','dependency_failure'],['api_readiness','unavailable'],['startup','recovering']]) {
      const item = after.components.find((entry) => entry.component === component);
      assert.equal(item.state, state, `${classification} overwrote runtime ${component}`);
      assert.equal(item.source, 'runtime');
      assert.equal(item.buildFingerprint, 'running-build');
    }
    // The runtime alarm is never softened by an advisory report.
    assert.equal(after.rollbackRecommendation, 'operator_intervention_required');
  }
});

// Severity must not invert. 'operator intervention required' maps to state 'dependency_failure',
// which severity() graded 'warning' and summary()'s ladder placed in the 'degraded' arm, while the
// LESSER 'rollback recommended' arm (state 'unavailable') graded 'critical'/'unavailable'. The
// worst post-deploy outcome therefore rendered less severe than a lesser one on every surface that
// pages off severity or overallState, while rollbackRecommendation alone read correctly -- another
// self-contradicting operator report. Asserting rollbackRecommendation is NOT sufficient to catch
// this: it was already correct when the other two surfaces were wrong.
test('post-deploy severity and overall state never rank a worse outcome below a lesser one', () => {
  const RANK = { info:0, notice:1, warning:2, critical:3 };
  const STATE_RANK = { healthy:0, starting:1, degraded:2, unavailable:3 };
  const observed = new Map();
  for (const classification of ['proceed','observe','rollback recommended','operator intervention required']) {
    const engine = new HealthTransitionEngine(new MemoryHealthTransitionStore());
    const result = engine.observe(postDeployReportObservation(report(classification), context));
    const summary = engine.summary('disposable-staging','workspace-a');
    observed.set(classification, { severity: result.event.severity, state: summary.state });
  }
  // The two serious arms both reach the top of both ladders.
  for (const classification of ['rollback recommended','operator intervention required']) {
    assert.equal(observed.get(classification).severity, 'critical', `${classification} must be critical`);
    assert.equal(observed.get(classification).state, 'unavailable', `${classification} must be unavailable`);
  }
  // And the worst outcome is never ranked below the lesser one on either surface.
  const worst = observed.get('operator intervention required');
  const lesser = observed.get('rollback recommended');
  assert.ok(RANK[worst.severity] >= RANK[lesser.severity], 'intervention graded below rollback');
  assert.ok(STATE_RANK[worst.state] >= STATE_RANK[lesser.state], 'intervention overall state below rollback');
  // The advisory arms stay below them, so this is an ordering guard rather than a blanket escalation.
  assert.equal(observed.get('proceed').severity, 'info');
  assert.equal(observed.get('observe').severity, 'notice');
  assert.ok(RANK[observed.get('observe').severity] < RANK[lesser.severity]);
  // The escalation is scoped to 'post_deploy' ONLY. Deleting the `component === 'post_deploy'`
  // test from either the severity clause or the summary ladder leaves every assertion above green
  // while silently regrading THIRTEEN pre-existing components: each one's dependency_failure would
  // go warning/degraded -> critical/unavailable, so a single 'providers' dependency_failure would
  // flip the whole environment's operator headline to UNAVAILABLE. That scoping is the invariant
  // this change set's central evidence claim rests on ("no existing component's grading changed"),
  // so it is pinned here rather than left to the author's word.
  for (const component of ['providers','telegram','worker','build']) {
    const engine = new HealthTransitionEngine(new MemoryHealthTransitionStore());
    const result = engine.observe({ environment:'disposable-staging', workspaceId:'workspace-a', component, state:'dependency_failure', reasonCode:'check_failed', reason:`${component} runtime observation`, timestamp:'2026-08-05T02:00:00.000Z', correlationId:'runtime-1', commit:'b'.repeat(40), buildFingerprint:'running-build', dependency:null, source:'runtime', metadata:{} });
    assert.equal(result.event.severity, 'warning', `${component} dependency_failure must stay warning`);
    // 'build' is escalated by its own pre-existing rule, so only the others assert the ladder.
    if (component !== 'build') assert.equal(engine.summary('disposable-staging','workspace-a').state, 'degraded', `${component} dependency_failure must stay degraded`);
  }
});

// Provenance was entirely unpinned: mutants that hardcoded workspaceId, froze the timestamp,
// rewrote correlationId, or relabelled source as 'runtime' all left the other tests green. A
// single-workspace fixture cannot detect cross-workspace misattribution in an adapter, so the
// second workspace here is load-bearing, not decoration.
test('post-deploy observations carry caller-supplied provenance and stay per-workspace', () => {
  const observation = postDeployReportObservation(report('proceed'), context);
  assert.equal(observation.workspaceId, 'workspace-a');
  assert.equal(observation.correlationId, 'deploy-1');
  assert.equal(observation.timestamp, '2026-08-05T02:00:00.000Z');
  assert.equal(observation.source, 'post_deploy_verifier');
  assert.equal(observation.metadata.mode, 'proceed');
  // Pinned on BOTH fixtures, with different values, so no single hardcoded constant can satisfy
  // the pair -- asserting only the second would be killed by a mutant that happens to freeze to
  // that same literal.
  assert.equal(observation.commit, 'a'.repeat(40));
  assert.equal(observation.buildFingerprint, 'build-1');
  const other = postDeployReportObservation(report('rollback recommended'), { workspaceId:'workspace-b', correlationId:'deploy-2', timestamp:'2026-08-05T03:00:00.000Z' });
  assert.equal(other.workspaceId, 'workspace-b');
  assert.equal(other.correlationId, 'deploy-2');
  // Asserted on the SECOND fixture specifically. The first assertion compares against the same
  // literal `context` supplies, so an adapter hardcoding that timestamp satisfies it -- a mutant
  // that froze the timestamp survived the whole file while this comment already claimed timestamp
  // was pinned. Only a second, differing value can distinguish pass-through from a constant.
  assert.equal(other.timestamp, '2026-08-05T03:00:00.000Z');
  assert.equal(other.metadata.mode, 'rollback recommended');
  // Deployment identity, pinned on a report carrying DIFFERENT values. This is the field class
  // that caused the original defect (the advisory record misattributing the running build), and
  // it was the last thing in this adapter a constant could satisfy: the shared fixture supplies
  // the same commit and buildFingerprint everywhere, so mutants hardcoding either survived the
  // whole file.
  const moved = postDeployReportObservation({ ...report('proceed'), expected:{ environment:'disposable-staging', commit:'c'.repeat(40), buildFingerprint:'build-2', migrationVersion:'v2' } }, context);
  assert.equal(moved.commit, 'c'.repeat(40));
  assert.equal(moved.buildFingerprint, 'build-2');
  // Recorded together, one workspace's advisory state must not appear in the other's summary.
  const store = new MemoryHealthTransitionStore();
  const engine = new HealthTransitionEngine(store);
  engine.observe(observation); engine.observe(other);
  assert.equal(engine.summary('disposable-staging','workspace-a').rollbackRecommendation, 'none');
  assert.equal(engine.summary('disposable-staging','workspace-b').rollbackRecommendation, 'rollback_recommended');
});
