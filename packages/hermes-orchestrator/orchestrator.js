// Hermes orchestrator — service boundary (Milestone 1).
//
// The single entry point for the Hermes Intelligence Layer. Ties together the M1 vertical slice:
//   Jarvis task -> normalize -> policy -> mock route -> mock execute -> verify -> event record -> memory candidate
// It persists a structured workflow run/steps and returns a redactable result. It performs NO real
// provider execution, NO shell, NO network, NO Telegram, and NO production changes. Memory is only
// ever proposed (pending candidate), never promoted.
//
// This is additive: it does not modify or replace packages/hermes/hermes.js (the existing task
// pipeline), which continues to own the production task flow unchanged.
import { getFlag } from '../task-engine/tasks.js';
import { normalizeTask } from './normalize.js';
import { classifyTask } from './classify.js';
import { evaluatePolicy } from './policy.js';
import { routeTask } from './route.js';
import { executeWorkflow, withinBudget } from './execute.js';
import { verifyExecution } from './verify.js';
import { extractMemoryCandidate } from './memory.js';
import { makeEventRecorder, HERMES_EVENTS } from './events.js';
import {
  insertWorkflowRun, finishWorkflowRun, insertRoutingDecision,
  insertPolicyDecision, insertVerificationResult,
} from './store.js';

/**
 * @typedef {Object} HermesRunResult
 * @property {string} runId
 * @property {'completed'|'failed'|'blocked'} status
 * @property {string} outcome
 * @property {import('./classify.js').Classification} [classification]
 * @property {import('./route.js').RoutingDecision} [routing]
 * @property {import('./verify.js').VerificationResult} [verification]
 * @property {{created:boolean,id?:string}} [memoryCandidate]
 */

/** @returns {Promise<HermesRunResult>} */
export async function runHermesWorkflow(input) {
  const normalized = normalizeTask(input);

  const runId = insertWorkflowRun({
    taskId: normalized.taskId,
    conversationId: normalized.conversationId,
    workspaceId: normalized.workspaceId,
    actorId: normalized.actorId,
    channel: normalized.channel,
    objective: normalized.objective,
    status: 'running',
  });
  const events = makeEventRecorder({ taskId: normalized.taskId, runId });
  events.record(HERMES_EVENTS.RECEIVED, { channel: normalized.channel });
  events.record(HERMES_EVENTS.NORMALIZED, { objective: normalized.objective });

  // Kill switch (charter #6): a global emergency stop refuses new orchestration outright.
  if (getFlag('emergency_stop') === 'active') {
    events.record(HERMES_EVENTS.FAILED, { reason: 'emergency stop active' }, 'failed');
    finishWorkflowRun(runId, { status: 'blocked', outcome: 'emergency_stop' });
    return { runId, status: 'blocked', outcome: 'emergency_stop' };
  }

  try {
    const classification = classifyTask(normalized);
    events.record(HERMES_EVENTS.CLASSIFIED, classification);

    // Policy gate (charter #6). In M1 a high-risk task is blocked pending approval rather than
    // executed — the approval engine is reused/extended in a later milestone.
    const policy = evaluatePolicy(normalized, classification);
    insertPolicyDecision(runId, normalized.taskId, policy);
    events.record(HERMES_EVENTS.POLICY_EVALUATED, policy);
    if (!policy.allowed) {
      events.record(HERMES_EVENTS.FAILED, { reason: policy.reason }, 'failed');
      finishWorkflowRun(runId, { status: 'blocked', outcome: policy.requiresApproval ? 'blocked_pending_approval' : 'policy_denied' });
      return { runId, status: 'blocked', outcome: policy.requiresApproval ? 'blocked_pending_approval' : 'policy_denied', classification };
    }

    const routing = routeTask(classification);
    insertRoutingDecision(runId, normalized.taskId, routing);
    events.record(HERMES_EVENTS.ROUTED, { provider: routing.provider, agent: routing.agent, capabilities: routing.capabilities });

    const execution = await executeWorkflow(routing, normalized);
    events.record(HERMES_EVENTS.EXECUTED, { provider: execution.provider, ok: execution.ok, summary: execution.summary, artifactCount: execution.artifacts.length });

    // Budget guard (charter #6): reject if the actual cost exceeded the ceiling. Evaluated every run
    // (not dead code); mock cost is 0 so it passes for any non-negative ceiling in M1.
    if (!withinBudget(execution.usage.costCents, normalized.budgetCents)) {
      events.record(HERMES_EVENTS.FAILED, { reason: 'budget exhausted', costCents: execution.usage.costCents, ceilingCents: normalized.budgetCents }, 'failed');
      finishWorkflowRun(runId, { status: 'failed', outcome: 'budget_exhausted', provider: routing.provider, agent: routing.agent, costCents: execution.usage.costCents });
      return { runId, status: 'failed', outcome: 'budget_exhausted', classification, routing };
    }

    const verification = verifyExecution(execution, { classification });
    insertVerificationResult(runId, normalized.taskId, verification);
    events.record(HERMES_EVENTS.VERIFIED, { passed: verification.passed, detail: verification.detail });

    if (!verification.passed) {
      events.record(HERMES_EVENTS.FAILED, { reason: 'verification failed' }, 'failed');
      finishWorkflowRun(runId, { status: 'failed', outcome: 'verification_failed', provider: routing.provider, agent: routing.agent, costCents: execution.usage.costCents });
      return { runId, status: 'failed', outcome: 'verification_failed', classification, routing, verification };
    }

    // Memory is ONLY proposed here (pending candidate). No automatic promotion in M1.
    const memoryCandidate = extractMemoryCandidate({ runId, normalized, classification, verification });
    if (memoryCandidate.created) events.record(HERMES_EVENTS.MEMORY_CANDIDATE, { id: memoryCandidate.id, status: 'pending' });

    finishWorkflowRun(runId, { status: 'completed', outcome: 'verified', provider: routing.provider, agent: routing.agent, costCents: execution.usage.costCents });
    events.record(HERMES_EVENTS.COMPLETED, { outcome: 'verified' });
    return { runId, status: 'completed', outcome: 'verified', classification, routing, verification, memoryCandidate };
  } catch (error) {
    events.record(HERMES_EVENTS.FAILED, { reason: String(error?.message || error) }, 'failed');
    finishWorkflowRun(runId, { status: 'failed', outcome: 'error' });
    return { runId, status: 'failed', outcome: 'error' };
  }
}
