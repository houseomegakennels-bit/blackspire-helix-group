// Hermes orchestrator — service boundary (Milestone 2).
//
// Runs the development real/mock execution flow:
//   Jarvis task -> normalize -> classify -> policy -> capability resolution -> provider selection
//     -> approval check -> budget/deadline -> real|mock execution -> verify -> event recording
//     -> usage/cost recording -> pending memory candidate (only when verified).
// The mock provider is the DEFAULT. A real provider runs ONLY when the task explicitly requests one
// AND the development runtime gate permits it; a requested-real that cannot run is reported blocked,
// never silently downgraded to mock. Production refuses non-mock execution regardless of anything.
import { getFlag } from '../task-engine/tasks.js';
import { normalizeTask } from './normalize.js';
import { classifyTask } from './classify.js';
import { evaluatePolicy } from './policy.js';
import { routeTask } from './route.js';
import { executeWorkflow, withinBudget } from './execute.js';
import { verifyExecution } from './verify.js';
import { extractMemoryCandidate } from './memory.js';
import { makeEventRecorder, HERMES_EVENTS } from './events.js';
import { resolveRuntimeProfile, realProviderPermitted, workspacePermitted, realProviderSpendPermitted } from './runtime-profile.js';
import { checkApproval, reserve } from './approvals.js';
import { providerRegistry } from './registries.js';
import { getWorkspace } from '../workspace-registry/workspaces.js';
import {
  insertWorkflowRun, finishWorkflowRun, insertRoutingDecision,
  insertPolicyDecision, insertVerificationResult,
} from './store.js';

/** @returns {Promise<Object>} */
export async function runHermesWorkflow(input, options = {}) {
  const env = options.env || process.env;
  const rp = resolveRuntimeProfile(env);
  const normalized = normalizeTask(input);

  const runId = insertWorkflowRun({
    taskId: normalized.taskId, conversationId: normalized.conversationId, workspaceId: normalized.workspaceId,
    actorId: normalized.actorId, channel: normalized.channel, objective: normalized.objective, status: 'running',
  });
  const events = makeEventRecorder({ taskId: normalized.taskId, runId });
  events.record(HERMES_EVENTS.RECEIVED, { channel: normalized.channel, profile: rp.profile });
  events.record(HERMES_EVENTS.NORMALIZED, { objective: normalized.objective });

  if (getFlag('emergency_stop') === 'active') {
    events.record(HERMES_EVENTS.FAILED, { reason: 'emergency stop active' }, 'failed');
    finishWorkflowRun(runId, { status: 'blocked', outcome: 'emergency_stop' });
    return done(runId, 'blocked', 'emergency_stop', { executionMode: 'blocked' });
  }

  try {
    const classification = classifyTask(normalized);
    events.record(HERMES_EVENTS.CLASSIFIED, classification);

    const policy = evaluatePolicy(normalized, classification);
    insertPolicyDecision(runId, normalized.taskId, policy);
    events.record(HERMES_EVENTS.POLICY_EVALUATED, policy);
    if (!policy.allowed) {
      events.record(HERMES_EVENTS.FAILED, { reason: policy.reason }, 'failed');
      const outcome = policy.requiresApproval ? 'blocked_pending_approval' : 'policy_denied';
      finishWorkflowRun(runId, { status: 'blocked', outcome });
      return done(runId, 'blocked', outcome, { executionMode: 'blocked', classification });
    }

    // --- Provider selection (registry-driven; no silent real->mock fallback) ---
    const requested = normalized.requestedProvider;
    let preferredProvider = null;
    if (requested && requested !== 'mock') {
      const gate = realProviderPermitted(requested, rp);
      if (!gate.allowed) {
        // A real provider was explicitly requested but cannot run. Block — do NOT fall back to mock.
        events.record(HERMES_EVENTS.FAILED, { reason: `real provider blocked: ${gate.reason}`, requested }, 'failed');
        finishWorkflowRun(runId, { status: 'blocked', outcome: 'real_provider_blocked', provider: requested });
        return done(runId, 'blocked', 'real_provider_blocked', { executionMode: 'blocked', classification, reason: gate.reason });
      }
      if (!providerRegistry.supports(requested, classification.requiredCapabilities[0])) {
        events.record(HERMES_EVENTS.FAILED, { reason: `provider ${requested} cannot serve capability`, requested }, 'failed');
        finishWorkflowRun(runId, { status: 'blocked', outcome: 'real_provider_blocked', provider: requested });
        return done(runId, 'blocked', 'real_provider_blocked', { executionMode: 'blocked', classification });
      }
      // A real provider is text-only, but it must still be bound to an explicitly allowlisted
      // development checkout.  Never trust a task-supplied path; resolve the registered workspace.
      const workspace = getWorkspace(normalized.workspaceId);
      const workspaceGate = workspacePermitted(workspace?.root_path, rp);
      if (!workspaceGate.allowed) {
        events.record(HERMES_EVENTS.FAILED, { reason: `real provider workspace blocked: ${workspaceGate.reason}`, requested }, 'failed');
        finishWorkflowRun(runId, { status: 'blocked', outcome: 'real_provider_blocked', provider: requested });
        return done(runId, 'blocked', 'real_provider_blocked', { executionMode: 'blocked', classification, reason: workspaceGate.reason });
      }
      const provider = providerRegistry.get(requested);
      const spendGate = realProviderSpendPermitted(requested, normalized.budgetCents, provider?.usageLimits?.maxCostCents, rp);
      if (!spendGate.allowed) {
        events.record(HERMES_EVENTS.FAILED, { reason: `real provider budget blocked: ${spendGate.reason}`, requested }, 'failed');
        finishWorkflowRun(runId, { status: 'blocked', outcome: 'real_provider_blocked', provider: requested });
        return done(runId, 'blocked', 'real_provider_blocked', { executionMode: 'blocked', classification, reason: spendGate.reason });
      }
      preferredProvider = requested;
    }

    const routing = routeTask(classification, { environment: rp.profile, preferredProvider });
    insertRoutingDecision(runId, normalized.taskId, routing);
    events.record(HERMES_EVENTS.ROUTED, { provider: routing.provider, agent: routing.agent, capabilities: routing.capabilities });

    // --- Approval gate: medium-risk tasks require a scoped, single-use, unexpired approval ---
    let approvalToConsume = null;
    if (classification.risk === 'medium') {
      const appr = checkApproval(normalized.taskId, policy.actionClass);
      if (!appr.ok) {
        events.record(HERMES_EVENTS.FAILED, { reason: `approval required: ${appr.reason}` }, 'failed');
        finishWorkflowRun(runId, { status: 'blocked', outcome: 'approval_required', provider: routing.provider });
        return done(runId, 'blocked', 'approval_required', { executionMode: 'blocked', classification, routing });
      }
      approvalToConsume = appr.approvalId;
    }

    // --- Execute (mock default or gated real) ---
    const execution = await executeWorkflow(routing, normalized, {
      runId, taskId: normalized.taskId, adapterOverrides: options.adapterOverrides, deps: options.deps, env,
      signal: options.signal, deadlineMs: options.deadlineMs,
      beforeDispatch: approvalToConsume ? () => reserve(approvalToConsume) : null,
    });
    events.record(HERMES_EVENTS.EXECUTED, { provider: execution.provider, executionMode: execution.executionMode, ok: execution.ok, attempts: execution.attempts, durationMs: execution.durationMs, timedOut: execution.timedOut, cancelled: execution.cancelled, artifactCount: execution.artifacts.length });

    if (execution.executionMode !== 'real' && execution.executionMode !== 'mock') {
      // blocked / cancelled / failed — no verification, no learning. Single-use approval is NOT
      // consumed on a non-execution so the operator can retry within the window.
      const outcome = execution.executionMode === 'cancelled' ? 'cancelled' : execution.executionMode === 'blocked' ? 'execution_blocked' : 'execution_failed';
      events.record(HERMES_EVENTS.FAILED, { reason: execution.error, executionMode: execution.executionMode }, 'failed');
      finishWorkflowRun(runId, { status: execution.executionMode === 'cancelled' ? 'cancelled' : 'failed', outcome, provider: execution.provider, agent: routing.agent, costCents: execution.usage.costCents });
      return done(runId, execution.executionMode === 'cancelled' ? 'cancelled' : 'failed', outcome, { executionMode: execution.executionMode, classification, routing, execution });
    }

    // Budget ceiling: actual cost vs the smaller of the task budget and the provider's cost cap.
    const providerCap = providerRegistry.get(execution.provider)?.usageLimits?.maxCostCents ?? normalized.budgetCents;
    const ceiling = Math.min(normalized.budgetCents, providerCap);
    if (!withinBudget(execution.usage.costCents, ceiling)) {
      events.record(HERMES_EVENTS.FAILED, { reason: 'budget exhausted', costCents: execution.usage.costCents, ceilingCents: ceiling }, 'failed');
      finishWorkflowRun(runId, { status: 'failed', outcome: 'budget_exhausted', provider: execution.provider, agent: routing.agent, costCents: execution.usage.costCents });
      return done(runId, 'failed', 'budget_exhausted', { executionMode: execution.executionMode, classification, routing, execution });
    }

    const verification = verifyExecution(execution, { classification });
    insertVerificationResult(runId, normalized.taskId, verification);
    events.record(HERMES_EVENTS.VERIFIED, { passed: verification.passed, detail: verification.detail });

    if (!verification.passed) {
      events.record(HERMES_EVENTS.FAILED, { reason: 'verification failed' }, 'failed');
      finishWorkflowRun(runId, { status: 'failed', outcome: 'verification_failed', provider: execution.provider, agent: routing.agent, costCents: execution.usage.costCents });
      return done(runId, 'failed', 'verification_failed', { executionMode: execution.executionMode, classification, routing, verification, execution });
    }

    // Verified runs create a PENDING memory candidate only.  Approval was atomically reserved
    // before dispatch so it cannot be re-used by a concurrent run.
    const memoryCandidate = extractMemoryCandidate({ runId, normalized, classification, verification, provider: routing.provider, executionMode: execution.executionMode });
    if (memoryCandidate.created) events.record(HERMES_EVENTS.MEMORY_CANDIDATE, { id: memoryCandidate.id, status: 'pending' });

    finishWorkflowRun(runId, { status: 'completed', outcome: 'verified', provider: execution.provider, agent: routing.agent, costCents: execution.usage.costCents });
    events.record(HERMES_EVENTS.COMPLETED, { outcome: 'verified', executionMode: execution.executionMode });
    return done(runId, 'completed', 'verified', { executionMode: execution.executionMode, classification, routing, verification, memoryCandidate, execution });
  } catch (error) {
    events.record(HERMES_EVENTS.FAILED, { reason: String(error?.message || error) }, 'failed');
    finishWorkflowRun(runId, { status: 'failed', outcome: 'error' });
    return done(runId, 'failed', 'error', { executionMode: 'failed' });
  }
}

function done(runId, status, outcome, extra = {}) {
  return { runId, status, outcome, ...extra };
}
