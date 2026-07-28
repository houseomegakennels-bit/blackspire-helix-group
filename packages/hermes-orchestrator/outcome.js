// Hermes Milestone 3A: verified outcome scoring and immutable provenance.
// This service is internal-only. It produces factual, append-only evaluations after a terminal
// run; it never changes routing, policy, memory, provider state, or task state.
import crypto from 'node:crypto';
import { id, now } from '../shared/util.js';
import { transaction } from '../task-engine/db.js';
import { redactDeep, redactString } from './redaction.js';
import { getWorkflowRun, getWorkflowSteps, getRoutingDecisions, getPolicyDecisions, getVerificationResults, getProviderInvocations, getOutcomeEvaluationForRun, insertOutcomeEvaluation, getOutcomeEvaluation, getOutcomeCorrections, getOutcomeSourceEvents, insertOutcomeCorrection, insertOutcomeSourceEvent, insertOutcomeEvaluationFailure } from './store.js';
import { canReadEvaluation, canCorrectEvaluation } from '../shared/authorization.js';

export const OUTCOME_EVALUATION_VERSION = 'm3a-v1';
export const OUTCOME_EVALUATOR_VERSION = 'hermes-outcome-evaluator-v1';
const TERMINAL = new Set(['completed', 'failed', 'blocked', 'cancelled']);

export function evaluateTerminalOutcome(runId, { evaluationVersion = OUTCOME_EVALUATION_VERSION } = {}) {
  if (typeof runId !== 'string' || !runId) throw new Error('outcome evaluation requires a run id');
  return transaction(() => {
    if (getOutcomeEvaluationForRun(runId, evaluationVersion)) throw new Error('outcome evaluation already exists for this run and version');
    const run = getWorkflowRun(runId);
    if (!run || !TERMINAL.has(run.status) || !run.finished_at) throw new Error('outcome evaluation requires a finished terminal workflow run');
    const steps = getWorkflowSteps(runId);
    if (!steps.length || !ordered(steps) || !terminalEventsPresent(steps, run.status)) throw new Error('outcome evaluation requires complete ordered terminal workflow evidence');
    const verification = latest(getVerificationResults(runId));
    const routing = latest(getRoutingDecisions(runId));
    const policy = latest(getPolicyDecisions(runId));
    const invocations = getProviderInvocations(runId);
    const invocation = invocations.length ? invocations[invocations.length - 1] : null;
    validateLinks({ run, routing, policy, verification, invocation });
    const verified = verification?.passed === 1 || verification?.passed === true;
    const terminalCompleted = run.status === 'completed' && run.outcome === 'verified';
    const positive = terminalCompleted && verified;
    const mode = invocation?.mode || (run.provider === 'mock' ? 'mock' : null);
    const duration = durationMs(run.started_at, run.finished_at);
    if (duration === null) throw new Error('outcome evaluation refuses malformed or negative duration');
    const retryCount = invocation ? Math.max(0, Number(invocation.attempt || 1) - 1) : null;
    const components = componentRows({ positive, verified, retryCount, duration, invocation, run });
    const payload = {
      evaluationVersion, userId: run.actor_id || null,
      // Projects do not yet have a canonical ID. In Phase 3A the workspace is the project boundary.
      projectId: run.workspace_id, workspaceId: run.workspace_id, taskId: run.task_id || null, runId,
      routingDecisionId: routing?.id || null, policyDecisionId: policy?.id || null, verificationResultId: verification?.id || null,
      providerInvocationId: invocation?.id || null, executionMode: mode, providerId: invocation?.provider || run.provider || null,
      classification: safeJson(run.classification), terminalStatus: run.status, terminalOutcome: run.outcome || null,
      verificationStatus: verification ? (verified ? 'passed' : 'failed') : 'unavailable',
      verifierConfidence: verification ? (verified ? 'deterministic_pass' : 'deterministic_fail') : 'unknown',
      acceptanceStatus: 'unavailable', retryCount, durationMs: duration,
      inputTokens: numOrNull(invocation?.input_tokens), outputTokens: numOrNull(invocation?.output_tokens), costCents: numOrNull(invocation?.cost_cents),
      timedOut: Boolean(invocation?.timed_out), cancelled: Boolean(invocation?.cancelled) || run.status === 'cancelled',
      rollbackEvidence: null, stabilityEvidence: null,
      failureCategory: positive ? null : failureCategory(run, verification, invocation),
      learningEligibility: positive ? 'positive_eligible' : run.status === 'blocked' ? 'ineligible_blocked' : 'negative_factual',
      sourceEventStartSeq: steps[0].seq, sourceEventEndSeq: steps.at(-1).seq,
      evaluatorVersion: OUTCOME_EVALUATOR_VERSION, createdAt: now(),
    };
    payload.id = id('heval');
    payload.provenanceDigest = digest({ run, steps, routing, policy, verification, invocation, payload: { ...payload, id: undefined, createdAt: undefined } });
    insertOutcomeEvaluation(payload, components.map((c) => ({ ...c, id: id('hecomp') })));
    return { evaluation: payload, components };
  });
}

// Authorization-facing reads return only bounded factual summaries.  The DB-derived workspace
// decides scope; caller input never chooses the authority or filters an unscoped list.
export function readOutcomeEvaluation(principal, evaluationId) {
  const evaluation = getOutcomeEvaluation(evaluationId);
  if (!evaluation) return null;
  const decision = canReadEvaluation(principal, evaluation.workspace_id);
  if (!decision.allowed) return null;
  return { id: evaluation.id, workspaceId: evaluation.workspace_id, runId: evaluation.run_id,
    evaluationVersion: evaluation.evaluation_version, terminalStatus: evaluation.terminal_status,
    terminalOutcome: evaluation.terminal_outcome, verificationStatus: evaluation.verification_status,
    acceptanceStatus: evaluation.acceptance_status, failureCategory: evaluation.failure_category,
    learningEligibility: evaluation.learning_eligibility, createdAt: evaluation.created_at,
    corrections: getOutcomeCorrections(evaluation.id).map(safeCorrection), sourceEvents: getOutcomeSourceEvents(evaluation.id).map(safeEvent) };
}

export function appendOutcomeCorrection(principal, evaluationId, { reason, sourceEvidence, supersedesCorrectionId = null } = {}) {
  const evaluation = getOutcomeEvaluation(evaluationId);
  if (!evaluation) throw new Error('outcome correction requires an existing evaluation');
  if (!canCorrectEvaluation(principal, evaluation.workspace_id).allowed) throw new Error('outcome correction is not authorized');
  if (!safeRequired(reason) || !safeRequired(sourceEvidence)) throw new Error('outcome correction requires reason and source evidence');
  const prior = getOutcomeCorrections(evaluationId);
  const head = prior.at(-1) || null;
  if (head && supersedesCorrectionId !== head.id) throw new Error('outcome correction must supersede the sole current correction head');
  if (!head && supersedesCorrectionId) throw new Error('outcome correction cannot supersede an absent correction');
  const row = { id: id('hecorr'), evaluationId, workspaceId: evaluation.workspace_id, runId: evaluation.run_id,
    version: prior.length + 1, supersedesCorrectionId: head?.id || null, reason, sourceEvidence,
    actorPrincipalId: principal.principalId, createdAt: now() };
  insertOutcomeCorrection(row); return safeCorrection(row);
}

const EVENT_TYPES = new Set(['accepted','rejected','partially_accepted','rollback','follow_up_verification','stability_confirmed','regression_linked']);
export function appendOutcomeSourceEvent(principal, evaluationId, { idempotencyKey, eventType, evidence } = {}) {
  const evaluation = getOutcomeEvaluation(evaluationId);
  if (!evaluation) throw new Error('outcome source event requires an existing evaluation');
  if (!canCorrectEvaluation(principal, evaluation.workspace_id).allowed) throw new Error('outcome source event is not authorized');
  if (!EVENT_TYPES.has(eventType) || !safeRequired(evidence) || !safeId(idempotencyKey)) throw new Error('outcome source event requires an allowed type, evidence, and idempotency key');
  const row = { id: id('heevt'), evaluationId, workspaceId: evaluation.workspace_id, runId: evaluation.run_id, eventType, evidence, actorPrincipalId: principal.principalId, idempotencyKey, createdAt: now() };
  try { insertOutcomeSourceEvent(row); } catch { throw new Error('outcome source event already recorded'); }
  return safeEvent(row);
}

export function recordOutcomeEvaluationFailure(runId, error) {
  const run = getWorkflowRun(runId); if (!run) return null;
  const category = error instanceof Error && /terminal|evidence|provenance|duration|usage|retry/i.test(error.message) ? 'invalid_evidence' : 'evaluation_failed';
  try { insertOutcomeEvaluationFailure({ id: id('hefail'), runId, workspaceId: run.workspace_id, category, remediationState: 'open', detail: category, createdAt: now() }); } catch { return null; }
  return category;
}
function safeRequired(value) { return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f\x7f]/.test(value); }
function safeId(value) { return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value); }
function safeCorrection(row) { return { id: row.id, version: row.version, supersedesCorrectionId: row.supersedes_correction_id ?? row.supersedesCorrectionId ?? null, reason: row.reason, sourceEvidence: row.source_evidence ?? row.sourceEvidence, createdAt: row.created_at ?? row.createdAt }; }
function safeEvent(row) { return { id: row.id, eventType: row.event_type ?? row.eventType, createdAt: row.created_at ?? row.createdAt }; }

function componentRows({ positive, verified, retryCount, duration, invocation, run }) {
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
    invocation?.cost_cents == null ? unknown('cost_cents') : known('cost_cents', invocation.cost_cents, 'provider-reported cost only'),
    unknown('user_acceptance'), unknown('rollback_evidence'), unknown('stability_evidence'),
    known('learning_eligibility', positive ? 'positive_eligible' : 'not_positive', 'does not affect routing in Phase 3A'),
  ];
}
function ordered(steps) { return steps.every((s, i) => Number.isInteger(s.seq) && s.seq === i + 1 && s.created_at); }
function terminalEventsPresent(steps, status) { const names = new Set(steps.map((s) => s.name)); return names.has('hermes.received') && (status === 'completed' ? names.has('hermes.completed') : names.has('hermes.failed')); }
function validateLinks({ run, routing, policy, verification, invocation }) {
  for (const row of [routing, policy, verification, invocation]) {
    if (!row) continue;
    if (row.run_id !== run.id || (row.task_id && row.task_id !== run.task_id)) throw new Error('outcome evaluation refuses mismatched provenance references');
  }
  if (invocation && !['mock', 'real'].includes(invocation.mode)) throw new Error('outcome evaluation refuses invalid execution mode');
  if (invocation && (!Number.isSafeInteger(Number(invocation.attempt)) || Number(invocation.attempt) < 1)) throw new Error('outcome evaluation refuses impossible retry count');
  for (const value of [invocation?.input_tokens, invocation?.output_tokens, invocation?.cost_cents]) if (value != null && (!Number.isFinite(Number(value)) || Number(value) < 0)) throw new Error('outcome evaluation refuses malformed usage or cost');
}
function latest(rows) { return rows.length ? rows[rows.length - 1] : null; }
function durationMs(start, end) { const n = Date.parse(end) - Date.parse(start); return Number.isFinite(n) && n >= 0 ? n : null; }
function numOrNull(v) { return v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null); }
function failureCategory(run, verification, invocation) { if (run.status === 'blocked') return 'blocked'; if (run.status === 'cancelled' || invocation?.cancelled) return 'cancelled'; if (invocation?.timed_out) return 'timeout'; if (verification && !(verification.passed === 1 || verification.passed === true)) return 'verification_failed'; return run.outcome || 'unknown'; }
function safeJson(value) { try { return JSON.stringify(redactDeep(JSON.parse(value || 'null'))); } catch { return JSON.stringify(redactDeep(value)); } }
function digest(value) { return crypto.createHash('sha256').update(canonicalJson(redactDeep(value))).digest('hex'); }
function canonicalJson(value) { if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`; if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`; return JSON.stringify(value); }
