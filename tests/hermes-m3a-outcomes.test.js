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
const { getTask, setFlag } = await import('../packages/task-engine/tasks.js');
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
function servicePrincipal(workspaceId, permissions = ['evaluation.read','evaluation.correct']) {
  const principalId = `m3a-service-${workspaceId}`;
  const credentialReference = `m3a-service-ref-${workspaceId}`;
  run('INSERT INTO auth_principals VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    [principalId,'service',principalId,'service',credentialReference,'active',authzNow,null,null,null,1,authzNow]);
  run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [`${principalId}-grant`,principalId,workspaceId,'service',JSON.stringify([...permissions].sort()),'active',1,null,authzNow,null,null,'test',1,authzNow]);
  return { principal: authz.resolveServiceContext(principalId, credentialReference), principalId };
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
  run('UPDATE hermes_provider_invocations SET input_tokens=5,output_tokens=7,cost_cents=0 WHERE run_id=?', [r.runId]);
  run(`INSERT INTO hermes_provider_invocations(id,run_id,task_id,provider,adapter_type,model,mode,status,attempt,input_bytes,output_bytes,input_tokens,output_tokens,cost_cents,duration_ms,timed_out,cancelled,error,created_at)
       SELECT 'retry-attempt',run_id,task_id,provider,adapter_type,model,mode,status,2,input_bytes,output_bytes,13,17,0,duration_ms,timed_out,cancelled,error,created_at FROM hermes_provider_invocations WHERE run_id=? LIMIT 1`, [r.runId]);
  run("UPDATE hermes_provider_invocations SET status='failed' WHERE run_id=? AND attempt=1", [r.runId]);
  run('UPDATE hermes_workflow_runs SET cost_cents=0 WHERE id=?', [r.runId]);
  const executed = all("SELECT detail FROM hermes_workflow_steps WHERE run_id=? AND name='hermes.executed'", [r.runId])[0];
  run("UPDATE hermes_workflow_steps SET detail=? WHERE run_id=? AND name='hermes.executed'", [JSON.stringify({ ...JSON.parse(executed.detail), attempts: 2 }), r.runId]);
  deleteEvaluationForTest(e.id);
  const retried = evaluateTerminalOutcome(r.runId).evaluation;
  assert.notEqual(retried.provenanceDigest, e.provenance_digest, 'the digest covers every retry attempt');
  assert.equal(retried.retryCount, 1);
  assert.deepEqual([retried.inputTokens,retried.outputTokens,retried.costCents],[18,24,0]);
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

test('non-success outcomes require their exact causal evidence matrix', async () => {
  workspace('m3a-terminal-matrix'); const completed = await runHermesWorkflow(task('m3a-terminal-matrix'));
  deleteEvaluationForTest(completed.evaluationId);
  run("UPDATE hermes_workflow_runs SET status='blocked',outcome='approval_required' WHERE id=?", [completed.runId]);
  run(`UPDATE hermes_workflow_steps SET name='hermes.failed',status='failed',detail='{"reason":"approval required"}'
    WHERE run_id=? AND name='hermes.completed'`, [completed.runId]);
  assert.throws(() => evaluateTerminalOutcome(completed.runId), /terminal evidence matrix/);

  workspace('m3a-policy-matrix'); const denied = await runHermesWorkflow(task('m3a-policy-matrix', 'deploy to production'));
  deleteEvaluationForTest(denied.evaluationId);
  run("UPDATE hermes_workflow_runs SET outcome='approval_required' WHERE id=?", [denied.runId]);
  assert.throws(() => evaluateTerminalOutcome(denied.runId), /terminal evidence matrix/);

  workspace('m3a-approval-risk'); const approval = await runHermesWorkflow(task('m3a-approval-risk', 'refactor the parser module'));
  assert.equal(approval.outcome, 'approval_required');
  deleteEvaluationForTest(approval.evaluationId);
  const classified = JSON.parse(get("SELECT detail FROM hermes_workflow_steps WHERE run_id=? AND name='hermes.classified'", [approval.runId]).detail);
  const routing = get('SELECT classification,rationale FROM hermes_routing_decisions WHERE run_id=?', [approval.runId]);
  run("UPDATE hermes_workflow_steps SET detail=? WHERE run_id=? AND name='hermes.classified'",
    [JSON.stringify({ ...classified, risk: 'low' }), approval.runId]);
  run('UPDATE hermes_routing_decisions SET classification=?,rationale=? WHERE run_id=?',
    [JSON.stringify({ ...JSON.parse(routing.classification), risk: 'low' }), routing.rationale.replace('risk medium', 'risk low'), approval.runId]);
  assert.throws(() => evaluateTerminalOutcome(approval.runId), /terminal evidence matrix/, 'approval-required evidence needs canonical medium risk');

  workspace('m3a-budget-cause'); const budget = await runHermesWorkflow(task('m3a-budget-cause'));
  deleteEvaluationForTest(budget.evaluationId);
  run("DELETE FROM hermes_verification_results WHERE run_id=?", [budget.runId]);
  run("DELETE FROM hermes_workflow_steps WHERE run_id=? AND name IN ('hermes.verified','hermes.memory_candidate_recorded')", [budget.runId]);
  all('SELECT id FROM hermes_workflow_steps WHERE run_id=? ORDER BY seq', [budget.runId])
    .forEach((step, index) => run('UPDATE hermes_workflow_steps SET seq=? WHERE id=?', [index + 1, step.id]));
  run("UPDATE hermes_workflow_runs SET status='failed',outcome='budget_exhausted' WHERE id=?", [budget.runId]);
  run(`UPDATE hermes_workflow_steps SET name='hermes.failed',status='failed',
    detail='{"reason":"budget exhausted","costCents":0,"ceilingCents":0}' WHERE run_id=? AND name='hermes.completed'`, [budget.runId]);
  assert.throws(() => evaluateTerminalOutcome(budget.runId), /canonical step detail/, 'budget exhaustion needs cost above the canonical ceiling');

  workspace('m3a-requested-provider');
  const requestedTask = { ...task('m3a-requested-provider'), requestedProvider: 'anthropic' };
  const requested = await runHermesWorkflow(requestedTask);
  assert.equal(requested.outcome, 'real_provider_blocked');
  deleteEvaluationForTest(requested.evaluationId);
  run(`UPDATE hermes_workflow_steps SET detail='{"reason":"real provider blocked","requested":"forged-provider"}'
    WHERE run_id=? AND name='hermes.failed'`, [requested.runId]);
  assert.throws(() => evaluateTerminalOutcome(requested.runId), /canonical step detail/, 'provider refusal is bound to the canonical requested provider');

  run(`UPDATE hermes_workflow_steps SET detail='{"channel":"api","profile":"test","requestedProvider":"forged-provider"}'
    WHERE run_id=? AND name='hermes.received'`, [requested.runId]);
  run(`UPDATE hermes_workflow_steps SET detail='{"reason":"real provider blocked","requested":"forged-provider"}'
    WHERE run_id=? AND name='hermes.failed'`, [requested.runId]);
  run("UPDATE hermes_workflow_runs SET provider='forged-provider' WHERE id=?", [requested.runId]);
  assert.throws(
    () => evaluateTerminalOutcome(requested.runId),
    /canonical intake/,
    'consistent provider claim forgery cannot replace the independently persisted request',
  );
});

test('canonical step details and registry-derived routing identity reject forged claims', async () => {
  for (const [suffix, mutate, message] of [
    ['profile', (runId) => {
      const received = JSON.parse(get("SELECT detail FROM hermes_workflow_steps WHERE run_id=? AND name='hermes.received'", [runId]).detail);
      run("UPDATE hermes_workflow_steps SET detail=? WHERE run_id=? AND name='hermes.received'", [JSON.stringify({ ...received, profile: 'forged-profile' }), runId]);
    }, 'runtime profile'],
    ['received-extra', (runId) => {
      const received = JSON.parse(get("SELECT detail FROM hermes_workflow_steps WHERE run_id=? AND name='hermes.received'", [runId]).detail);
      run("UPDATE hermes_workflow_steps SET detail=? WHERE run_id=? AND name='hermes.received'", [JSON.stringify({ ...received, userAccepted: true }), runId]);
    }, 'canonical intake'],
    ['executed-extra', (runId) => {
      const executed = JSON.parse(get("SELECT detail FROM hermes_workflow_steps WHERE run_id=? AND name='hermes.executed'", [runId]).detail);
      run("UPDATE hermes_workflow_steps SET detail=? WHERE run_id=? AND name='hermes.executed'", [JSON.stringify({ ...executed, userAccepted: true }), runId]);
    }, 'execution evidence'],
    ['memory-null', (runId) => {
      run("UPDATE hermes_workflow_steps SET detail='null' WHERE run_id=? AND name='hermes.memory_candidate_recorded'", [runId]);
    }, 'canonical step detail'],
    ['agent', (runId) => {
      run("UPDATE hermes_routing_decisions SET selected_agent='forged-agent' WHERE run_id=?", [runId]);
      run("UPDATE hermes_workflow_runs SET agent='forged-agent' WHERE id=?", [runId]);
      const routed = JSON.parse(get("SELECT detail FROM hermes_workflow_steps WHERE run_id=? AND name='hermes.routed'", [runId]).detail);
      run("UPDATE hermes_workflow_steps SET detail=? WHERE run_id=? AND name='hermes.routed'", [JSON.stringify({ ...routed, agent: 'forged-agent' }), runId]);
    }, 'routing.*registry'],
    ['candidates', (runId) => {
      const candidates = JSON.parse(get('SELECT candidates FROM hermes_routing_decisions WHERE run_id=?', [runId]).candidates);
      run('UPDATE hermes_routing_decisions SET candidates=? WHERE run_id=?', [JSON.stringify(candidates.filter(({ provider }) => provider === 'mock')), runId]);
    }, 'routing.*registry'],
    ['rationale', (runId) => {
      run("UPDATE hermes_routing_decisions SET rationale=rationale || ' forged' WHERE run_id=?", [runId]);
    }, 'routing.*registry'],
  ]) {
    const workspaceId = `m3a-canonical-${suffix}`;
    workspace(workspaceId); const result = await runHermesWorkflow(task(workspaceId));
    deleteEvaluationForTest(result.evaluationId); mutate(result.runId);
    assert.throws(() => evaluateTerminalOutcome(result.runId), new RegExp(message), suffix);
  }

  workspace('m3a-null-classification'); const denied = await runHermesWorkflow(task('m3a-null-classification', 'deploy to production'));
  deleteEvaluationForTest(denied.evaluationId);
  run("UPDATE hermes_workflow_steps SET detail='null' WHERE run_id=? AND name='hermes.classified'", [denied.runId]);
  assert.throws(() => evaluateTerminalOutcome(denied.runId), /classification evidence/);

  workspace('m3a-null-failed'); const failed = await runHermesWorkflow(task('m3a-null-failed', 'deploy to production'));
  deleteEvaluationForTest(failed.evaluationId);
  run("UPDATE hermes_workflow_steps SET detail='null' WHERE run_id=? AND name='hermes.failed'", [failed.runId]);
  assert.throws(() => evaluateTerminalOutcome(failed.runId), /canonical step detail/);
});

test('retry timeout and cancellation facts aggregate across every provider attempt', async () => {
  workspace('m3a-attempt-signals'); const result = await runHermesWorkflow(task('m3a-attempt-signals'));
  deleteEvaluationForTest(result.evaluationId);
  run("UPDATE hermes_provider_invocations SET status='timeout',timed_out=1,attempt=1 WHERE run_id=?", [result.runId]);
  run(`INSERT INTO hermes_provider_invocations(id,run_id,task_id,provider,adapter_type,model,mode,status,attempt,input_bytes,output_bytes,input_tokens,output_tokens,cost_cents,duration_ms,timed_out,cancelled,error,created_at)
    SELECT 'recovered-attempt',run_id,task_id,provider,adapter_type,model,mode,'completed',2,input_bytes,output_bytes,input_tokens,output_tokens,cost_cents,duration_ms,0,0,NULL,created_at
    FROM hermes_provider_invocations WHERE run_id=? LIMIT 1`, [result.runId]);
  const executed = JSON.parse(get("SELECT detail FROM hermes_workflow_steps WHERE run_id=? AND name='hermes.executed'", [result.runId]).detail);
  run("UPDATE hermes_workflow_steps SET detail=? WHERE run_id=? AND name='hermes.executed'", [JSON.stringify({ ...executed, attempts: 2 }), result.runId]);
  const evaluation = evaluateTerminalOutcome(result.runId).evaluation;
  assert.equal(evaluation.timedOut, true);
  const timeout = store.getOutcomeComponents(evaluation.id).find(({ name }) => name === 'timeout');
  assert.equal(timeout.value, 'true');
});

test('retry-stop and budget-overage terminal paths create canonical factual evaluations', async () => {
  const devEnv = {
    ...process.env,
    HERMES_RUNTIME_PROFILE: 'development',
    HERMES_DEV_REAL_PROVIDER: 'true',
    HERMES_DEV_PROVIDER_ALLOWLIST: 'anthropic',
    HERMES_DEV_WORKSPACE_ALLOWLIST: root,
    HERMES_DEV_ANTHROPIC_MAX_COST_CENTS: '25',
  };
  workspace('m3a-retry-stop');
  let calls = 0;
  const stopAdapter = {
    async execute() {
      calls += 1;
      setFlag('emergency_stop', 'active');
      return {
        ok: false, provider: 'anthropic', adapterType: 'api', model: 'claude-sonnet-4-5', mode: 'real',
        summary: '', artifacts: [], usage: { inputTokens: null, outputTokens: null, costCents: null },
        inputBytes: 0, outputBytes: 0, timedOut: false, cancelled: false, error: 'fixture failure',
      };
    },
  };
  try {
    setFlag('emergency_stop', 'inactive');
    const stopped = await runHermesWorkflow({ ...task('m3a-retry-stop'), requestedProvider: 'anthropic' }, {
      adapterOverrides: { anthropic: stopAdapter }, env: devEnv,
    });
    assert.equal(calls, 1);
    assert.equal(stopped.outcome, 'execution_blocked');
    assert.ok(stopped.evaluationId, 'a stop before retry remains canonically evaluable');
    assert.equal(store.getProviderInvocations(stopped.runId).length, 1);
  } finally {
    setFlag('emergency_stop', 'inactive');
  }

  workspace('m3a-budget-overage');
  const overageAdapter = {
    async execute() {
      return {
        ok: true, provider: 'anthropic', adapterType: 'api', model: 'claude-sonnet-4-5', mode: 'real',
        summary: 'bounded fixture', artifacts: [], usage: { inputTokens: 1, outputTokens: 1, costCents: 999 },
        inputBytes: 10, outputBytes: 10, timedOut: false, cancelled: false, error: null,
      };
    },
  };
  const overage = await runHermesWorkflow({ ...task('m3a-budget-overage'), requestedProvider: 'anthropic' }, {
    adapterOverrides: { anthropic: overageAdapter }, env: devEnv,
  });
  assert.equal(overage.outcome, 'budget_exhausted');
  assert.ok(overage.evaluationId, 'an actual cost above the canonical ceiling remains evaluable');
  deleteEvaluationForTest(overage.evaluationId);
  const received = JSON.parse(get("SELECT detail FROM hermes_workflow_steps WHERE run_id=? AND name='hermes.received'", [overage.runId]).detail);
  run("UPDATE hermes_workflow_steps SET detail=? WHERE run_id=? AND name='hermes.received'",
    [JSON.stringify({ ...received, requestedProvider: null }), overage.runId]);
  assert.throws(() => evaluateTerminalOutcome(overage.runId), /canonical intake/, 'a real route cannot be relabelled as a default-provider request');
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
  run('UPDATE tasks SET actor_id=? WHERE id=?', ['forged-task-actor', store.getWorkflowRun(result.runId).task_id]);
  assert.equal(readOutcomeEvaluation(admin, result.evaluationId), null, 'canonical task identity is provenance-bound after evaluation');
  run('UPDATE tasks SET actor_id=? WHERE id=?', ['m3a-user', store.getWorkflowRun(result.runId).task_id]);
  const taskId = store.getWorkflowRun(result.runId).task_id;
  const taskRow = get('SELECT budget_cents,idempotency_key,authority_class,policy_decision FROM tasks WHERE id=?', [taskId]);
  for (const [column, forged] of [
    ['budget_cents', taskRow.budget_cents + 1],
    ['idempotency_key', 'forged-idempotency'],
    ['authority_class', 'forged-authority'],
    ['policy_decision', 'forged-policy'],
  ]) {
    run(`UPDATE tasks SET ${column}=? WHERE id=?`, [forged, taskId]);
    assert.equal(readOutcomeEvaluation(admin, result.evaluationId), null, `${column} is bound into canonical normalized task provenance`);
    run(`UPDATE tasks SET ${column}=? WHERE id=?`, [taskRow[column], taskId]);
  }
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

test('outcome reads authorize before provenance or subordinate-evidence work', async () => {
  workspace('m3a-read-order-owner');
  const result = await runHermesWorkflow(task('m3a-read-order-owner'));
  workspace('m3a-read-order-stranger');
  const stranger = principal('m3a-read-order-stranger', ['evaluation.read']);
  const owner = principal('m3a-read-order-owner', ['evaluation.read']);

  // `readableEvaluation` walks the complete provenance graph and its subordinate correction/event
  // evidence. Pin the call order directly so a future refactor cannot reintroduce the cross-workspace
  // timing oracle while preserving the same null response body.
  const source = fs.readFileSync(new URL('../packages/hermes-orchestrator/outcome.js', import.meta.url), 'utf8');
  const readBody = source.slice(source.indexOf('export function readOutcomeEvaluation'));
  assert.ok(readBody.indexOf('canReadEvaluation') < readBody.indexOf('readableEvaluation(evaluation)'),
    'authorization must be decided before provenance validation or subordinate-evidence reads');
  assert.equal(readOutcomeEvaluation(stranger, result.evaluationId), null, 'a cross-workspace read is refused');
  assert.equal(readOutcomeEvaluation(owner, result.evaluationId).id, result.evaluationId,
    'the owning workspace still receives an intact evaluation');
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

test('persisted service evidence requires a canonical current service credential record', async () => {
  workspace('m3a-service-evidence');
  const result = await runHermesWorkflow(task('m3a-service-evidence'));
  const service = servicePrincipal('m3a-service-evidence');
  appendOutcomeSourceEvent(service.principal, result.evaluationId, {
    idempotencyKey: 'service-evidence-event', eventType: 'accepted', evidence: 'verified service evidence',
  });
  const admin = principal('m3a-service-evidence');
  assert.equal(readOutcomeEvaluation(admin, result.evaluationId).id, result.evaluationId);
  run('UPDATE auth_principals SET credential_reference=NULL WHERE id=?', [service.principalId]);
  assert.equal(readOutcomeEvaluation(admin, result.evaluationId), null, 'malformed current service credential state fails evidence reads closed');
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
  assert.throws(() => evaluateTerminalOutcome(timeResult.runId), /timestamp|ordered/);
});

// Forges a provenance row to a timestamp that is deterministically before its stage window.
//
// These forgeries used to borrow an adjacent step's or the run's own timestamp. `rowsWithinStage`
// accepts `timestamp >= start`, and `now()` is only millisecond-resolution, so whenever the borrowed
// step and the stage's opening step landed in the same millisecond - routine on a fast host - the
// forged value was still inside its window, no chronology violation existed, and the assertion failed
// with "Missing expected exception". That made five cases here host-speed dependent.
//
// A bare early literal does not work either: `validateLinks` runs first and requires every row to sit
// within `[run.started_at, run.finished_at]`, so an out-of-bounds value raises the provenance error
// instead of the chronology one. Lowering the run's own start to the same instant keeps the row in
// bounds while putting it unambiguously before every step, so the intended chronology violation is
// the one that fires, on every machine.
const BEFORE_ANY_STAGE = '2000-01-01T00:00:00.000Z';
function forgeChronology(runId, statement) {
  run(`UPDATE hermes_workflow_runs SET started_at=? WHERE id=?`, [BEFORE_ANY_STAGE, runId]);
  run(statement, [BEFORE_ANY_STAGE, runId]);
}

test('completed verified outcomes reject contradictory routing, policy, invocation, or missing verification evidence', async () => {
  for (const [suffix, mutate, message] of [
    ['timeout-completed', (runId) => run("UPDATE hermes_provider_invocations SET status='completed',timed_out=1,cancelled=0 WHERE run_id=?", [runId]), 'provider evidence'],
    ['disabled-selected', (runId) => {
      const routing = all('SELECT candidates,selected_provider FROM hermes_routing_decisions WHERE run_id=?', [runId])[0];
      const candidates = JSON.parse(routing.candidates).map((candidate) => candidate.provider === routing.selected_provider ? { ...candidate, enabled: false } : candidate);
      run('UPDATE hermes_routing_decisions SET candidates=? WHERE run_id=?', [JSON.stringify(candidates), runId]);
    }, 'routing evidence'],
    ['approval-allow', (runId) => run("UPDATE hermes_policy_decisions SET decision='allow',requires_approval=1 WHERE run_id=?", [runId]), 'policy evidence'],
    ['missing-verification', (runId) => run('DELETE FROM hermes_verification_results WHERE run_id=?', [runId]), 'verification evidence'],
    ['verified-step', (runId) => run(`UPDATE hermes_workflow_steps SET detail='{"passed":false,"detail":"all deterministic checks passed"}' WHERE run_id=? AND name='hermes.verified'`, [runId]), 'verification evidence'],
    ['incomplete-checks', (runId) => run(`UPDATE hermes_verification_results SET checks='[{"name":"execution_ok","passed":true,"detail":"execution reported ok"}]' WHERE run_id=?`, [runId]), 'verification evidence'],
    ['two-successes', (runId) => {
      run('UPDATE hermes_provider_invocations SET attempt=2 WHERE run_id=?', [runId]);
      run(`INSERT INTO hermes_provider_invocations(id,run_id,task_id,provider,adapter_type,model,mode,status,attempt,input_bytes,output_bytes,input_tokens,output_tokens,cost_cents,duration_ms,timed_out,cancelled,error,created_at)
        SELECT 'prior-success',run_id,task_id,provider,adapter_type,model,mode,status,1,input_bytes,output_bytes,input_tokens,output_tokens,cost_cents,duration_ms,timed_out,cancelled,error,created_at FROM hermes_provider_invocations WHERE run_id=?`, [runId]);
    }, 'retry evidence'],
    ['run-agent', (runId) => run("UPDATE hermes_workflow_runs SET agent='forged-agent' WHERE id=?", [runId]), 'run routing evidence'],
    ['run-cost', (runId) => run('UPDATE hermes_workflow_runs SET cost_cents=99 WHERE id=?', [runId]), 'run cost evidence'],
    ['run-actor', (runId) => run("UPDATE hermes_workflow_runs SET actor_id='forged-actor' WHERE id=?", [runId]), 'task scope'],
    ['run-channel', (runId) => run("UPDATE hermes_workflow_runs SET channel='telegram' WHERE id=?", [runId]), 'task scope'],
    ['run-objective', (runId) => run("UPDATE hermes_workflow_runs SET objective='different sanitized objective' WHERE id=?", [runId]), 'task scope'],
    ['provider-mode', (runId) => run("UPDATE hermes_provider_invocations SET mode='real' WHERE run_id=?", [runId]), 'provider evidence'],
    ['provider-adapter', (runId) => run("UPDATE hermes_provider_invocations SET adapter_type='api' WHERE run_id=?", [runId]), 'provider evidence'],
    ['provider-model', (runId) => run("UPDATE hermes_provider_invocations SET model='forged-model' WHERE run_id=?", [runId]), 'provider evidence'],
    ['mock-cost', (runId) => run('UPDATE hermes_provider_invocations SET cost_cents=1 WHERE run_id=?', [runId]), 'mock provider cost'],
    ['policy-step', (runId) => run("UPDATE hermes_policy_decisions SET action_class='forged.action' WHERE run_id=?", [runId]), 'policy evidence'],
    ['step-interval', (runId) => run(`UPDATE hermes_workflow_steps SET started_at=(SELECT created_at FROM hermes_workflow_steps WHERE run_id=? AND name='hermes.received'),
      finished_at=(SELECT created_at FROM hermes_workflow_steps WHERE run_id=? AND name='hermes.received') WHERE run_id=? AND name='hermes.routed'`, [runId, runId, runId]), 'ordered|step evidence'],
    ['policy-chronology', (runId) => forgeChronology(runId, `UPDATE hermes_policy_decisions SET created_at=? WHERE run_id=?`), 'chronology'],
    ['routing-chronology', (runId) => forgeChronology(runId, `UPDATE hermes_routing_decisions SET created_at=? WHERE run_id=?`), 'chronology'],
    ['invocation-chronology', (runId) => forgeChronology(runId, `UPDATE hermes_provider_invocations SET created_at=? WHERE run_id=?`), 'chronology'],
    ['prior-invocation-chronology', (runId) => {
      forgeChronology(runId, "UPDATE hermes_provider_invocations SET status='failed',attempt=1,created_at=? WHERE run_id=?");
      run(`INSERT INTO hermes_provider_invocations(id,run_id,task_id,provider,adapter_type,model,mode,status,attempt,input_bytes,output_bytes,input_tokens,output_tokens,cost_cents,duration_ms,timed_out,cancelled,error,created_at)
        SELECT 'valid-retry',run_id,task_id,provider,adapter_type,model,mode,'completed',2,input_bytes,output_bytes,input_tokens,output_tokens,cost_cents,duration_ms,0,0,NULL,
          (SELECT created_at FROM hermes_workflow_steps WHERE run_id=? AND name='hermes.executed') FROM hermes_provider_invocations WHERE run_id=? LIMIT 1`, [runId, runId]);
      const executed = JSON.parse(get("SELECT detail FROM hermes_workflow_steps WHERE run_id=? AND name='hermes.executed'", [runId]).detail);
      run("UPDATE hermes_workflow_steps SET detail=? WHERE run_id=? AND name='hermes.executed'", [JSON.stringify({ ...executed, attempts: 2 }), runId]);
    }, 'chronology'],
    ['verification-chronology', (runId) => forgeChronology(runId, `UPDATE hermes_verification_results SET created_at=? WHERE run_id=?`), 'chronology'],
    ['terminal-outcome', (runId) => {
      run("UPDATE hermes_workflow_runs SET status='failed',outcome='verified' WHERE id=?", [runId]);
      run(`UPDATE hermes_workflow_steps SET name='hermes.failed',status='failed',detail='{"reason":"forged"}' WHERE run_id=? AND name='hermes.completed'`, [runId]);
    }, 'terminal evidence'],
  ]) {
    const workspaceId = `m3a-contradictory-${suffix}`;
    workspace(workspaceId);
    const result = await runHermesWorkflow(task(workspaceId));
    deleteEvaluationForTest(result.evaluationId);
    mutate(result.runId);
    assert.throws(() => evaluateTerminalOutcome(result.runId), new RegExp(message), suffix);
  }
});

test('execution-blocked terminal runs produce factual evidence and reject forged no-invocation execution steps', async () => {
  workspace('m3a-execution-blocked');
  const result = await runHermesWorkflow(task('m3a-execution-blocked'), { env: { ...process.env, BLACKSPIRE_RUNTIME_MODE: 'production' } });
  assert.equal(result.status, 'failed');
  assert.equal(result.outcome, 'execution_blocked');
  assert.ok(result.evaluationId);
  assert.equal(store.getOutcomeEvaluation(result.evaluationId).learning_eligibility, 'negative_factual');
  assert.equal(store.getOutcomeEvaluation(result.evaluationId).execution_mode, 'blocked');
  deleteEvaluationForTest(result.evaluationId);
  run("UPDATE hermes_workflow_steps SET detail='null' WHERE run_id=? AND name='hermes.executed'", [result.runId]);
  assert.throws(() => evaluateTerminalOutcome(result.runId), /blocked execution evidence/);
  run(`UPDATE hermes_workflow_steps SET detail='{"provider":"totally-forged","executionMode":"real","ok":true,"attempts":999,"durationMs":0,"timedOut":true,"cancelled":true,"artifactCount":0}'
    WHERE run_id=? AND name='hermes.executed'`, [result.runId]);
  assert.throws(() => evaluateTerminalOutcome(result.runId), /blocked execution evidence/);

  workspace('m3a-approval-blocked');
  const approvalBlocked = await runHermesWorkflow(task('m3a-approval-blocked', 'refactor the parser module'));
  assert.equal(approvalBlocked.outcome, 'approval_required');
  assert.equal(store.getOutcomeEvaluation(approvalBlocked.evaluationId).execution_mode, 'blocked');
});

test('edit verification is bound to the canonical executed artifact count', async () => {
  workspace('m3a-artifact-binding');
  const result = await runHermesWorkflow(task('m3a-artifact-binding', 'write documentation summary'));
  assert.equal(result.outcome, 'verified');
  deleteEvaluationForTest(result.evaluationId);
  const executed = JSON.parse(get("SELECT detail FROM hermes_workflow_steps WHERE run_id=? AND name='hermes.executed'", [result.runId]).detail);
  run("UPDATE hermes_workflow_steps SET detail=? WHERE run_id=? AND name='hermes.executed'", [JSON.stringify({ ...executed, artifactCount: 0 }), result.runId]);
  assert.throws(() => evaluateTerminalOutcome(result.runId), /artifact verification evidence/);
});

test('correction authorization and insertion are atomic against authority changes', async () => {
  workspace('m3a-auth-race'); const result = await runHermesWorkflow(task('m3a-auth-race'));
  const admin = principal('m3a-auth-race');
  execSql(`CREATE TRIGGER disable_after_allowed_audit AFTER INSERT ON auth_decisions
       WHEN NEW.allowed=1 AND NEW.principal_id='${admin.principalId}'
       BEGIN UPDATE auth_principals SET status='disabled',disabled_at=${Date.now()} WHERE id=NEW.principal_id; END`);
  assert.throws(() => appendOutcomeCorrection(admin, result.evaluationId, { reason: 'race', sourceEvidence: 'evidence' }), /not authorized/);
  assert.equal(all('SELECT * FROM hermes_outcome_corrections WHERE evaluation_id=?', [result.evaluationId]).length, 0);
  assert.equal(all('SELECT * FROM auth_decisions WHERE principal_id=?', [admin.principalId]).length, 1, 'the denied post-audit revalidation does not erase the durable decision');
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

test('denied evidence mutations retain their authorization audits and reads do not fabricate correction decisions', async () => {
  workspace('m3a-audit-durable');
  const result = await runHermesWorkflow(task('m3a-audit-durable'));
  const reader = principal('m3a-audit-durable', ['evaluation.read']);
  assert.throws(() => appendOutcomeCorrection(reader, result.evaluationId, { reason: 'denied', sourceEvidence: 'evidence' }), /not authorized/);
  assert.throws(() => appendOutcomeSourceEvent(reader, result.evaluationId, { idempotencyKey: 'denied-event', eventType: 'accepted', evidence: 'evidence' }), /not authorized/);
  const denied = all("SELECT permission,allowed FROM auth_decisions WHERE principal_id=? AND permission='evaluation.correct' ORDER BY created_at,id", [reader.principalId]);
  assert.deepEqual(denied, [{ permission: 'evaluation.correct', allowed: 0 }, { permission: 'evaluation.correct', allowed: 0 }]);

  const admin = principal('m3a-audit-durable');
  appendOutcomeCorrection(admin, result.evaluationId, { reason: 'valid', sourceEvidence: 'evidence' });
  const correctBefore = all("SELECT * FROM auth_decisions WHERE principal_id=? AND permission='evaluation.correct'", [admin.principalId]).length;
  assert.equal(readOutcomeEvaluation(admin, result.evaluationId).id, result.evaluationId);
  assert.equal(all("SELECT * FROM auth_decisions WHERE principal_id=? AND permission='evaluation.correct'", [admin.principalId]).length, correctBefore);
  assert.equal(all("SELECT * FROM auth_decisions WHERE principal_id=? AND permission='evaluation.read'", [admin.principalId]).length, 1);
  const correction = store.getOutcomeCorrections(result.evaluationId)[0];
  const evaluationCreatedAt = store.getOutcomeEvaluation(result.evaluationId).created_at;
  withoutImmutability(['hermes_outcome_corrections'], () => run('UPDATE hermes_outcome_corrections SET created_at=? WHERE id=?', [evaluationCreatedAt, correction.id]));
  const afterEvidence = Date.parse(evaluationCreatedAt) + 1;
  run('UPDATE auth_principals SET issued_at=?,created_at=? WHERE id=?', [afterEvidence, afterEvidence, admin.principalId]);
  assert.equal(readOutcomeEvaluation(admin, result.evaluationId), null, 'evidence cannot predate its persisted actor');
});

test('correction and source-event reads reject grant gaps and future evidence time', async () => {
  for (const [suffix, kind, terminalStatus] of [
    ['revoked-event-gap', 'event', 'revoked'],
    ['expired-correction-gap', 'correction', 'expired'],
  ]) {
    const workspaceId = `m3a-${suffix}`;
    workspace(workspaceId);
    const result = await runHermesWorkflow(task(workspaceId));
    const admin = principal(workspaceId);
    const row = kind === 'event'
      ? appendOutcomeSourceEvent(admin, result.evaluationId, { idempotencyKey: `${suffix}-event`, eventType: 'accepted', evidence: 'verified evidence' })
      : appendOutcomeCorrection(admin, result.evaluationId, { reason: 'verified correction', sourceEvidence: 'verified evidence' });
    const grant = get('SELECT * FROM auth_workspace_grants WHERE principal_id=? AND workspace_id=?', [admin.principalId, workspaceId]);
    const gapStart = Date.now();
    if (terminalStatus === 'revoked') run("UPDATE auth_workspace_grants SET status='revoked',revoked_at=? WHERE id=?", [gapStart, grant.id]);
    else run("UPDATE auth_workspace_grants SET status='expired',expires_at=? WHERE id=?", [gapStart, grant.id]);
    const evidenceTime = new Date(gapStart + 1).toISOString();
    const successorTime = gapStart + 2;
    run('INSERT INTO auth_workspace_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [`${grant.id}-successor`,admin.principalId,workspaceId,'viewer','["evaluation.correct","evaluation.read"]','active',2,grant.id,successorTime,null,null,'test',1,successorTime]);
    const table = kind === 'event' ? 'hermes_outcome_source_events' : 'hermes_outcome_corrections';
    withoutImmutability([table], () => run(`UPDATE ${table} SET created_at=? WHERE id=?`, [evidenceTime, row.id]));
    assert.equal(readOutcomeEvaluation(admin, result.evaluationId), null, `${kind} cannot claim an authorization gap`);
  }

  workspace('m3a-future-evidence');
  const result = await runHermesWorkflow(task('m3a-future-evidence'));
  const admin = principal('m3a-future-evidence');
  const correction = appendOutcomeCorrection(admin, result.evaluationId, { reason: 'verified correction', sourceEvidence: 'verified evidence' });
  const event = appendOutcomeSourceEvent(admin, result.evaluationId, { idempotencyKey: 'future-event', eventType: 'accepted', evidence: 'verified evidence' });
  withoutImmutability(['hermes_outcome_corrections','hermes_outcome_source_events'], () => {
    const future = '2099-01-01T00:00:00.000Z';
    run('UPDATE hermes_outcome_corrections SET created_at=? WHERE id=?', [future, correction.id]);
    run('UPDATE hermes_outcome_source_events SET created_at=? WHERE id=?', [future, event.id]);
  });
  assert.equal(readOutcomeEvaluation(admin, result.evaluationId), null, 'future subordinate evidence fails closed');
});
