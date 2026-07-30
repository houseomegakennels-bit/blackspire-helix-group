// Hermes Milestone 3A: verified outcome scoring and immutable provenance.
// This service is internal-only. It produces factual, append-only evaluations after a terminal
// run; it never changes routing, policy, memory, provider state, or task state.
import crypto from 'node:crypto';
import { id, now } from '../shared/util.js';
import { transaction, get, all } from '../task-engine/db.js';
import { getTask } from '../task-engine/tasks.js';
import { normalizeTask } from './normalize.js';
import { redactDeep, redactString } from './redaction.js';
import { getWorkflowRun, getWorkflowSteps, getRoutingDecisions, getPolicyDecisions, getVerificationResults, getProviderInvocations, getOutcomeEvaluationForRun, insertOutcomeEvaluation, getOutcomeEvaluation, getOutcomeComponents, getOutcomeCorrections, getOutcomeSourceEvents, insertOutcomeCorrection, insertOutcomeSourceEvent, insertOutcomeEvaluationFailure } from './store.js';
import { canReadEvaluation, canCorrectEvaluation, hasCurrentWorkspacePermission, activeGrant, resolvePrincipal } from '../shared/authorization.js';
import { canonicalPermissions } from '../shared/authz-schema.js';
import { providerRegistry } from './registries.js';

export const OUTCOME_EVALUATION_VERSION = 'm3a-v1';
export const OUTCOME_EVALUATOR_VERSION = 'hermes-outcome-evaluator-v1';
const TERMINAL = new Set(['completed', 'failed', 'blocked', 'cancelled']);
const STEP_NAMES = new Set(['hermes.received','hermes.normalized','hermes.classified','hermes.policy_evaluated','hermes.routed','hermes.executed','hermes.verified','hermes.memory_candidate_recorded','hermes.completed','hermes.failed']);
const CHECK_NAMES = new Set(['execution_ok','provider_present','artifacts_is_array','has_summary','mock_is_free','artifact_paths_safe','artifact_present_for_edit']);

export function evaluateTerminalOutcome(runId, { evaluationVersion = OUTCOME_EVALUATION_VERSION } = {}) {
  if (typeof runId !== 'string' || !runId) throw new Error('outcome evaluation requires a run id');
  if (evaluationVersion !== OUTCOME_EVALUATION_VERSION) throw new Error('outcome evaluation requires the canonical evaluation version');
  return transaction(() => {
    if (getOutcomeEvaluationForRun(runId, evaluationVersion)) throw new Error('outcome evaluation already exists for this run and version');
    const evidence = loadEvidence(runId);
    validateEvidence(evidence);
    const { run, steps, routings, policies, verifications, invocations } = evidence;
    const verification = latest(verifications);
    const routing = latest(routings);
    const policy = latest(policies);
    const invocation = invocations.length ? invocations[invocations.length - 1] : null;
    const verified = verification?.passed === 1 || verification?.passed === true;
    const terminalCompleted = run.status === 'completed' && run.outcome === 'verified';
    const positive = terminalCompleted && verified;
    const mode = canonicalExecutionMode(evidence);
    const duration = durationMs(run.started_at, run.finished_at);
    if (duration === null) throw new Error('outcome evaluation refuses malformed or negative duration');
    const retryCount = invocation ? Math.max(0, Number(invocation.attempt || 1) - 1) : null;
    const usage = aggregateUsage(invocations);
    const payload = {
      evaluationVersion, userId: run.actor_id || null,
      // Projects do not yet have a canonical ID. In Phase 3A the workspace is the project boundary.
      projectId: run.workspace_id, workspaceId: run.workspace_id, taskId: run.task_id || null, runId,
      routingDecisionId: routing?.id || null, policyDecisionId: policy?.id || null, verificationResultId: verification?.id || null,
      providerInvocationId: invocation?.id || null, executionMode: mode, providerId: invocation?.provider || run.provider || null,
      classification: safeJson(canonicalClassification(evidence)), terminalStatus: run.status, terminalOutcome: run.outcome || null,
      verificationStatus: verification ? (verified ? 'passed' : 'failed') : 'unavailable',
      verifierConfidence: verification ? (verified ? 'deterministic_pass' : 'deterministic_fail') : 'unknown',
      acceptanceStatus: 'unavailable', retryCount, durationMs: duration,
      inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, costCents: usage.costCents,
      timedOut: Boolean(invocation?.timed_out), cancelled: Boolean(invocation?.cancelled) || run.status === 'cancelled',
      rollbackEvidence: null, stabilityEvidence: null,
      failureCategory: positive ? null : failureCategory(run, verification, invocation),
      learningEligibility: positive ? 'positive_eligible' : run.status === 'blocked' ? 'ineligible_blocked' : 'negative_factual',
      sourceEventStartSeq: steps[0].seq, sourceEventEndSeq: steps.at(-1).seq,
      evaluatorVersion: OUTCOME_EVALUATOR_VERSION, createdAt: now(),
    };
    payload.id = id('heval');
    if (!canonicalTimestamp(payload.createdAt) || Date.parse(payload.createdAt) < Date.parse(run.finished_at)) throw new Error('outcome evaluation refuses invalid evaluation timestamp');
    const components = componentRows({ positive, verified, retryCount, duration, invocation, usage, run })
      .map((component) => ({ ...component, id: id('hecomp'), evaluationId: payload.id, createdAt: payload.createdAt }))
      .sort((left, right) => left.name.localeCompare(right.name));
    const packet = provenancePacket(evidence, payload, components);
    assertSanitized(packet);
    payload.provenanceDigest = digest(packet);
    insertOutcomeEvaluation(payload, components);
    return { evaluation: payload, components };
  });
}

// Authorization-facing reads return only bounded factual summaries.  The DB-derived workspace
// decides scope; caller input never chooses the authority or filters an unscoped list.
export function readOutcomeEvaluation(principal, evaluationId) {
  return transaction(() => {
    const evaluation = getOutcomeEvaluation(evaluationId);
    if (!readableEvaluation(evaluation)) return null;
    const decision = canReadEvaluation(principal, evaluation.workspace_id);
    if (!decision.allowed) return null;
    const corrections = getOutcomeCorrections(evaluation.id);
    const sourceEvents = getOutcomeSourceEvents(evaluation.id);
    return { id: evaluation.id, workspaceId: evaluation.workspace_id, runId: evaluation.run_id,
      evaluationVersion: evaluation.evaluation_version, terminalStatus: evaluation.terminal_status,
      terminalOutcome: evaluation.terminal_outcome, verificationStatus: evaluation.verification_status,
      acceptanceStatus: evaluation.acceptance_status, failureCategory: evaluation.failure_category,
      learningEligibility: evaluation.learning_eligibility, createdAt: evaluation.created_at,
      corrections: corrections.map(safeCorrection), sourceEvents: sourceEvents.map(safeEvent) };
  });
}

export function appendOutcomeCorrection(principal, evaluationId, { reason, sourceEvidence, supersedesCorrectionId = null } = {}) {
  const scopedEvaluation = getOutcomeEvaluation(evaluationId);
  if (!readableEvaluation(scopedEvaluation)) throw new Error('outcome correction requires an intact evaluation');
  if (!canCorrectEvaluation(principal, scopedEvaluation.workspace_id).allowed) throw new Error('outcome correction is not authorized');
  return transaction(() => {
    const evaluation = getOutcomeEvaluation(evaluationId);
    if (!readableEvaluation(evaluation)) throw new Error('outcome correction requires an intact evaluation');
    if (!safeRequired(reason) || !safeRequired(sourceEvidence)) throw new Error('outcome correction requires reason and source evidence');
    const prior = getOutcomeCorrections(evaluationId);
    const head = prior.at(-1) || null;
    if (head && supersedesCorrectionId !== head.id) throw new Error('outcome correction must supersede the sole current correction head');
    if (!head && supersedesCorrectionId) throw new Error('outcome correction cannot supersede an absent correction');
    const createdAt = now();
    if (Date.parse(createdAt) < Date.parse(evaluation.created_at)) throw new Error('outcome correction requires a valid timestamp');
    const row = { id: id('hecorr'), evaluationId, workspaceId: evaluation.workspace_id, runId: evaluation.run_id,
      version: prior.length + 1, supersedesCorrectionId: head?.id || null, reason, sourceEvidence,
      actorPrincipalId: principal.principalId, createdAt };
    if (!hasCurrentWorkspacePermission(principal, evaluation.workspace_id, 'evaluation.correct')) throw new Error('outcome correction is not authorized');
    insertOutcomeCorrection(row); return safeCorrection(row);
  });
}

const EVENT_TYPES = new Set(['accepted','rejected','partially_accepted','rollback','follow_up_verification','stability_confirmed','regression_linked']);
export function appendOutcomeSourceEvent(principal, evaluationId, { idempotencyKey, eventType, evidence } = {}) {
  const scopedEvaluation = getOutcomeEvaluation(evaluationId);
  if (!readableEvaluation(scopedEvaluation)) throw new Error('outcome source event requires an intact evaluation');
  if (!canCorrectEvaluation(principal, scopedEvaluation.workspace_id).allowed) throw new Error('outcome source event is not authorized');
  return transaction(() => {
    const evaluation = getOutcomeEvaluation(evaluationId);
    if (!readableEvaluation(evaluation)) throw new Error('outcome source event requires an intact evaluation');
    if (!EVENT_TYPES.has(eventType) || !safeRequired(evidence) || !safeEvidenceId(idempotencyKey)) throw new Error('outcome source event requires an allowed type, evidence, and idempotency key');
    if (getOutcomeSourceEvents(evaluationId).some((event) => event.idempotency_key === idempotencyKey)) throw new Error('outcome source event already recorded');
    const createdAt = now();
    if (Date.parse(createdAt) < Date.parse(evaluation.created_at)) throw new Error('outcome source event requires a valid timestamp');
    const row = { id: id('heevt'), evaluationId, workspaceId: evaluation.workspace_id, runId: evaluation.run_id, eventType, evidence, actorPrincipalId: principal.principalId, idempotencyKey, createdAt };
    if (!hasCurrentWorkspacePermission(principal, evaluation.workspace_id, 'evaluation.correct')) throw new Error('outcome source event is not authorized');
    insertOutcomeSourceEvent(row);
    return safeEvent(row);
  });
}

export function recordOutcomeEvaluationFailure(runId, error) {
  const run = getWorkflowRun(runId); if (!run) return null;
  const category = error instanceof Error && /terminal|evidence|provenance|duration|usage|retry/i.test(error.message) ? 'invalid_evidence' : 'evaluation_failed';
  try { insertOutcomeEvaluationFailure({ id: id('hefail'), runId, workspaceId: run.workspace_id, category, remediationState: 'open', detail: category, createdAt: now() }); } catch { return null; }
  return category;
}
function safeRequired(value) { return typeof value === 'string' && /[^\p{White_Space}\p{Cf}]/u.test(value) && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value); }
function safeId(value) { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value); }
function safeEvidenceId(value) { return safeId(value) && value === redactString(value); }
function safeActor(value) { return typeof value === 'string' && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value) && value === redactString(value); }
// Corrections are immutable evidence, but their free-text reason/evidence can contain sensitive
// operational context.  Read APIs expose only the chain metadata; the original record stays in
// the append-only evidence store for separately authorized operator handling.
function safeCorrection(row) { return { id: row.id, version: row.version, supersedesCorrectionId: row.supersedes_correction_id ?? row.supersedesCorrectionId ?? null, createdAt: row.created_at ?? row.createdAt }; }
function safeEvent(row) { return { id: row.id, eventType: row.event_type ?? row.eventType, createdAt: row.created_at ?? row.createdAt }; }

function componentRows({ positive, verified, retryCount, duration, invocation, usage, run }) {
  const known = (name, value, detail) => ({ name, value: String(value), status: 'known', detail });
  const unknown = (name) => ({ name, value: null, status: 'unknown', detail: 'not available from immutable Phase 3A evidence' });
  return [
    known('execution_completion', run.status === 'completed' ? 'completed' : 'not_completed', 'terminal workflow status'),
    known('verification_outcome', verified ? 'passed' : 'not_passed', 'final deterministic verifier result'),
    known('verifier_confidence', verified ? 'deterministic_pass' : 'deterministic_fail', 'confidence class, not a probability'),
    retryCount === null ? unknown('retry_count') : known('retry_count', retryCount, 'provider invocation attempts minus one'),
    duration === null ? unknown('duration_ms') : known('duration_ms', duration, 'finished_at minus started_at'),
    invocation ? known('timeout', Boolean(invocation.timed_out), 'provider invocation evidence') : unknown('timeout'),
    invocation ? known('cancellation', Boolean(invocation.cancelled) || run.status === 'cancelled', 'provider/run evidence') : known('cancellation', run.status === 'cancelled', 'terminal run evidence'),
    usage.costCents == null ? unknown('cost_cents') : known('cost_cents', usage.costCents, 'sum across provider attempts'),
    unknown('user_acceptance'), unknown('rollback_evidence'), unknown('stability_evidence'),
    known('learning_eligibility', positive ? 'positive_eligible' : 'not_positive', 'does not affect routing in Phase 3A'),
  ];
}
function ordered(steps) {
  return steps.every((step, index) => Number.isInteger(step.seq) && step.seq === index + 1 && step.created_at &&
    (!index || (Date.parse(step.started_at) >= Date.parse(steps[index - 1].created_at) &&
      Date.parse(step.created_at) >= Date.parse(steps[index - 1].created_at))));
}
function terminalEventsPresent(steps, status) { const names = new Set(steps.map((s) => s.name)); return names.has('hermes.received') && (status === 'completed' ? names.has('hermes.completed') : names.has('hermes.failed')); }
function loadEvidence(runId) {
  const run = getWorkflowRun(runId);
  return {
    run,
    task: run?.task_id ? getTask(run.task_id) : null,
    steps: getWorkflowSteps(runId),
    routings: getRoutingDecisions(runId),
    policies: getPolicyDecisions(runId),
    verifications: getVerificationResults(runId),
    invocations: getProviderInvocations(runId),
  };
}
function validateEvidence(evidence) {
  const { run, task, steps, routings, policies, verifications, invocations } = evidence;
  if (!run || !TERMINAL.has(run.status) || !sanitizedJson(run.classification) || !canonicalTimestamp(run.created_at) || !canonicalTimestamp(run.started_at) || !canonicalTimestamp(run.finished_at)) throw new Error('outcome evaluation requires a finished terminal workflow run with canonical timestamps');
  if (Date.parse(run.started_at) > Date.parse(run.finished_at) || Date.parse(run.created_at) > Date.parse(run.finished_at)) throw new Error('outcome evaluation refuses invalid run timestamp order');
  const canonicalTask = task ? taskIdentity(task) : null;
  if (!canonicalTask || canonicalTask.id !== run.task_id || canonicalTask.workspaceId !== run.workspace_id || canonicalTask.conversationId !== run.conversation_id ||
    canonicalTask.actorId !== run.actor_id || canonicalTask.sourceChannel !== run.channel || canonicalTask.request !== run.objective) throw new Error('outcome evaluation refuses mismatched canonical task scope');
  if (!steps.length || !ordered(steps) || !terminalEventsPresent(steps, run.status)) throw new Error('outcome evaluation requires complete ordered terminal workflow evidence');
  const stepNames = new Set();
  for (const step of steps) {
    if (!safeId(step.id) || !STEP_NAMES.has(step.name) || stepNames.has(step.name) ||
      step.status !== (step.name === 'hermes.failed' ? 'failed' : 'completed') || !sanitizedJson(step.detail) ||
      !canonicalTimestamp(step.created_at) || !canonicalTimestamp(step.started_at) || !canonicalTimestamp(step.finished_at) ||
      Date.parse(step.started_at) < Date.parse(run.started_at) || Date.parse(step.started_at) > Date.parse(step.finished_at) ||
      Date.parse(step.finished_at) > Date.parse(step.created_at) || Date.parse(step.created_at) > Date.parse(run.finished_at)) throw new Error('outcome evaluation refuses invalid workflow step evidence or timestamp');
    stepNames.add(step.name);
  }
  if (steps[0].name !== 'hermes.received' || steps[1]?.name !== 'hermes.normalized' || steps.at(-1).name !== (run.status === 'completed' ? 'hermes.completed' : 'hermes.failed')) throw new Error('outcome evaluation refuses invalid workflow step order');
  validateLinks({ run, routings, policies, verifications, invocations });
  validateCrossSourceEvidence({ run, steps, routings, policies, verifications, invocations });
  if (run.status === 'completed' && run.outcome === 'verified') {
    const requiredSteps = ['hermes.classified','hermes.policy_evaluated','hermes.routed','hermes.executed','hermes.verified','hermes.completed'];
    const finalInvocation = invocations.at(-1);
    if (routings.length !== 1 || policies.length !== 1 || verifications.length !== 1 || !invocations.length ||
      requiredSteps.some((name) => !stepNames.has(name)) || policies[0].decision !== 'allow' || policies[0].requires_approval !== 0 ||
      verifications[0].passed !== 1 || finalInvocation.status !== 'completed' || finalInvocation.timed_out !== 0 || finalInvocation.cancelled !== 0) {
      throw new Error('outcome evaluation requires complete verified evidence');
    }
  }
  canonicalClassification(evidence);
  assertSanitized({ run, steps, routings, policies, verifications, invocations });
}
function validateLinks({ run, routings, policies, verifications, invocations }) {
  for (const row of [...routings, ...policies, ...verifications, ...invocations]) {
    if (!row) continue;
    if (!safeId(row.id) || row.run_id !== run.id || row.task_id !== run.task_id || !canonicalTimestamp(row.created_at) ||
      Date.parse(row.created_at) < Date.parse(run.started_at) || Date.parse(row.created_at) > Date.parse(run.finished_at)) throw new Error('outcome evaluation refuses mismatched provenance references or timestamp');
  }
  for (const routing of routings) {
    const classification = parsedJson(routing.classification);
    const candidates = parsedJson(routing.candidates);
    const capabilities = parsedJson(routing.capabilities);
    if (!validClassification(classification) || !sanitizedJson(routing.classification) || !sanitizedJson(routing.candidates) || !sanitizedJson(routing.capabilities) ||
      !Array.isArray(candidates) || !candidates.length || candidates.some((candidate) => !candidate || Array.isArray(candidate) ||
        Object.keys(candidate).sort().join(',') !== 'enabled,provider' || !safeId(candidate.provider) || typeof candidate.enabled !== 'boolean') ||
      new Set(candidates.map((candidate) => candidate.provider)).size !== candidates.length ||
      !Array.isArray(capabilities) || !sameStrings(capabilities, classification.requiredCapabilities) ||
      !capabilities.every(safeId) || !candidates.some((candidate) => candidate.provider === routing.selected_provider && candidate.enabled) ||
      !safeId(routing.selected_provider) || !safeId(routing.selected_agent) || !safeRequired(routing.rationale)) throw new Error('outcome evaluation refuses malformed routing evidence');
  }
  for (const policy of policies) {
    if (!safeId(policy.action_class) || !['allow','deny','requires_approval'].includes(policy.decision) ||
      ![0,1].includes(policy.requires_approval) || policy.requires_approval !== (policy.decision === 'requires_approval' ? 1 : 0) ||
      !safeRequired(policy.reason)) throw new Error('outcome evaluation refuses malformed policy evidence');
  }
  for (const verification of verifications) {
    const checks = parsedJson(verification.checks);
    const classification = canonicalClassification({ routings, steps: [] });
    const provider = latest(routings)?.selected_provider;
    const expectedNames = ['execution_ok','provider_present','artifacts_is_array','has_summary',
      ...(providerRegistry.get(provider)?.adapterType === 'mock' ? ['mock_is_free'] : []),
      'artifact_paths_safe',
      ...(classification?.requiredCapabilities?.some((capability) => capability === 'doc.edit' || capability === 'code.edit') ? ['artifact_present_for_edit'] : [])];
    if (verification.verifier !== 'deterministic-mock-verifier-v1' || ![0,1].includes(verification.passed) || !sanitizedJson(verification.checks) ||
      !Array.isArray(checks) || !checks.length || checks.some((check) => !check || Array.isArray(check) ||
        Object.keys(check).sort().join(',') !== 'detail,name,passed' || !CHECK_NAMES.has(check.name) || typeof check.passed !== 'boolean' || !safeRequired(check.detail)) ||
      !sameStrings(checks.map((check) => check.name), expectedNames) ||
      verification.passed !== (checks.every((check) => check.passed) ? 1 : 0) || !safeRequired(verification.detail)) throw new Error('outcome evaluation refuses malformed verification evidence');
  }
  const routing = latest(routings);
  const attempts = new Set();
  for (const invocation of invocations) {
    const provider = providerRegistry.get(invocation.provider);
    const expectedMode = provider?.adapterType === 'mock' ? 'mock' : 'real';
    if (!provider || invocation.adapter_type !== provider.adapterType || !provider.modelIdentifiers.includes(invocation.model) ||
      invocation.mode !== expectedMode || !['completed','failed','timeout','cancelled'].includes(invocation.status) ||
      ![invocation.timed_out, invocation.cancelled].every((value) => value === 0 || value === 1) ||
      invocation.timed_out !== (invocation.status === 'timeout' ? 1 : 0) ||
      invocation.cancelled !== (invocation.status === 'cancelled' ? 1 : 0)) throw new Error('outcome evaluation refuses malformed provider evidence');
    if (provider.adapterType === 'mock' && invocation.cost_cents !== 0) throw new Error('outcome evaluation refuses nonzero mock provider cost');
    if (!Number.isSafeInteger(Number(invocation.attempt)) || Number(invocation.attempt) < 1) throw new Error('outcome evaluation refuses impossible retry count');
    if (attempts.has(Number(invocation.attempt))) throw new Error('outcome evaluation refuses duplicate provider attempts');
    attempts.add(Number(invocation.attempt));
    for (const value of [invocation.input_bytes, invocation.output_bytes, invocation.input_tokens, invocation.output_tokens, invocation.cost_cents, invocation.duration_ms]) {
      if (value != null && (!Number.isSafeInteger(Number(value)) || Number(value) < 0)) throw new Error('outcome evaluation refuses malformed provider evidence');
    }
    if ((routing?.selected_provider && invocation.provider !== routing.selected_provider) || (run.provider && invocation.provider !== run.provider)) throw new Error('outcome evaluation refuses contradictory provider evidence');
  }
  if ([...attempts].some((attempt, index) => attempt !== index + 1)) throw new Error('outcome evaluation refuses non-contiguous provider attempts');
  if (invocations.slice(0, -1).some((invocation) => !['failed','timeout'].includes(invocation.status))) throw new Error('outcome evaluation refuses contradictory provider retry evidence');
}
function validateCrossSourceEvidence({ run, steps, routings, policies, verifications, invocations }) {
  const terminalOutcomes = {
    completed: new Set(['verified']),
    blocked: new Set(['emergency_stop','policy_denied','blocked_pending_approval','real_provider_blocked','approval_required','execution_blocked']),
    failed: new Set(['execution_blocked','execution_failed','budget_exhausted','verification_failed','error']),
    cancelled: new Set(['cancelled']),
  };
  if (!terminalOutcomes[run.status]?.has(run.outcome)) throw new Error('outcome evaluation refuses contradictory terminal evidence');
  const step = (name) => steps.find((row) => row.name === name);
  const detail = (name) => parsedJson(step(name)?.detail);
  const policy = latest(policies);
  const routing = latest(routings);
  const verification = latest(verifications);
  const invocation = invocations.at(-1);
  const receivedStep = detail('hermes.received');
  const normalizedStep = detail('hermes.normalized');
  if (!receivedStep || receivedStep.channel !== run.channel || !safeRequired(receivedStep.profile) ||
    canonicalJson(normalizedStep) !== canonicalJson({ objective: run.objective })) throw new Error('outcome evaluation refuses contradictory canonical intake evidence');
  const policyStep = detail('hermes.policy_evaluated');
  if (Boolean(policy) !== Boolean(policyStep) || (policy && canonicalJson(policyStep) !== canonicalJson({
    actionClass: policy.action_class, allowed: policy.decision === 'allow', requiresApproval: Boolean(policy.requires_approval),
    decision: policy.decision, reason: policy.reason,
  }))) throw new Error('outcome evaluation refuses contradictory policy evidence');
  const routedStep = detail('hermes.routed');
  if (Boolean(routing) !== Boolean(routedStep) || (routing && canonicalJson(routedStep) !== canonicalJson({
    provider: routing.selected_provider, agent: routing.selected_agent, capabilities: parsedJson(routing.capabilities),
  }))) throw new Error('outcome evaluation refuses contradictory routing evidence');
  const verifiedStep = detail('hermes.verified');
  if (Boolean(verification) !== Boolean(verifiedStep) || (verification && canonicalJson(verifiedStep) !== canonicalJson({
    passed: Boolean(verification.passed), detail: verification.detail,
  }))) throw new Error('outcome evaluation refuses contradictory verification evidence');
  if (routing && (run.agent !== routing.selected_agent || (run.provider && run.provider !== routing.selected_provider))) throw new Error('outcome evaluation refuses contradictory run routing evidence');
  if (invocation && run.cost_cents !== invocation.cost_cents) throw new Error('outcome evaluation refuses contradictory run cost evidence');
  const executedStep = detail('hermes.executed');
  if (invocation) {
    const expectedMode = invocation.status === 'completed' ? invocation.mode : invocation.status === 'cancelled' ? 'cancelled' : 'failed';
    if (!executedStep || executedStep.provider !== invocation.provider || executedStep.executionMode !== expectedMode ||
      executedStep.ok !== (invocation.status === 'completed') || executedStep.attempts !== invocation.attempt ||
      executedStep.durationMs !== invocation.duration_ms || executedStep.timedOut !== Boolean(invocation.timed_out) ||
      executedStep.cancelled !== Boolean(invocation.cancelled) || !Number.isSafeInteger(executedStep.artifactCount) || executedStep.artifactCount < 0) {
      throw new Error('outcome evaluation refuses contradictory execution evidence');
    }
  } else if (executedStep && (!routing || canonicalJson(executedStep) !== canonicalJson({
    provider: routing.selected_provider, executionMode: 'blocked', ok: false, attempts: 0, durationMs: 0,
    timedOut: false, cancelled: false, artifactCount: 0,
  }))) {
    throw new Error('outcome evaluation refuses contradictory blocked execution evidence');
  }
  const artifactCheck = verification ? parsedJson(verification.checks)?.find((check) => check.name === 'artifact_present_for_edit') : null;
  if (artifactCheck && (!executedStep || artifactCheck.passed !== (executedStep.artifactCount > 0))) {
    throw new Error('outcome evaluation refuses contradictory artifact verification evidence');
  }
  const completedStep = detail('hermes.completed');
  if (run.status === 'completed' && canonicalJson(completedStep) !== canonicalJson({ outcome: run.outcome, executionMode: invocation?.mode || null })) throw new Error('outcome evaluation refuses contradictory completion evidence');
  if (!rowsWithinStage(policies, step('hermes.classified'), step('hermes.policy_evaluated')) ||
    !rowsWithinStage(routings, step('hermes.policy_evaluated'), step('hermes.routed')) ||
    !rowsWithinStage(invocations, step('hermes.routed'), step('hermes.executed'), true) ||
    !rowsWithinStage(verifications, step('hermes.executed'), step('hermes.verified'))) {
    throw new Error('outcome evaluation refuses contradictory evidence chronology');
  }
}
function rowsWithinStage(rows, startStep, endStep, requireMonotonic = false) {
  if (!rows.length) return true;
  if (!startStep || !endStep) return false;
  const start = Date.parse(startStep.created_at);
  const end = Date.parse(endStep.created_at);
  return rows.every((row, index) => {
    const timestamp = Date.parse(row.created_at);
    return timestamp >= start && timestamp <= end &&
      (!requireMonotonic || !index || timestamp >= Date.parse(rows[index - 1].created_at));
  });
}
function aggregateUsage(invocations) {
  const total = (column) => invocations.length && invocations.every((row) => row[column] != null)
    ? invocations.reduce((sum, row) => {
      const next = sum + Number(row[column]);
      if (!Number.isSafeInteger(next)) throw new Error('outcome evaluation refuses provider usage overflow');
      return next;
    }, 0) : null;
  return { inputTokens: total('input_tokens'), outputTokens: total('output_tokens'), costCents: total('cost_cents') };
}
function readableEvaluation(evaluation) {
  if (!evaluation || evaluation.evaluation_version !== OUTCOME_EVALUATION_VERSION || evaluation.evaluator_version !== OUTCOME_EVALUATOR_VERSION || !evaluationShapeValid(evaluation) || !provenanceMatches(evaluation)) return false;
  const validationEpoch = Date.now();
  return correctionChainValid(evaluation, getOutcomeCorrections(evaluation.id), validationEpoch) &&
    sourceEventsValid(evaluation, getOutcomeSourceEvents(evaluation.id), validationEpoch);
}
function correctionChainValid(evaluation, corrections, validationEpoch) {
  return corrections.every((row, index) => row.evaluation_id === evaluation.id && row.workspace_id === evaluation.workspace_id && row.run_id === evaluation.run_id &&
    safeId(row.id) && Number(row.version) === index + 1 && row.supersedes_correction_id === (index ? corrections[index - 1].id : null) &&
    safeRequired(row.reason) && row.reason === redactString(row.reason) && safeRequired(row.source_evidence) && row.source_evidence === redactString(row.source_evidence) && recordedActorValid(row.actor_principal_id, evaluation.workspace_id, row.created_at) && validTimestamp(row.created_at) &&
    Date.parse(row.created_at) >= Date.parse(evaluation.created_at) && Date.parse(row.created_at) <= validationEpoch &&
    (!index || Date.parse(row.created_at) >= Date.parse(corrections[index - 1].created_at)));
}
function sourceEventsValid(evaluation, events, validationEpoch) {
  const idempotencyKeys = new Set();
  return events.every((row, index) => {
    if (row.evaluation_id !== evaluation.id || row.workspace_id !== evaluation.workspace_id || row.run_id !== evaluation.run_id || !safeId(row.id) || !recordedActorValid(row.actor_principal_id, evaluation.workspace_id, row.created_at) || !safeEvidenceId(row.idempotency_key) || idempotencyKeys.has(row.idempotency_key) || !EVENT_TYPES.has(row.event_type) || !safeRequired(row.evidence) || row.evidence !== redactString(row.evidence) || !validTimestamp(row.created_at) || Date.parse(row.created_at) < Date.parse(evaluation.created_at) || Date.parse(row.created_at) > validationEpoch || (index && Date.parse(row.created_at) < Date.parse(events[index - 1].created_at))) return false;
    idempotencyKeys.add(row.idempotency_key); return true;
  });
}
function validTimestamp(value) { return canonicalTimestamp(value); }
function recordedActorValid(actorPrincipalId, workspaceId, evidenceTime) {
  if (!safeId(actorPrincipalId)) return false;
  const actor = get('SELECT id,type,authentication_method,status,issued_at,created_at,expires_at,revoked_at,disabled_at,security_version FROM auth_principals WHERE id=?', [actorPrincipalId]);
  const evidenceEpoch = Date.parse(evidenceTime);
  const currentGrant = activeGrant(actorPrincipalId, workspaceId);
  const grantRows = currentGrant ? all('SELECT * FROM auth_workspace_grants WHERE principal_id=? AND workspace_id=? ORDER BY version', [actorPrincipalId, workspaceId]) : [];
  const effectiveGrants = grantRows.filter((grant, index) => {
    const start = Math.max(grant.issued_at, grant.created_at);
    const successor = grantRows[index + 1];
    const successorStart = successor ? Math.max(successor.issued_at, successor.created_at) : Infinity;
    const end = Math.min(grant.expires_at ?? Infinity, grant.revoked_at ?? Infinity, successorStart);
    return start <= evidenceEpoch && evidenceEpoch < end;
  });
  const historicalGrant = effectiveGrants.length === 1 ? effectiveGrants[0] : null;
  let historicalPermission = false;
  try {
    const permissions = historicalGrant ? JSON.parse(canonicalPermissions(historicalGrant.permissions)) : [];
    historicalPermission = permissions.includes('evaluation.correct') || (actor?.type !== 'service' && historicalGrant?.role === 'admin');
  } catch { return false; }
  if (!(actor && ['admin','service'].includes(actor.type) && actor.authentication_method === (actor.type === 'admin' ? 'bearer' : 'service') && actor.status === 'active' &&
    (actor.expires_at === null || Number(actor.expires_at) > Date.now()) && actor.revoked_at === null && actor.disabled_at === null &&
    Number.isSafeInteger(Number(actor.security_version)) && Number(actor.security_version) > 0 && Number.isFinite(Number(actor.issued_at)) &&
    actor.issued_at <= evidenceEpoch && actor.created_at <= evidenceEpoch && (actor.expires_at === null || actor.expires_at > evidenceEpoch) &&
    historicalPermission && currentGrant)) return false;
  // Subordinate evidence remains trusted only while its actor is still an authorized corrector.
  // The resolver-created principal prevents a persisted ID from acting as a client-created shape.
  const principal = resolvePrincipal({ principalId: actor.id });
  return Boolean(principal && hasCurrentWorkspacePermission(principal, workspaceId, 'evaluation.correct'));
}
function provenanceMatches(evaluation) {
  try {
    const evidence = loadEvidence(evaluation.run_id);
    validateEvidence(evidence);
    if (evaluation.execution_mode !== canonicalExecutionMode(evidence)) return false;
    if (evaluation.classification !== safeJson(canonicalClassification(evidence))) return false;
    const payload = evaluationPayload(evaluation);
    const components = persistedComponents(evaluation, getOutcomeComponents(evaluation.id), evidence);
    const packet = provenancePacket(evidence, payload, components);
    assertSanitized(packet);
    return evaluation.provenance_digest === digest(packet);
  } catch { return false; }
}
function latest(rows) { return rows.length ? rows[rows.length - 1] : null; }
function durationMs(start, end) { const duration = Date.parse(end) - Date.parse(start); return canonicalTimestamp(start) && canonicalTimestamp(end) && Number.isSafeInteger(duration) && duration >= 0 ? duration : null; }
function failureCategory(run, verification, invocation) { if (run.status === 'blocked') return 'blocked'; if (run.status === 'cancelled' || invocation?.cancelled) return 'cancelled'; if (invocation?.timed_out) return 'timeout'; if (verification && !(verification.passed === 1 || verification.passed === true)) return 'verification_failed'; return run.outcome || 'unknown'; }
function safeJson(value) { try { return JSON.stringify(redactDeep(JSON.parse(value || 'null'))); } catch { return JSON.stringify(redactDeep(value)); } }
function digest(value) { return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex'); }
function canonicalJson(value) { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`; if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`; return JSON.stringify(value); }
function canonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}
function parsedJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}
function sanitizedJson(value) {
  try {
    const parsed = JSON.parse(value);
    return canonicalJson(parsed) === canonicalJson(redactDeep(parsed));
  } catch { return false; }
}
function validClassification(value) {
  return value && !Array.isArray(value) && Object.keys(value).sort().join(',') === 'complexity,domain,requiredCapabilities,risk,urgency' &&
    ['status','documentation','code','general'].includes(value.domain) && ['low','medium','high'].includes(value.risk) &&
    ['trivial','moderate','complex'].includes(value.complexity) && ['low','normal','high'].includes(value.urgency) &&
    Array.isArray(value.requiredCapabilities) && value.requiredCapabilities.length > 0 &&
    value.requiredCapabilities.every(safeId) && new Set(value.requiredCapabilities).size === value.requiredCapabilities.length;
}
function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
function canonicalClassification(evidence) {
  const routing = latest(evidence.routings);
  const classifiedStep = evidence.steps.find((step) => step.name === 'hermes.classified');
  const routingClassification = routing ? parsedJson(routing.classification) : null;
  const stepClassification = classifiedStep ? parsedJson(classifiedStep.detail) : null;
  if (routingClassification && stepClassification && canonicalJson(routingClassification) !== canonicalJson(stepClassification)) throw new Error('outcome evaluation refuses contradictory classification evidence');
  const classification = routingClassification || stepClassification;
  if (classification !== null && !validClassification(classification)) throw new Error('outcome evaluation refuses malformed classification evidence');
  return classification;
}
function canonicalExecutionMode(evidence) {
  const invocation = evidence.invocations.at(-1);
  if (invocation) return invocation.mode;
  if (evidence.run.status === 'blocked' || evidence.run.outcome === 'execution_blocked' || evidence.run.outcome === 'approval_required') return 'blocked';
  if (evidence.run.status === 'cancelled') return 'cancelled';
  if (evidence.run.status === 'failed') return 'failed';
  return null;
}
function assertSanitized(value) {
  if (!stringsAreSanitized(value)) throw new Error('outcome evaluation refuses unsanitized persisted evidence');
}
function stringsAreSanitized(value) {
  if (typeof value === 'string') return value === redactString(value);
  if (Array.isArray(value)) return value.every(stringsAreSanitized);
  if (value && typeof value === 'object') return Object.values(value).every(stringsAreSanitized);
  return true;
}
function provenancePacket(evidence, payload, components) {
  return {
    task: taskIdentity(evidence.task),
    run: evidence.run,
    steps: evidence.steps,
    routings: evidence.routings,
    policies: evidence.policies,
    verifications: evidence.verifications,
    invocations: evidence.invocations,
    payload,
    components,
  };
}
function taskIdentity(task) {
  const normalized = normalizeTask(task);
  return {
    id: normalized.taskId, workspaceId: normalized.workspaceId, conversationId: normalized.conversationId,
    actorId: normalized.actorId, sourceChannel: normalized.channel, request: normalized.objective,
  };
}
function evaluationPayload(evaluation) {
  return {
    id: evaluation.id, evaluationVersion: evaluation.evaluation_version, userId: evaluation.user_id,
    projectId: evaluation.project_id, workspaceId: evaluation.workspace_id, taskId: evaluation.task_id, runId: evaluation.run_id,
    routingDecisionId: evaluation.routing_decision_id, policyDecisionId: evaluation.policy_decision_id, verificationResultId: evaluation.verification_result_id,
    providerInvocationId: evaluation.provider_invocation_id, executionMode: evaluation.execution_mode, providerId: evaluation.provider_id,
    classification: evaluation.classification, terminalStatus: evaluation.terminal_status, terminalOutcome: evaluation.terminal_outcome,
    verificationStatus: evaluation.verification_status, verifierConfidence: evaluation.verifier_confidence, acceptanceStatus: evaluation.acceptance_status,
    retryCount: evaluation.retry_count, durationMs: evaluation.duration_ms, inputTokens: evaluation.input_tokens, outputTokens: evaluation.output_tokens,
    costCents: evaluation.cost_cents, timedOut: Boolean(evaluation.timed_out), cancelled: Boolean(evaluation.cancelled),
    rollbackEvidence: evaluation.rollback_evidence, stabilityEvidence: evaluation.stability_evidence, failureCategory: evaluation.failure_category,
    learningEligibility: evaluation.learning_eligibility, sourceEventStartSeq: evaluation.source_event_start_seq, sourceEventEndSeq: evaluation.source_event_end_seq,
    evaluatorVersion: evaluation.evaluator_version, createdAt: evaluation.created_at,
  };
}
function evaluationShapeValid(evaluation) {
  const nullableIds = [evaluation.user_id,evaluation.routing_decision_id,evaluation.policy_decision_id,evaluation.verification_result_id,evaluation.provider_invocation_id,evaluation.provider_id];
  const nullableNumbers = [evaluation.retry_count,evaluation.input_tokens,evaluation.output_tokens,evaluation.cost_cents];
  return safeId(evaluation.id) && safeId(evaluation.workspace_id) && safeId(evaluation.project_id) && evaluation.project_id === evaluation.workspace_id &&
    safeId(evaluation.task_id) && safeId(evaluation.run_id) && (evaluation.user_id === null || safeActor(evaluation.user_id)) &&
    nullableIds.slice(1).every((value) => value === null || safeId(value)) &&
    [null,'mock','real','blocked','failed','cancelled'].includes(evaluation.execution_mode) &&
    TERMINAL.has(evaluation.terminal_status) && ['passed','failed','unavailable'].includes(evaluation.verification_status) &&
    ['deterministic_pass','deterministic_fail','unknown'].includes(evaluation.verifier_confidence) && evaluation.acceptance_status === 'unavailable' &&
    ['positive_eligible','ineligible_blocked','negative_factual'].includes(evaluation.learning_eligibility) &&
    [evaluation.timed_out,evaluation.cancelled].every((value) => value === 0 || value === 1) &&
    nullableNumbers.every((value) => value === null || (Number.isSafeInteger(Number(value)) && Number(value) >= 0)) &&
    Number.isSafeInteger(Number(evaluation.duration_ms)) && Number(evaluation.duration_ms) >= 0 &&
    Number.isSafeInteger(Number(evaluation.source_event_start_seq)) && Number.isSafeInteger(Number(evaluation.source_event_end_seq)) &&
    canonicalTimestamp(evaluation.created_at) && typeof evaluation.provenance_digest === 'string' && /^[a-f0-9]{64}$/.test(evaluation.provenance_digest);
}
function persistedComponents(evaluation, rows, evidence) {
  const invocation = evidence.invocations.at(-1) || null;
  const verification = evidence.verifications.at(-1) || null;
  const expected = componentRows({
    positive: evaluation.learning_eligibility === 'positive_eligible',
    verified: verification?.passed === 1 || verification?.passed === true,
    retryCount: evaluation.retry_count,
    duration: evaluation.duration_ms,
    invocation,
    usage: { inputTokens: evaluation.input_tokens, outputTokens: evaluation.output_tokens, costCents: evaluation.cost_cents },
    run: evidence.run,
  }).sort((left, right) => left.name.localeCompare(right.name));
  if (rows.length !== expected.length) throw new Error('outcome evaluation refuses malformed component packet');
  return rows.map((row, index) => {
    const expectedRow = expected[index];
    if (!safeId(row.id) || row.evaluation_id !== evaluation.id || row.name !== expectedRow.name || row.value !== expectedRow.value || row.status !== expectedRow.status || row.detail !== expectedRow.detail || row.created_at !== evaluation.created_at) throw new Error('outcome evaluation refuses malformed component packet');
    return { id: row.id, evaluationId: row.evaluation_id, name: row.name, value: row.value, status: row.status, detail: row.detail, createdAt: row.created_at };
  });
}
