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
import { providerRegistry } from './registries.js';

export function insertWorkflowRun(runRow) {
  const requestedProvider = runRow.requestedProvider || null;
  if (requestedProvider !== null && !providerRegistry.get(requestedProvider)) {
    throw new Error('workflow run requestedProvider must be a registered provider id or null');
  }
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
    requested_provider: requestedProvider,
  };
  run(
    `INSERT INTO hermes_workflow_runs(id,task_id,conversation_id,workspace_id,actor_id,channel,objective,classification,status,outcome,provider,agent,cost_cents,started_at,finished_at,created_at,requested_provider)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [record.id, record.task_id, record.conversation_id, record.workspace_id, record.actor_id, record.channel, record.objective, record.classification, record.status, record.outcome, record.provider, record.agent, record.cost_cents, record.started_at, record.finished_at, record.created_at, record.requested_provider],
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

// --- Milestone 2: provider invocations, health, approvals ---
export function insertProviderInvocation(runId, taskId, inv) {
  const rowId = id('hinv');
  run(
    `INSERT INTO hermes_provider_invocations(id,run_id,task_id,provider,adapter_type,model,mode,status,attempt,input_bytes,output_bytes,input_tokens,output_tokens,cost_cents,duration_ms,timed_out,cancelled,error,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [rowId, runId, taskId || null, inv.provider || null, inv.adapterType || null, inv.model || null, inv.mode || null, inv.status || null, Number.isFinite(inv.attempt) ? inv.attempt : 1,
      numOrNull(inv.inputBytes), numOrNull(inv.outputBytes), numOrNull(inv.inputTokens), numOrNull(inv.outputTokens), numOrNull(inv.costCents), numOrNull(inv.durationMs),
      inv.timedOut ? 1 : 0, inv.cancelled ? 1 : 0, inv.error ? redactString(inv.error) : null, now()],
  );
  return rowId;
}

export function upsertProviderHealth(provider, h) {
  run(
    `INSERT INTO hermes_provider_health(provider,status,last_success_at,last_failure_at,failure_count,cooldown_until,disabled,updated_at)
     VALUES(?,?,?,?,?,?,?,?)
     ON CONFLICT(provider) DO UPDATE SET status=excluded.status,last_success_at=excluded.last_success_at,last_failure_at=excluded.last_failure_at,failure_count=excluded.failure_count,cooldown_until=excluded.cooldown_until,disabled=excluded.disabled,updated_at=excluded.updated_at`,
    [provider, h.status || 'unknown', h.lastSuccessAt || null, h.lastFailureAt || null, Number.isFinite(h.failureCount) ? h.failureCount : 0, h.cooldownUntil || null, h.disabled ? 1 : 0, now()],
  );
}
export const getProviderHealth = (provider) => get(`SELECT * FROM hermes_provider_health WHERE provider=?`, [provider]);
export const listProviderHealth = () => all(`SELECT * FROM hermes_provider_health`);

export function insertApproval(a) {
  const rowId = a.id || id('happr');
  run(
    `INSERT INTO hermes_approvals(id,run_id,task_id,scope,action_class,status,granted_by,reason,single_use,consumed_at,expires_at,created_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    [rowId, a.runId || null, a.taskId || null, a.scope || 'task', a.actionClass || null, a.status || 'granted', a.grantedBy || null, redactString(a.reason || ''), a.singleUse === false ? 0 : 1, null, a.expiresAt || null, now()],
  );
  return rowId;
}
export const getApproval = (approvalId) => get(`SELECT * FROM hermes_approvals WHERE id=?`, [approvalId]);
export const latestApprovalForTask = (taskId, actionClass) => get(`SELECT * FROM hermes_approvals WHERE task_id=? AND action_class=? ORDER BY created_at DESC LIMIT 1`, [taskId, actionClass]);
export function consumeApprovalIfGranted(approvalId, at = now()) {
  const result = run(`UPDATE hermes_approvals SET status='consumed', consumed_at=? WHERE id=? AND status='granted' AND (expires_at IS NULL OR expires_at > ?)`, [at, approvalId, at]);
  return result.changes === 1;
}
export const getProviderInvocations = (runId) => all(`SELECT * FROM hermes_provider_invocations WHERE run_id=? ORDER BY attempt,created_at,id`, [runId]);
export const recentProviderInvocations = (limit = 20) => all(`SELECT * FROM hermes_provider_invocations ORDER BY created_at DESC LIMIT ?`, [limit]);

const numOrNull = (v) => (Number.isFinite(Number(v)) && v !== null && v !== undefined ? Number(v) : null);

// --- Reads (tests + future retrieval service) ---
export const getWorkflowRun = (runId) => get(`SELECT * FROM hermes_workflow_runs WHERE id=?`, [runId]);
export const getWorkflowSteps = (runId) => all(`SELECT * FROM hermes_workflow_steps WHERE run_id=? ORDER BY seq`, [runId]);
// Source records participate in the Phase 3A provenance digest.  Their selection order must be
// explicit so SQLite planner/order changes cannot alter an evaluation or its verification.
export const getRoutingDecisions = (runId) => all(`SELECT * FROM hermes_routing_decisions WHERE run_id=? ORDER BY created_at,id`, [runId]);
export const getPolicyDecisions = (runId) => all(`SELECT * FROM hermes_policy_decisions WHERE run_id=? ORDER BY created_at,id`, [runId]);
export const getVerificationResults = (runId) => all(`SELECT * FROM hermes_verification_results WHERE run_id=? ORDER BY created_at,id`, [runId]);
export const getMemoryCandidates = (runId) => all(`SELECT * FROM hermes_memory_candidates WHERE run_id=?`, [runId]);
export const getPendingMemoryCandidates = () => all(`SELECT * FROM hermes_memory_candidates WHERE status='pending' ORDER BY created_at`);

// Milestone 3A outcome records are append-only. No update/delete helper is deliberately exposed.
export function insertOutcomeEvaluation(row, components) {
  run(`INSERT INTO hermes_outcome_evaluations(id,evaluation_version,user_id,project_id,workspace_id,task_id,run_id,routing_decision_id,policy_decision_id,verification_result_id,provider_invocation_id,execution_mode,provider_id,classification,terminal_status,terminal_outcome,verification_status,verifier_confidence,acceptance_status,retry_count,duration_ms,input_tokens,output_tokens,cost_cents,timed_out,cancelled,rollback_evidence,stability_evidence,failure_category,learning_eligibility,source_event_start_seq,source_event_end_seq,evaluator_version,provenance_digest,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  [row.id,row.evaluationVersion,row.userId,row.projectId,row.workspaceId,row.taskId,row.runId,row.routingDecisionId,row.policyDecisionId,row.verificationResultId,row.providerInvocationId,row.executionMode,row.providerId,row.classification,row.terminalStatus,row.terminalOutcome,row.verificationStatus,row.verifierConfidence,row.acceptanceStatus,row.retryCount,row.durationMs,row.inputTokens,row.outputTokens,row.costCents,row.timedOut ? 1 : 0,row.cancelled ? 1 : 0,row.rollbackEvidence,row.stabilityEvidence,row.failureCategory,row.learningEligibility,row.sourceEventStartSeq,row.sourceEventEndSeq,row.evaluatorVersion,row.provenanceDigest,row.createdAt]);
  for (const c of components) run(`INSERT INTO hermes_outcome_evaluation_components(id,evaluation_id,name,value,status,detail,created_at) VALUES(?,?,?,?,?,?,?)`, [c.id,row.id,c.name,c.value,c.status,redactString(c.detail || ''),row.createdAt]);
}
export const getOutcomeEvaluationForRun = (runId, evaluationVersion) => get(`SELECT * FROM hermes_outcome_evaluations WHERE run_id=? AND evaluation_version=?`, [runId,evaluationVersion]);
export const getOutcomeEvaluation = (id) => get(`SELECT * FROM hermes_outcome_evaluations WHERE id=?`, [id]);
export const getOutcomeComponents = (evaluationId) => all(`SELECT * FROM hermes_outcome_evaluation_components WHERE evaluation_id=? ORDER BY name`, [evaluationId]);
export const recentOutcomeEvaluations = (limit = 20) => all(`SELECT * FROM hermes_outcome_evaluations ORDER BY created_at DESC LIMIT ?`, [limit]);

// Phase 3A additions remain append-only.  There are deliberately no update/delete paths.
export function insertOutcomeCorrection(row) {
  run(`INSERT INTO hermes_outcome_corrections(id,evaluation_id,workspace_id,run_id,version,supersedes_correction_id,reason,source_evidence,actor_principal_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    [row.id,row.evaluationId,row.workspaceId,row.runId,row.version,row.supersedesCorrectionId || null,redactString(row.reason),redactString(row.sourceEvidence),row.actorPrincipalId,row.createdAt]);
}
export const getOutcomeCorrections = (evaluationId) => all(`SELECT * FROM hermes_outcome_corrections WHERE evaluation_id=? ORDER BY version`, [evaluationId]);
export function insertOutcomeSourceEvent(row) {
  run(`INSERT INTO hermes_outcome_source_events(id,evaluation_id,workspace_id,run_id,event_type,evidence,actor_principal_id,idempotency_key,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
    [row.id,row.evaluationId,row.workspaceId,row.runId,row.eventType,redactString(row.evidence),row.actorPrincipalId,row.idempotencyKey,row.createdAt]);
}
export const getOutcomeSourceEvents = (evaluationId) => all(`SELECT * FROM hermes_outcome_source_events WHERE evaluation_id=? ORDER BY created_at,id`, [evaluationId]);
export function insertOutcomeEvaluationFailure(row) {
  run(`INSERT INTO hermes_outcome_evaluation_failures(id,run_id,workspace_id,category,remediation_state,detail,created_at) VALUES(?,?,?,?,?,?,?)`,
    [row.id,row.runId,row.workspaceId || null,row.category,row.remediationState || 'open',redactString(row.detail || ''),row.createdAt]);
}
export const getOutcomeEvaluationFailure = (runId) => get(`SELECT * FROM hermes_outcome_evaluation_failures WHERE run_id=?`, [runId]);
// Milestone 3B joins the agent dimension through the evaluation's own routing decision id, so the
// dimension comes from the same immutable evidence the provenance digest already covers.
// Scoped by run as well as id: the dimension must come from the same run whose evidence was just
// revalidated, never from an unscoped primary-key lookup that could reach another run's decision.
export const getRoutingDecision = (routingDecisionId, runId) => get(`SELECT * FROM hermes_routing_decisions WHERE id=? AND run_id=?`, [routingDecisionId, runId]);

// --- Milestone 3B: verified scorecards ---
// Snapshots and their lineage are append-only and database-enforced immutable. There are
// deliberately no update or delete helpers: recalculation appends a successor instead.
const SCORECARD_COLUMNS = ['id','scorecard_version','derivation_version','workspace_id','dimension_provider_id','dimension_agent_id','dimension_capability','dimension_classification','cutoff_created_at','cutoff_evaluation_id','scope_version','supersedes_scorecard_id','source_evaluation_count','confidence_band','positive_eligible_count','negative_terminal_count','blocked_ineligible_count','accepted_count','rejected_count','partially_accepted_count','rollback_count','follow_up_verification_count','stability_confirmed_count','regression_linked_count','unknown_acceptance_count','unknown_rollback_count','unknown_stability_count','retry_total','known_retry_evaluations','timeout_count','unknown_timeout_count','cancellation_count','known_input_tokens','known_input_token_evaluations','known_output_tokens','known_output_token_evaluations','known_cost_cents','known_cost_evaluations','verified_success_numerator','verified_success_denominator','acceptance_numerator','acceptance_denominator','lineage_digest','content_digest','created_at'];
const SCORECARD_SOURCE_COLUMNS = ['id','scorecard_id','seq','evaluation_id','workspace_id','evaluation_created_at','provenance_digest','correction_head_id','correction_head_version','source_event_ids','created_at'];
// The scope key selects one dimension series. It is the identity key minus the cutoff, so a later
// cutoff over the same scope produces a successor rather than a conflicting row.
const SCOPE_COLUMNS = ['workspace_id','scorecard_version','dimension_provider_id','dimension_agent_id','dimension_capability','dimension_classification'];
const placeholders = (columns) => columns.map(() => '?').join(',');
const scopeFilter = SCOPE_COLUMNS.map((column) => `${column}=?`).join(' AND ');
const scopeValues = (scope) => SCOPE_COLUMNS.map((column) => scope[column]);

// The caller owns the surrounding transaction so the snapshot and its complete ordered lineage
// either both exist or neither does.
export function insertVerifiedScorecard(row, sources) {
  run(`INSERT INTO hermes_verified_scorecards(${SCORECARD_COLUMNS.join(',')}) VALUES(${placeholders(SCORECARD_COLUMNS)})`, SCORECARD_COLUMNS.map((column) => row[column]));
  for (const source of sources) run(`INSERT INTO hermes_verified_scorecard_sources(${SCORECARD_SOURCE_COLUMNS.join(',')}) VALUES(${placeholders(SCORECARD_SOURCE_COLUMNS)})`, SCORECARD_SOURCE_COLUMNS.map((column) => source[column]));
}
export const getVerifiedScorecard = (scorecardId) => get(`SELECT * FROM hermes_verified_scorecards WHERE id=?`, [scorecardId]);
// Lineage order is the persisted seq, never the insertion or planner order, so a replayed digest is
// reproduced from storage exactly as it was derived.
export const getVerifiedScorecardSources = (scorecardId) => all(`SELECT * FROM hermes_verified_scorecard_sources WHERE scorecard_id=? ORDER BY seq`, [scorecardId]);
export const getVerifiedScorecardByIdentity = (scope, cutoffCreatedAt, cutoffEvaluationId) =>
  get(`SELECT * FROM hermes_verified_scorecards WHERE ${scopeFilter} AND cutoff_created_at=? AND cutoff_evaluation_id=?`, [...scopeValues(scope), cutoffCreatedAt, cutoffEvaluationId]);
export const getVerifiedScorecardScopeHead = (scope) =>
  get(`SELECT * FROM hermes_verified_scorecards WHERE ${scopeFilter} ORDER BY scope_version DESC LIMIT 1`, scopeValues(scope));

// Milestone 3C memory-candidate reviews are append-only. No update or delete helper is deliberately
// exposed, and there is deliberately no writer of any kind for `hermes_memory_candidates`: a review
// is a new row here, never a mutation of the candidate it reviews.
const MEMORY_REVIEW_COLUMNS = ['id','review_version','decision_version','candidate_id','workspace_id','run_id','task_id','decision','rationale','candidate_kind','candidate_scope','candidate_status_at_review','candidate_digest','evaluation_id','evaluation_version','provenance_digest','reviewer_principal_id','idempotency_key','content_digest','lineage_digest','created_at'];
export function insertMemoryCandidateReview(row) {
  run(`INSERT INTO hermes_memory_candidate_reviews(${MEMORY_REVIEW_COLUMNS.join(',')}) VALUES(${placeholders(MEMORY_REVIEW_COLUMNS)})`, MEMORY_REVIEW_COLUMNS.map((column) => row[column]));
}
export const getMemoryCandidate = (candidateId) => get(`SELECT * FROM hermes_memory_candidates WHERE id=?`, [candidateId]);
export const getMemoryCandidateReview = (reviewId) => get(`SELECT * FROM hermes_memory_candidate_reviews WHERE id=?`, [reviewId]);
export const getMemoryCandidateReviewForCandidate = (candidateId) => get(`SELECT * FROM hermes_memory_candidate_reviews WHERE candidate_id=?`, [candidateId]);
export const getMemoryCandidateReviewByIdempotencyKey = (workspaceId, idempotencyKey) =>
  get(`SELECT * FROM hermes_memory_candidate_reviews WHERE workspace_id=? AND idempotency_key=?`, [workspaceId, idempotencyKey]);
// Workspace-scoped, unlike the unscoped `getPendingMemoryCandidates` above, which returns every
// workspace's pending candidates and must never back an authorized surface. The `,id` tiebreak makes
// the order total: `created_at` is millisecond-resolution and ties are routine.
export const getPendingMemoryCandidatesForWorkspace = (workspaceId) =>
  all(`SELECT * FROM hermes_memory_candidates WHERE workspace_id=? AND status='pending' ORDER BY created_at,id`, [workspaceId]);

// Bounded keyset page for the review queue. Workspace scope is mandatory and independent of the
// cursor; the cursor can change navigation only inside the already-authorized workspace. `limit`
// is validated by the service and includes its one-row lookahead.
export function getMemoryCandidateReviewQueuePage(workspaceId, { afterCreatedAt = null, afterId = null, reviewState = 'all', limit }) {
  const cursor = afterCreatedAt === null ? '' : ' AND (c.created_at>? OR (c.created_at=? AND c.id>?))';
  const state = reviewState === 'reviewed'
    ? ' AND EXISTS (SELECT 1 FROM hermes_memory_candidate_reviews r WHERE r.candidate_id=c.id)'
    : reviewState === 'unreviewed'
      ? ' AND NOT EXISTS (SELECT 1 FROM hermes_memory_candidate_reviews r WHERE r.candidate_id=c.id)'
      : '';
  const params = [workspaceId];
  if (afterCreatedAt !== null) params.push(afterCreatedAt, afterCreatedAt, afterId);
  params.push(limit);
  return all(`SELECT c.* FROM hermes_memory_candidates c WHERE c.workspace_id=? AND c.status='pending'${cursor}${state} ORDER BY c.created_at,c.id LIMIT ?`, params);
}

// Milestone 3C re-review successors. Append-only in exactly the same sense: insert and read only, no
// update or delete helper, and still no writer of any kind for `hermes_memory_candidates`. A
// re-review links to the record it supersedes and never touches it.
const MEMORY_REREVIEW_COLUMNS = ['id','rereview_version','decision_version','root_review_id','supersedes_rereview_id','chain_version','candidate_id','workspace_id','run_id','task_id','decision','rationale','candidate_kind','candidate_scope','candidate_status_at_review','candidate_digest','evaluation_id','evaluation_version','provenance_digest','predecessor_content_digest','predecessor_lineage_digest','inherited_context','reviewer_principal_id','idempotency_key','content_digest','lineage_digest','created_at'];
export function insertMemoryCandidateRereview(row) {
  run(`INSERT INTO hermes_memory_candidate_rereviews(${MEMORY_REREVIEW_COLUMNS.join(',')}) VALUES(${placeholders(MEMORY_REREVIEW_COLUMNS)})`, MEMORY_REREVIEW_COLUMNS.map((column) => row[column]));
}
export const getMemoryCandidateRereview = (rereviewId) => get(`SELECT * FROM hermes_memory_candidate_rereviews WHERE id=?`, [rereviewId]);
// The whole chain for a root, in canonical order. `chain_version` is unique per root, so ordering by
// it is total and replay-stable - unlike `created_at`, which is millisecond-resolution and ties.
export const getMemoryCandidateRereviewChain = (rootReviewId) =>
  all(`SELECT * FROM hermes_memory_candidate_rereviews WHERE root_review_id=? ORDER BY chain_version`, [rootReviewId]);
export const getMemoryCandidateRereviewHead = (rootReviewId) =>
  get(`SELECT * FROM hermes_memory_candidate_rereviews WHERE root_review_id=? ORDER BY chain_version DESC LIMIT 1`, [rootReviewId]);
export const getMemoryCandidateRereviewByIdempotencyKey = (workspaceId, idempotencyKey) =>
  get(`SELECT * FROM hermes_memory_candidate_rereviews WHERE workspace_id=? AND idempotency_key=?`, [workspaceId, idempotencyKey]);
