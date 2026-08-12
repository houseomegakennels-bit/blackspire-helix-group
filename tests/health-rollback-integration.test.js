import test from 'node:test';
import assert from 'node:assert/strict';
import { postDeployReportObservation } from '../packages/health-transitions/post-deploy-integration.js';
import { MemoryHealthTransitionStore } from '../packages/health-transitions/store.js';
import { HealthTransitionEngine } from '../packages/health-transitions/engine.js';

const report = (classification) => ({ schemaVersion:1, kind:'blackspire-post-deploy-verification', readOnly:true, automaticActionTaken:false, classification, environment:'disposable-staging', expected:{ environment:'disposable-staging', commit:'a'.repeat(40), buildFingerprint:'build-1', migrationVersion:'v1' }, reasons:[] });
const context = { workspaceId:'workspace-a', correlationId:'deploy-1', timestamp:'2026-08-05T02:00:00.000Z' };
test('post-deploy classifications become advisory transitions only', () => {
  // 'observe' maps to component 'startup' / state 'recovering'. This expected 'none' when it was
  // written against the earlier PR #90 head, where 'recovering' was absent from recommendation()'s
  // observe bucket. PR #90's remediation added it, so a post-deploy 'observe' classification now
  // surfaces as the 'observe' recommendation -- the coherent result, and current main's behavior.
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
