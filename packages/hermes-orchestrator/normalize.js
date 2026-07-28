// Hermes task normalization (Milestone 1).
//
// Converts a Jarvis/unified task (any channel) into a canonical, validated NormalizedTask. This is
// the single entry shape the orchestrator accepts, so every downstream stage (classify/route/
// execute/verify) sees the same fields regardless of source channel. It reuses the canonical task /
// conversation ids already produced by unified-input rather than minting new identifiers.
import { redactString } from './redaction.js';

/**
 * @typedef {Object} NormalizedTask
 * @property {string} taskId
 * @property {string} conversationId
 * @property {string} workspaceId
 * @property {string} actorId
 * @property {'jarvis'|'telegram'|'api'|string} channel
 * @property {string} objective        redacted, trimmed, length-capped request text
 * @property {number} budgetCents
 * @property {string} idempotencyKey
 * @property {string} authority         authority class for canonical policy (e.g. 'telegram', 'authenticated_admin')
 * @property {string|null} priorPolicyDecision  a denial already recorded by canonical intake, if any
 */

const MAX_OBJECTIVE_CHARS = 4000;

/**
 * @param {Object} input a task-like row (from task-engine) or an explicit descriptor
 * @returns {NormalizedTask}
 */
export function normalizeTask(input) {
  if (!input || typeof input !== 'object') throw new Error('normalizeTask requires an object');
  const taskId = str(input.taskId ?? input.id);
  const workspaceId = str(input.workspaceId ?? input.workspace_id);
  const objectiveRaw = String(input.objective ?? input.request ?? '').trim();
  if (!taskId) throw new Error('normalizeTask: taskId is required');
  if (!workspaceId) throw new Error('normalizeTask: workspaceId is required');
  if (!objectiveRaw) throw new Error('normalizeTask: objective/request is required');

  const normalized = {
    taskId,
    conversationId: str(input.conversationId ?? input.conversation_id) || `task:${taskId}`,
    workspaceId,
    actorId: str(input.actorId ?? input.actor_id ?? input.authority_class) || 'unknown',
    channel: str(input.channel ?? input.source_channel) || 'api',
    objective: redactString(objectiveRaw).slice(0, MAX_OBJECTIVE_CHARS),
    budgetCents: intOrZero(input.budgetCents ?? input.budget_cents),
    idempotencyKey: str(input.idempotencyKey ?? input.idempotency_key) || `task:${taskId}`,
    authority: str(input.authority ?? input.authority_class)
      || ((str(input.channel ?? input.source_channel) || 'api') === 'telegram' ? 'telegram' : 'authenticated_admin'),
    // A denial already recorded by canonical intake (tasks.policy_decision / unified_inputs.policy_status).
    priorPolicyDecision: str(input.priorPolicyDecision ?? input.policy_decision ?? input.policy_status) || null,
  };
  validateNormalizedTask(normalized);
  return normalized;
}

export function validateNormalizedTask(t) {
  for (const key of ['taskId', 'conversationId', 'workspaceId', 'actorId', 'channel', 'objective', 'idempotencyKey', 'authority']) {
    if (typeof t[key] !== 'string' || !t[key]) throw new Error(`NormalizedTask.${key} must be a non-empty string`);
  }
  if (!Number.isSafeInteger(t.budgetCents) || t.budgetCents < 0) throw new Error('NormalizedTask.budgetCents must be a non-negative integer');
  return t;
}

const str = (v) => (v == null ? '' : String(v));
// Absent/blank budget defaults to 0 (free tier for the mock provider). A *provided* value that is a
// negative or non-integer number is preserved as-is so validateNormalizedTask rejects it as a
// malformed task, rather than being silently clamped to 0 (which would hide a bad input).
const intOrZero = (v) => {
  if (v == null || v === '') return 0;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : 0;
};
