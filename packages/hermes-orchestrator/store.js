// Hermes persistence layer (Milestone 1).
//
// Thin, parameterized data-access for the additive hermes_* tables. All JSON columns are written
// through the redaction layer so no secret can ever reach the database. Reads are provided for the
// tests and future retrieval service. This module owns ONLY the new tables; conversations,
// messages, tasks, and ordered events remain owned by task-engine / unified-input and are reused,
// not duplicated.
import { run, all, get } from '../task-engine/db.js';
import { id, now } from '../shared/util.js';
import { redactedJson, redactString } from './redaction.js';

export function insertWorkflowRun(runRow) {
  const record = {
    id: runRow.id || id('hrun'),
    task_id: runRow.taskId || null,
    conversation_id: runRow.conversationId || null,
    workspace_id: runRow.workspaceId || null,
    actor_id: runRow.actorId || null,
    channel: runRow.channel || null,
    objective: redactString(runRow.objective || ''),
    classification: redactedJson(runRow.classification || null),
    status: runRow.status || 'running',
    outcome: runRow.outcome || null,
    provider: runRow.provider || null,
    agent: runRow.agent || null,
    cost_cents: Number.isFinite(runRow.costCents) ? runRow.costCents : 0,
    started_at: runRow.startedAt || now(),
    finished_at: runRow.finishedAt || null,
    created_at: now(),
  };
  run(
    `INSERT INTO hermes_workflow_runs(id,task_id,conversation_id,workspace_id,actor_id,channel,objective,classification,status,outcome,provider,agent,cost_cents,started_at,finished_at,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [record.id, record.task_id, record.conversation_id, record.workspace_id, record.actor_id, record.channel, record.objective, record.classification, record.status, record.outcome, record.provider, record.agent, record.cost_cents, record.started_at, record.finished_at, record.created_at],
  );
  return record.id;
}

export function finishWorkflowRun(runId, { status, outcome, provider, agent, costCents }) {
  run(
    `UPDATE hermes_workflow_runs SET status=?,outcome=?,provider=COALESCE(?,provider),agent=COALESCE(?,agent),cost_cents=COALESCE(?,cost_cents),finished_at=? WHERE id=?`,
    [status, outcome || null, provider || null, agent || null, Number.isFinite(costCents) ? costCents : null, now(), runId],
  );
}

export function insertWorkflowStep(runId, seq, step) {
  const stepId = id('hstep');
  run(
    `INSERT INTO hermes_workflow_steps(id,run_id,seq,name,status,detail,started_at,finished_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
    [stepId, runId, seq, step.name, step.status || 'completed', redactedJson(step.detail ?? null), step.startedAt || now(), step.finishedAt || now(), now()],
  );
  return stepId;
}

export function insertRoutingDecision(runId, taskId, decision) {
  const rowId = id('hroute');
  run(
    `INSERT INTO hermes_routing_decisions(id,run_id,task_id,classification,candidates,selected_provider,selected_agent,capabilities,rationale,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    [rowId, runId, taskId || null, redactedJson(decision.classification || null), redactedJson(decision.candidates || []), decision.provider || null, decision.agent || null, redactedJson(decision.capabilities || []), redactString(decision.rationale || ''), now()],
  );
  return rowId;
}

export function insertPolicyDecision(runId, taskId, policy) {
  const rowId = id('hpol');
  run(
    `INSERT INTO hermes_policy_decisions(id,run_id,task_id,action_class,decision,requires_approval,reason,created_at) VALUES(?,?,?,?,?,?,?,?)`,
    [rowId, runId, taskId || null, policy.actionClass || 'unknown', policy.decision || 'denied', policy.requiresApproval ? 1 : 0, redactString(policy.reason || ''), now()],
  );
  return rowId;
}

export function insertVerificationResult(runId, taskId, result) {
  const rowId = id('hver');
  run(
    `INSERT INTO hermes_verification_results(id,run_id,task_id,verifier,passed,checks,detail,created_at) VALUES(?,?,?,?,?,?,?,?)`,
    [rowId, runId, taskId || null, result.verifier || 'deterministic-mock-verifier', result.passed ? 1 : 0, redactedJson(result.checks || []), redactString(result.detail || ''), now()],
  );
  return rowId;
}

// Memory candidates are ALWAYS inserted with status 'pending'. Promotion is a separate, explicit,
// policy/human-gated action that does not exist yet in Milestone 1 (see docs). This function
// deliberately has no promotion path.
export function insertMemoryCandidate(runId, taskId, candidate) {
  const rowId = id('hmem');
  run(
    `INSERT INTO hermes_memory_candidates(id,run_id,task_id,workspace_id,kind,scope,lesson,evidence_ref,status,promoted_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    [rowId, runId, taskId || null, candidate.workspaceId || null, candidate.kind || 'workflow_lesson', candidate.scope || 'workspace', redactString(candidate.lesson || ''), candidate.evidenceRef || null, 'pending', null, now()],
  );
  return rowId;
}

// --- Reads (tests + future retrieval service) ---
export const getWorkflowRun = (runId) => get(`SELECT * FROM hermes_workflow_runs WHERE id=?`, [runId]);
export const getWorkflowSteps = (runId) => all(`SELECT * FROM hermes_workflow_steps WHERE run_id=? ORDER BY seq`, [runId]);
export const getRoutingDecisions = (runId) => all(`SELECT * FROM hermes_routing_decisions WHERE run_id=?`, [runId]);
export const getPolicyDecisions = (runId) => all(`SELECT * FROM hermes_policy_decisions WHERE run_id=?`, [runId]);
export const getVerificationResults = (runId) => all(`SELECT * FROM hermes_verification_results WHERE run_id=?`, [runId]);
export const getMemoryCandidates = (runId) => all(`SELECT * FROM hermes_memory_candidates WHERE run_id=?`, [runId]);
export const getPendingMemoryCandidates = () => all(`SELECT * FROM hermes_memory_candidates WHERE status='pending' ORDER BY created_at`);
