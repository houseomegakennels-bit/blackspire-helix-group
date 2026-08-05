import test from 'node:test';
import assert from 'node:assert/strict';
import { postDeployReportObservation } from '../packages/health-transitions/post-deploy-integration.js';
import { MemoryHealthTransitionStore } from '../packages/health-transitions/store.js';
import { HealthTransitionEngine } from '../packages/health-transitions/engine.js';

const report = (classification) => ({ schemaVersion:1, kind:'blackspire-post-deploy-verification', readOnly:true, automaticActionTaken:false, classification, environment:'disposable-staging', expected:{ environment:'disposable-staging', commit:'a'.repeat(40), buildFingerprint:'build-1', migrationVersion:'v1' }, reasons:[] });
const context = { workspaceId:'workspace-a', correlationId:'deploy-1', timestamp:'2026-08-05T02:00:00.000Z' };
test('post-deploy classifications become advisory transitions only', () => {
  const expected = new Map([['proceed','none'],['observe','none'],['rollback recommended','rollback_recommended'],['operator intervention required','operator_intervention_required']]);
  for (const [classification, recommendation] of expected) { const engine = new HealthTransitionEngine(new MemoryHealthTransitionStore()); const result = engine.observe(postDeployReportObservation(report(classification), context)); assert.equal(result.event.rollbackRecommendation, recommendation); assert.equal(result.event.automaticActionTaken, false); }
});
test('integration rejects mutable, actionable, or cross-environment reports', () => {
  assert.throws(() => postDeployReportObservation({ ...report('proceed'), automaticActionTaken:true }, context), /invalid post-deploy/);
  assert.throws(() => postDeployReportObservation({ ...report('proceed'), environment:'production' }, context), /environment mismatch/);
  assert.throws(() => postDeployReportObservation({ ...report('proceed'), classification:'rollback executed' }, context), /classification/);
});
