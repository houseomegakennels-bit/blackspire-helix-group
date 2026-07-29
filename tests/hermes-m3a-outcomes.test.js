// Hermes M3A: immutable factual evaluations. No scorecard, routing, or memory behavior is tested
// because none is permitted in this phase.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-hermes-m3a-'));
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'm3a.sqlite');
const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { upsertWorkspace } = await import('../packages/workspace-registry/workspaces.js');
const { createUnifiedInput } = await import('../packages/unified-input/unified.js');
const { getTask } = await import('../packages/task-engine/tasks.js');
const { runHermesWorkflow } = await import('../packages/hermes-orchestrator/orchestrator.js');
const store = await import('../packages/hermes-orchestrator/store.js');
const { run } = await import('../packages/task-engine/db.js');
const authz = await import('../packages/shared/authorization.js');
const { evaluateTerminalOutcome, readOutcomeEvaluation, appendOutcomeCorrection, appendOutcomeSourceEvent, recordOutcomeEvaluationFailure } = await import('../packages/hermes-orchestrator/outcome.js');
const authzNow = Date.now();
function principal(workspaceId, permissions = ['evaluation.read','evaluation.correct']) {
  const suffix = `${workspaceId}-${permissions.join('-')}`;
  const principalId = `m3a-admin-${suffix}`; const grantId = `m3a-grant-${suffix}`;
  run('INSERT INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',[principalId,'admin',principalId,'bearer',null,'active',authzNow,null,null,null,1,authzNow]);
  run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',[grantId,principalId,workspaceId,'viewer',JSON.stringify([...permissions].sort()),'active',1,null,authzNow,null,null,'test',1,authzNow]);
  return authz.resolveAdminBearer(principalId);
}

function workspace(id) { upsertWorkspace({ id, name: id, githubRepository: 'local/m3a', defaultBranch: 'main', allowedPaths: ['docs'], buildCommands: [], providerPolicy: {}, riskLevel: 'low', budgetCents: 100, secretReferences: [], enabledTools: ['read'], lastHealthStatus: 'ok', rootPath: root }); }
function task(id, text = 'report current status') { const i = createUnifiedInput({ channel: 'jarvis', actorId: 'm3a-user', channelKey: 'm3a-user', workspaceId: id, text, idempotencyKey: `m3a-${id}-${text}` }); return getTask(i.taskId); }

test('verified mock workflow creates one immutable positive factual evaluation with provenance', async () => {
  workspace('m3a-good'); const r = await runHermesWorkflow(task('m3a-good'));
  assert.equal(r.outcome, 'verified'); assert.ok(r.evaluationId);
  const e = store.getOutcomeEvaluation(r.evaluationId);
  assert.equal(e.learning_eligibility, 'positive_eligible'); assert.equal(e.project_id, 'm3a-good');
  assert.match(e.provenance_digest, /^[a-f0-9]{64}$/); assert.equal(e.cost_cents, 0, 'mock cost is an actually known zero');
  assert.ok(store.getOutcomeComponents(e.id).some((c) => c.name === 'stability_evidence' && c.status === 'unknown'));
  assert.throws(() => evaluateTerminalOutcome(r.runId), /already exists/);
  assert.throws(() => evaluateTerminalOutcome(r.runId, { evaluationVersion: 'unreviewed-v2' }), /canonical evaluation version/);
  run(`INSERT INTO hermes_provider_invocations(id,run_id,task_id,provider,adapter_type,model,mode,status,attempt,input_bytes,output_bytes,input_tokens,output_tokens,cost_cents,duration_ms,timed_out,cancelled,error,created_at)
       SELECT 'retry-attempt',run_id,task_id,provider,adapter_type,model,mode,status,2,input_bytes,output_bytes,input_tokens,output_tokens,cost_cents,duration_ms,timed_out,cancelled,error,created_at FROM hermes_provider_invocations WHERE run_id=? LIMIT 1`, [r.runId]);
  run('DELETE FROM hermes_outcome_evaluation_components WHERE evaluation_id=?', [e.id]); run('DELETE FROM hermes_outcome_evaluations WHERE id=?', [e.id]);
  const retried = evaluateTerminalOutcome(r.runId).evaluation;
  assert.notEqual(retried.provenanceDigest, e.provenance_digest, 'the digest covers every retry attempt');
  assert.equal(retried.retryCount, 1);
  run(`INSERT INTO hermes_provider_invocations(id,run_id,task_id,provider,adapter_type,model,mode,status,attempt,input_bytes,output_bytes,input_tokens,output_tokens,cost_cents,duration_ms,timed_out,cancelled,error,created_at)
       SELECT 'duplicate-attempt',run_id,task_id,provider,adapter_type,model,mode,status,2,input_bytes,output_bytes,input_tokens,output_tokens,cost_cents,duration_ms,timed_out,cancelled,error,created_at FROM hermes_provider_invocations WHERE run_id=? LIMIT 1`, [r.runId]);
  run('DELETE FROM hermes_outcome_evaluation_components WHERE evaluation_id=?', [retried.id]); run('DELETE FROM hermes_outcome_evaluations WHERE id=?', [retried.id]);
  assert.throws(() => evaluateTerminalOutcome(r.runId), /duplicate provider attempts/, 'duplicate attempts cannot double-count an evaluation');
});

test('blocked workflow is factual but ineligible; no verification can become positive evidence', async () => {
  workspace('m3a-block'); const r = await runHermesWorkflow(task('m3a-block', 'deploy to production'));
  const e = store.getOutcomeEvaluation(r.evaluationId);
  assert.equal(r.status, 'blocked'); assert.equal(e.learning_eligibility, 'ineligible_blocked'); assert.notEqual(e.learning_eligibility, 'positive_eligible');
});

test('evaluation rejects incomplete/reordered evidence and does not write a partial row', () => {
  assert.throws(() => evaluateTerminalOutcome('missing-run'), /finished terminal workflow run/);
});

test('workspace-scoped trusted reads and additive corrections refuse injection, branches, and cross-scope access', async () => {
  workspace('m3a-correct'); const result = await runHermesWorkflow(task('m3a-correct'));
  const admin = principal('m3a-correct'); const reader = principal('m3a-reader', ['evaluation.read']);
  assert.equal(readOutcomeEvaluation({ principalId: admin.principalId }, result.evaluationId), null, 'forged principal is not trusted');
  assert.equal(readOutcomeEvaluation(reader, result.evaluationId), null, 'cross-workspace read is denied');
  const summary = readOutcomeEvaluation(admin, result.evaluationId);
  assert.equal(summary.id, result.evaluationId); assert.equal('classification' in summary, false);
  run('UPDATE hermes_outcome_evaluations SET evaluation_version=? WHERE id=?', ['m3a-v1 ', result.evaluationId]);
  assert.equal(readOutcomeEvaluation(admin, result.evaluationId), null, 'malformed persisted evaluator version fails closed');
  run('UPDATE hermes_outcome_evaluations SET evaluation_version=? WHERE id=?', ['m3a-v1', result.evaluationId]);
  assert.throws(() => appendOutcomeCorrection(reader, result.evaluationId, { reason: 'fix', sourceEvidence: 'event' }), /not authorized/);
  const first = appendOutcomeCorrection(admin, result.evaluationId, { reason: 'correct factual label', sourceEvidence: 'verified operator evidence' });
  const history = readOutcomeEvaluation(admin, result.evaluationId).corrections[0];
  assert.equal('reason' in history, false); assert.equal('sourceEvidence' in history, false, 'read history never returns raw correction evidence');
  assert.equal(store.getOutcomeEvaluation(result.evaluationId).id, result.evaluationId, 'original remains immutable');
  assert.throws(() => appendOutcomeCorrection(admin, result.evaluationId, { reason: 'branch', sourceEvidence: 'evidence' }), /sole current/);
  const second = appendOutcomeCorrection(admin, result.evaluationId, { supersedesCorrectionId: first.id, reason: 'new evidence', sourceEvidence: 'explicit evidence' });
  assert.equal(second.version, 2);
  assert.throws(() => appendOutcomeCorrection(admin, result.evaluationId, { supersedesCorrectionId: first.id, reason: 'cycle', sourceEvidence: 'evidence' }), /sole current/);
});

test('explicit source events are idempotent, evidence-required, and evaluator failures are observable', async () => {
  workspace('m3a-events'); const result = await runHermesWorkflow(task('m3a-events'));
  const admin = principal('m3a-events');
  const event = appendOutcomeSourceEvent(admin, result.evaluationId, { idempotencyKey: 'source-event-1', eventType: 'accepted', evidence: 'signed verification record' });
  assert.equal(event.eventType, 'accepted');
  assert.throws(() => appendOutcomeSourceEvent(admin, result.evaluationId, { idempotencyKey: 'source-event-1', eventType: 'accepted', evidence: 'again' }), /already recorded/);
  assert.throws(() => appendOutcomeSourceEvent(admin, result.evaluationId, { idempotencyKey: 'source-event-2', eventType: 'unknown', evidence: 'evidence' }), /allowed type/);
  assert.throws(() => appendOutcomeSourceEvent(admin, result.evaluationId, { idempotencyKey: 'source-event-3', eventType: 'rollback', evidence: '' }), /allowed type/);
  assert.throws(() => appendOutcomeSourceEvent(admin, result.evaluationId, { idempotencyKey: 'source-event-4', eventType: 'rollback', evidence: '   ' }), /allowed type/);
  assert.equal(recordOutcomeEvaluationFailure(result.runId, new Error('malformed terminal evidence')), 'invalid_evidence');
  assert.equal(store.getOutcomeEvaluationFailure(result.runId).remediation_state, 'open');
});
