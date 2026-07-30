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
const { run, get, all, execSql } = await import('../packages/task-engine/db.js');
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
function withoutImmutability(tables, callback) {
  const placeholders = tables.map(() => '?').join(',');
  const triggers = all(`SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name IN (${placeholders}) ORDER BY name`, tables);
  for (const trigger of triggers) execSql(`DROP TRIGGER ${trigger.name}`);
  try { return callback(); } finally { for (const trigger of triggers) execSql(trigger.sql); }
}
function deleteEvaluationForTest(evaluationId) {
  withoutImmutability(['hermes_outcome_evaluation_components','hermes_outcome_evaluations'], () => {
    run('DELETE FROM hermes_outcome_evaluation_components WHERE evaluation_id=?', [evaluationId]);
    run('DELETE FROM hermes_outcome_evaluations WHERE id=?', [evaluationId]);
  });
}

test('verified mock workflow creates one immutable positive factual evaluation with provenance', async () => {
  workspace('m3a-good'); const r = await runHermesWorkflow(task('m3a-good'));
  assert.equal(r.outcome, 'verified'); assert.ok(r.evaluationId);
  const e = store.getOutcomeEvaluation(r.evaluationId);
  assert.equal(e.learning_eligibility, 'positive_eligible'); assert.equal(e.project_id, 'm3a-good');
  assert.deepEqual(JSON.parse(e.classification), r.classification);
  assert.match(e.provenance_digest, /^[a-f0-9]{64}$/); assert.equal(e.cost_cents, 0, 'mock cost is an actually known zero');
  assert.ok(store.getOutcomeComponents(e.id).some((c) => c.name === 'stability_evidence' && c.status === 'unknown'));
  assert.throws(() => evaluateTerminalOutcome(r.runId), /already exists/);
  assert.throws(() => evaluateTerminalOutcome(r.runId, { evaluationVersion: 'unreviewed-v2' }), /canonical evaluation version/);
  run('UPDATE hermes_provider_invocations SET input_tokens=5,output_tokens=7,cost_cents=11 WHERE run_id=?', [r.runId]);
  run(`INSERT INTO hermes_provider_invocations(id,run_id,task_id,provider,adapter_type,model,mode,status,attempt,input_bytes,output_bytes,input_tokens,output_tokens,cost_cents,duration_ms,timed_out,cancelled,error,created_at)
       SELECT 'retry-attempt',run_id,task_id,provider,adapter_type,model,mode,status,2,input_bytes,output_bytes,13,17,19,duration_ms,timed_out,cancelled,error,created_at FROM hermes_provider_invocations WHERE run_id=? LIMIT 1`, [r.runId]);
  deleteEvaluationForTest(e.id);
  const retried = evaluateTerminalOutcome(r.runId).evaluation;
  assert.notEqual(retried.provenanceDigest, e.provenance_digest, 'the digest covers every retry attempt');
  assert.equal(retried.retryCount, 1);
  assert.deepEqual([retried.inputTokens,retried.outputTokens,retried.costCents],[18,24,30]);
  run(`INSERT INTO hermes_provider_invocations(id,run_id,task_id,provider,adapter_type,model,mode,status,attempt,input_bytes,output_bytes,input_tokens,output_tokens,cost_cents,duration_ms,timed_out,cancelled,error,created_at)
       SELECT 'duplicate-attempt',run_id,task_id,provider,adapter_type,model,mode,status,2,input_bytes,output_bytes,input_tokens,output_tokens,cost_cents,duration_ms,timed_out,cancelled,error,created_at FROM hermes_provider_invocations WHERE run_id=? LIMIT 1`, [r.runId]);
  deleteEvaluationForTest(retried.id);
  assert.throws(() => evaluateTerminalOutcome(r.runId), /duplicate provider attempts/, 'duplicate attempts cannot double-count an evaluation');
});

test('canonical Phase 3A evidence tables reject update and delete', async () => {
  workspace('m3a-immutable'); const result = await runHermesWorkflow(task('m3a-immutable'));
  const admin = principal('m3a-immutable');
  const correction = appendOutcomeCorrection(admin, result.evaluationId, { reason: 'verified correction', sourceEvidence: 'verified evidence' });
  const event = appendOutcomeSourceEvent(admin, result.evaluationId, { idempotencyKey: 'immutable-event', eventType: 'accepted', evidence: 'verified evidence' });
  assert.throws(() => run('UPDATE hermes_outcome_evaluations SET created_at=? WHERE id=?', ['1970-01-01T00:00:00.000Z', result.evaluationId]), /immutable/);
  assert.throws(() => run('DELETE FROM hermes_outcome_evaluation_components WHERE evaluation_id=?', [result.evaluationId]), /immutable/);
  assert.throws(() => run('UPDATE hermes_outcome_corrections SET reason=? WHERE id=?', ['changed', correction.id]), /immutable/);
  assert.throws(() => run('DELETE FROM hermes_outcome_source_events WHERE id=?', [event.id]), /immutable/);
});

test('blocked workflow is factual but ineligible; no verification can become positive evidence', async () => {
  workspace('m3a-block'); const r = await runHermesWorkflow(task('m3a-block', 'deploy to production'));
  const e = store.getOutcomeEvaluation(r.evaluationId);
  assert.equal(r.status, 'blocked'); assert.equal(e.learning_eligibility, 'ineligible_blocked'); assert.notEqual(e.learning_eligibility, 'positive_eligible');
  assert.deepEqual(JSON.parse(e.classification), r.classification);
});

test('free-form canonical channel actors remain readable without being treated as authority IDs', async () => {
  workspace('m3a-actor');
  const input = createUnifiedInput({ channel: 'jarvis', actorId: 'operator@example.com', channelKey: 'operator@example.com', workspaceId: 'm3a-actor', text: 'report status', idempotencyKey: 'm3a-actor-email' });
  const result = await runHermesWorkflow(getTask(input.taskId));
  assert.equal(store.getOutcomeEvaluation(result.evaluationId).user_id, 'operator@example.com');
  assert.equal(readOutcomeEvaluation(principal('m3a-actor'), result.evaluationId).id, result.evaluationId);
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
  const stored = store.getOutcomeEvaluation(result.evaluationId);
  withoutImmutability(['hermes_outcome_evaluations'], () => {
    run('UPDATE hermes_outcome_evaluations SET provenance_digest=? WHERE id=?', ['0'.repeat(64), result.evaluationId]);
    assert.equal(readOutcomeEvaluation(admin, result.evaluationId), null, 'a provenance-digest mismatch fails closed on reads');
    run('UPDATE hermes_outcome_evaluations SET provenance_digest=?,evaluation_version=? WHERE id=?', [stored.provenance_digest, 'm3a-v1 ', result.evaluationId]);
    assert.equal(readOutcomeEvaluation(admin, result.evaluationId), null, 'malformed persisted evaluator version fails closed');
    run('UPDATE hermes_outcome_evaluations SET evaluation_version=? WHERE id=?', ['m3a-v1', result.evaluationId]);
  });
  assert.throws(() => appendOutcomeCorrection(reader, result.evaluationId, { reason: 'fix', sourceEvidence: 'event' }), /not authorized/);
  const first = appendOutcomeCorrection(admin, result.evaluationId, { reason: 'correct factual label', sourceEvidence: 'verified operator evidence' });
  const history = readOutcomeEvaluation(admin, result.evaluationId).corrections[0];
  assert.equal('reason' in history, false); assert.equal('sourceEvidence' in history, false, 'read history never returns raw correction evidence');
  assert.equal(store.getOutcomeEvaluation(result.evaluationId).id, result.evaluationId, 'original remains immutable');
  assert.throws(() => appendOutcomeCorrection(admin, result.evaluationId, { reason: 'branch', sourceEvidence: 'evidence' }), /sole current/);
  const second = appendOutcomeCorrection(admin, result.evaluationId, { supersedesCorrectionId: first.id, reason: 'new evidence', sourceEvidence: 'explicit evidence' });
  assert.equal(second.version, 2);
  appendOutcomeCorrection(admin, result.evaluationId, { supersedesCorrectionId: second.id, reason: 'credential=hunter2-not-redacted', sourceEvidence: 'private_key=hunter2-not-redacted' });
  const redactedCorrection = store.getOutcomeCorrections(result.evaluationId).at(-1);
  assert.doesNotMatch(`${redactedCorrection.reason} ${redactedCorrection.source_evidence}`, /hunter2-not-redacted/);
  assert.throws(() => appendOutcomeCorrection(admin, result.evaluationId, { supersedesCorrectionId: first.id, reason: 'cycle', sourceEvidence: 'evidence' }), /sole current/);
  withoutImmutability(['hermes_outcome_corrections'], () => {
    run('UPDATE hermes_outcome_corrections SET workspace_id=? WHERE id=?', ['m3a-reader', first.id]);
    assert.equal(readOutcomeEvaluation(admin, result.evaluationId), null, 'a cross-workspace correction row fails closed on read');
    assert.throws(() => appendOutcomeCorrection(admin, result.evaluationId, { supersedesCorrectionId: second.id, reason: 'tampered', sourceEvidence: 'evidence' }), /intact evaluation/);
    run('UPDATE hermes_outcome_corrections SET workspace_id=? WHERE id=?', ['m3a-correct', first.id]);
  });
  run('UPDATE auth_principals SET status=?,disabled_at=? WHERE id=?', ['disabled', Date.now(), admin.principalId]);
  assert.equal(readOutcomeEvaluation(admin, result.evaluationId), null, 'a disabled evidence actor fails closed');
  run('UPDATE auth_principals SET status=?,disabled_at=? WHERE id=?', ['active', null, admin.principalId]);
  run('UPDATE auth_workspace_grants SET permissions=? WHERE principal_id=? AND workspace_id=?', ['["evaluation.read"]', admin.principalId, 'm3a-correct']);
  assert.equal(readOutcomeEvaluation(admin, result.evaluationId), null, 'an evidence actor without evaluation.correct fails closed');
  run('UPDATE auth_workspace_grants SET permissions=? WHERE principal_id=? AND workspace_id=?', ['["evaluation.correct","evaluation.read"]', admin.principalId, 'm3a-correct']);
  withoutImmutability(['hermes_outcome_corrections'], () => {
    run('UPDATE hermes_outcome_corrections SET created_at=? WHERE id=?', ['1970-01-01T00:00:00.000Z', second.id]);
    assert.equal(readOutcomeEvaluation(admin, result.evaluationId), null, 'a correction timestamp regression fails closed');
    run('UPDATE hermes_outcome_corrections SET created_at=?,actor_principal_id=? WHERE id=?', [new Date(Date.now() + 1).toISOString(), 'forged-actor', second.id]);
    assert.equal(readOutcomeEvaluation(admin, result.evaluationId), null, 'a forged correction actor fails closed');
  });
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
  assert.throws(() => appendOutcomeSourceEvent(admin, result.evaluationId, { idempotencyKey: 'source-event-5', eventType: 'rollback', evidence: '\u200b' }), /allowed type/, 'Unicode-only invisible evidence is not meaningful');
  assert.throws(() => appendOutcomeSourceEvent(admin, result.evaluationId, { idempotencyKey: 'ghp_1234567890abcdef', eventType: 'rollback', evidence: 'evidence' }), /idempotency key/);
  appendOutcomeSourceEvent(admin, result.evaluationId, { idempotencyKey: 'source-event-redacted', eventType: 'rollback', evidence: 'credential=hunter2-not-redacted' });
  assert.doesNotMatch(store.getOutcomeSourceEvents(result.evaluationId).at(-1).evidence, /hunter2-not-redacted/);
  assert.throws(() => appendOutcomeCorrection(admin, result.evaluationId, { reason: '   ', sourceEvidence: 'evidence' }), /reason and source evidence/);
  withoutImmutability(['hermes_outcome_source_events'], () => {
    run('UPDATE hermes_outcome_source_events SET workspace_id=? WHERE id=?', ['m3a-events-other', event.id]);
    assert.equal(readOutcomeEvaluation(admin, result.evaluationId), null, 'a cross-workspace source event fails closed on read');
  });
  assert.equal(recordOutcomeEvaluationFailure(result.runId, new Error('malformed terminal evidence')), 'invalid_evidence');
  assert.equal(store.getOutcomeEvaluationFailure(result.runId).remediation_state, 'open');
});

test('complete canonical provenance rejects hidden evidence, raw-secret equivalence, scope drift, malformed provider rows, and invalid time', async () => {
  workspace('m3a-integrity'); const result = await runHermesWorkflow(task('m3a-integrity', 'report status with Bearer ZYXWVUTSRQPONMLK'));
  const admin = principal('m3a-integrity');
  const safeObjective = store.getWorkflowRun(result.runId).objective;
  run('UPDATE hermes_workflow_runs SET objective=? WHERE id=?', ['report status with Bearer ZYXWVUTSRQPONMLK', result.runId]);
  assert.equal(readOutcomeEvaluation(admin, result.evaluationId), null, 'raw secret cannot be normalized into the stored digest');
  run('UPDATE hermes_workflow_runs SET objective=? WHERE id=?', [safeObjective, result.runId]);
  run(`INSERT INTO hermes_routing_decisions(id,run_id,task_id,classification,candidates,selected_provider,selected_agent,capabilities,rationale,created_at)
       SELECT 'hidden-route',run_id,task_id,classification,candidates,'mock','mock-agent',capabilities,'hidden','1970-01-01T00:00:00.000Z' FROM hermes_routing_decisions WHERE run_id=? LIMIT 1`, [result.runId]);
  assert.equal(readOutcomeEvaluation(admin, result.evaluationId), null, 'every routing row participates in provenance');
  run('DELETE FROM hermes_routing_decisions WHERE id=?', ['hidden-route']);
  withoutImmutability(['hermes_outcome_evaluations','hermes_outcome_evaluation_components'], () => {
    run('UPDATE hermes_outcome_evaluations SET created_at=? WHERE id=?', ['1970-01-01T00:00:00.000Z', result.evaluationId]);
    assert.equal(readOutcomeEvaluation(admin, result.evaluationId), null, 'evaluation time is provenance-bound');
    run('UPDATE hermes_outcome_evaluations SET created_at=? WHERE id=?', [store.getWorkflowRun(result.runId).finished_at, result.evaluationId]);
    run('UPDATE hermes_outcome_evaluation_components SET status=?,value=? WHERE evaluation_id=?', ['forged','forged',result.evaluationId]);
    assert.equal(readOutcomeEvaluation(admin, result.evaluationId), null, 'canonical component packet is validated');
  });

  workspace('m3a-scope-drift'); const scopeResult = await runHermesWorkflow(task('m3a-scope-drift'));
  deleteEvaluationForTest(scopeResult.evaluationId);
  run('UPDATE hermes_workflow_runs SET workspace_id=? WHERE id=?', ['m3a-integrity', scopeResult.runId]);
  assert.throws(() => evaluateTerminalOutcome(scopeResult.runId), /task scope/);

  workspace('m3a-provider-malformed'); const providerResult = await runHermesWorkflow(task('m3a-provider-malformed'));
  deleteEvaluationForTest(providerResult.evaluationId);
  run("UPDATE hermes_provider_invocations SET provider='forged',status='nonsense',input_tokens=1.5,duration_ms=-1,timed_out=2 WHERE run_id=?", [providerResult.runId]);
  assert.throws(() => evaluateTerminalOutcome(providerResult.runId), /provider evidence/);

  for (const [suffix, table, assignment, message, key = 'run_id'] of [
    ['routing','hermes_routing_decisions',`classification='{}',candidates='[null]',capabilities='[]'`,'routing evidence'],
    ['policy','hermes_policy_decisions',`decision='invented'`,'policy evidence'],
    ['verification','hermes_verification_results',`verifier='forged-verifier',checks='[{\"name\":\"invented\",\"passed\":true,\"detail\":\"forged\"}]'`,'verification evidence'],
    ['step-status','hermes_workflow_steps',`status='failed'`,'step evidence'],
    ['future-route','hermes_routing_decisions',`created_at='2099-01-01T00:00:00.000Z'`,'timestamp'],
    ['nested-secret','hermes_workflow_runs',`classification='{\"credential\":\"hunter2-not-redacted\"}'`,'terminal workflow run','id'],
  ]) {
    const workspaceId = `m3a-${suffix}-malformed`;
    workspace(workspaceId); const malformed = await runHermesWorkflow(task(workspaceId));
    deleteEvaluationForTest(malformed.evaluationId);
    run(`UPDATE ${table} SET ${assignment} WHERE ${key}=?`, [malformed.runId]);
    assert.throws(() => evaluateTerminalOutcome(malformed.runId), new RegExp(message));
  }

  workspace('m3a-time-malformed'); const timeResult = await runHermesWorkflow(task('m3a-time-malformed'));
  deleteEvaluationForTest(timeResult.evaluationId);
  run("UPDATE hermes_workflow_steps SET created_at='not-a-date' WHERE run_id=?", [timeResult.runId]);
  assert.throws(() => evaluateTerminalOutcome(timeResult.runId), /timestamp/);
});

test('completed verified outcomes reject contradictory routing, policy, invocation, or missing verification evidence', async () => {
  for (const [suffix, mutate, message] of [
    ['timeout-completed', (runId) => run("UPDATE hermes_provider_invocations SET status='completed',timed_out=1,cancelled=0 WHERE run_id=?", [runId]), 'provider evidence'],
    ['disabled-selected', (runId) => {
      const routing = all('SELECT candidates,selected_provider FROM hermes_routing_decisions WHERE run_id=?', [runId])[0];
      const candidates = JSON.parse(routing.candidates).map((candidate) => candidate.provider === routing.selected_provider ? { ...candidate, enabled: false } : candidate);
      run('UPDATE hermes_routing_decisions SET candidates=? WHERE run_id=?', [JSON.stringify(candidates), runId]);
    }, 'routing evidence'],
    ['approval-allow', (runId) => run("UPDATE hermes_policy_decisions SET decision='allow',requires_approval=1 WHERE run_id=?", [runId]), 'policy evidence'],
    ['missing-verification', (runId) => run('DELETE FROM hermes_verification_results WHERE run_id=?', [runId]), 'complete verified evidence'],
  ]) {
    const workspaceId = `m3a-contradictory-${suffix}`;
    workspace(workspaceId);
    const result = await runHermesWorkflow(task(workspaceId));
    deleteEvaluationForTest(result.evaluationId);
    mutate(result.runId);
    assert.throws(() => evaluateTerminalOutcome(result.runId), new RegExp(message), suffix);
  }
});

test('correction authorization and insertion are atomic against authority changes', async () => {
  workspace('m3a-auth-race'); const result = await runHermesWorkflow(task('m3a-auth-race'));
  const admin = principal('m3a-auth-race');
  execSql(`CREATE TRIGGER disable_after_allowed_audit AFTER INSERT ON auth_decisions
       WHEN NEW.allowed=1 AND NEW.principal_id='${admin.principalId}'
       BEGIN UPDATE auth_principals SET status='disabled',disabled_at=${Date.now()} WHERE id=NEW.principal_id; END`);
  assert.throws(() => appendOutcomeCorrection(admin, result.evaluationId, { reason: 'race', sourceEvidence: 'evidence' }), /not authorized/);
  assert.equal(all('SELECT * FROM hermes_outcome_corrections WHERE evaluation_id=?', [result.evaluationId]).length, 0);
  assert.equal(store.getOutcomeEvaluation(result.evaluationId).id, result.evaluationId);
});

test('correction and source-event insertion audit once and revalidate authority without a second decision write', async () => {
  for (const [suffix, append, table] of [
    ['correction', (admin, result) => appendOutcomeCorrection(admin, result.evaluationId, { reason: 'race', sourceEvidence: 'evidence' }), 'hermes_outcome_corrections'],
    ['source-event', (admin, result) => appendOutcomeSourceEvent(admin, result.evaluationId, { idempotencyKey: 'second-audit-race', eventType: 'accepted', evidence: 'evidence' }), 'hermes_outcome_source_events'],
  ]) {
    const workspaceId = `m3a-second-audit-${suffix}`;
    workspace(workspaceId);
    const result = await runHermesWorkflow(task(workspaceId));
    const admin = principal(workspaceId);
    execSql(`CREATE TRIGGER disable_on_second_allowed_${suffix.replace('-', '_')} AFTER INSERT ON auth_decisions
      WHEN NEW.allowed=1 AND NEW.principal_id='${admin.principalId}' AND
        (SELECT COUNT(*) FROM auth_decisions WHERE allowed=1 AND principal_id=NEW.principal_id)=2
      BEGIN UPDATE auth_principals SET status='disabled',disabled_at=${Date.now()} WHERE id=NEW.principal_id; END`);
    append(admin, result);
    assert.equal(all(`SELECT * FROM ${table} WHERE evaluation_id=?`, [result.evaluationId]).length, 1);
    assert.equal(all('SELECT * FROM auth_decisions WHERE allowed=1 AND principal_id=?', [admin.principalId]).length, 1);
    assert.equal(get('SELECT status FROM auth_principals WHERE id=?', [admin.principalId]).status, 'active');
  }
});
