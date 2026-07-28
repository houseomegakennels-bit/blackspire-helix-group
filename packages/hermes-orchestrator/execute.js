// Hermes execution (Milestone 2).
//
// Executes a routed workflow through the resolved provider adapter. The mock provider is the
// DEFAULT; a real provider runs ONLY when the routing explicitly selected one AND the runtime gate,
// cooldown, and concurrency limit all permit it. There is NO silent fallback from a requested real
// execution to mock: if a real provider is requested and cannot run, the result is 'blocked' or
// 'failed', never a quiet mock swap. Timeout, cancellation, retry ceiling, size limits, and
// redaction are all enforced; no adapter performs shell/filesystem work.
import { providerRegistry } from './registries.js';
import { resolveAdapter } from './adapters/index.js';
import { resolveRuntimeProfile, realProviderPermitted } from './runtime-profile.js';
import { inCooldown, recordSuccess, recordFailure } from './health.js';
import { acquire } from './concurrency.js';
import { insertProviderInvocation } from './store.js';
import { getFlag } from '../task-engine/tasks.js';

/**
 * @typedef {Object} ExecutionResult
 * @property {'real'|'mock'|'blocked'|'cancelled'|'failed'} executionMode
 * @property {boolean} ok
 * @property {string} provider @property {string} adapterType @property {string|null} model
 * @property {string} summary @property {Array} artifacts
 * @property {{inputTokens:number|null,outputTokens:number|null,costCents:number|null}} usage
 * @property {number} attempts @property {number} durationMs
 * @property {boolean} timedOut @property {boolean} cancelled
 * @property {string|null} error
 */

/**
 * @param {import('./route.js').RoutingDecision} routing
 * @param {import('./normalize.js').NormalizedTask} normalized
 * @param {Object} [ctx] { runId, taskId, adapterOverrides, deps, signal, deadlineMs, env }
 * @returns {Promise<ExecutionResult>}
 */
export async function executeWorkflow(routing, normalized, ctx = {}) {
  const providerId = routing.provider;
  const def = providerRegistry.get(providerId);
  if (!def) return blocked(providerId, 'unknown', 'unknown_provider', `no provider definition for ${providerId}`);

  const isReal = def.adapterType !== 'mock';
  const rp = resolveRuntimeProfile(ctx.env);

  // The Hermes runtime is a development orchestrator. Under the production profile it refuses ALL
  // provider execution — mock and real alike — so it can never execute in production even if a
  // credential is present. This preserves the Milestone 1 guarantee (defense in depth).
  if (rp.isProduction) {
    return blocked(providerId, def.adapterType, 'production_refused', 'production profile refuses Hermes runtime provider execution (mock and real)');
  }
  // Fail-closed gates for a REAL provider. Never fall back to mock on refusal.
  if (isReal) {
    const gate = realProviderPermitted(providerId, rp);
    if (!gate.allowed) return blocked(providerId, def.adapterType, 'provider_disabled', gate.reason);
    if (inCooldown(providerId)) return blocked(providerId, def.adapterType, 'cooldown', `${providerId} is in cooldown after repeated failures`);
  }

  const adapter = resolveAdapter(providerId, { overrides: ctx.adapterOverrides, deps: ctx.deps });
  if (!adapter) return blocked(providerId, def.adapterType, 'no_adapter', `no adapter for ${providerId}`);

  const slot = acquire(providerId, def.concurrencyLimit);
  if (!slot) return blocked(providerId, def.adapterType, 'concurrency_limit', `concurrency limit (${def.concurrencyLimit}) reached for ${providerId}`);

  const limits = def.usageLimits;
  const timeoutMs = Math.max(1, Math.min(def.timeoutMs, ctx.deadlineMs || def.timeoutMs));
  const maxAttempts = 1 + Math.max(0, def.retryPolicy?.maxRetries || 0);
  let last = null;
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      // Recheck immediately before every dispatch/retry. A stop raised while a prior attempt was
      // pending must prevent a subsequent (possibly paid) call.
      if (getFlag('emergency_stop') === 'active') return blocked(providerId, def.adapterType, 'emergency_stop', 'emergency stop active before provider dispatch');
      if (ctx.signal?.aborted) { last = cancelledResult(providerId, def, attempt); recordInvocation(ctx, providerId, def, last); break; }
      const controller = new AbortController();
      const onParentAbort = () => controller.abort();
      ctx.signal?.addEventListener?.('abort', onParentAbort, { once: true });
      let deadlineElapsed = false;
      const timer = setTimeout(() => { deadlineElapsed = true; controller.abort(); }, timeoutMs);
      const started = Date.now();
      let result;
      try {
        result = await adapter.execute({ objective: normalized.objective, model: def.modelIdentifiers[0], limits, signal: controller.signal });
      } catch (error) {
        result = { ok: false, provider: providerId, adapterType: def.adapterType, model: def.modelIdentifiers[0], mode: isReal ? 'real' : 'mock', summary: '', artifacts: [], usage: { inputTokens: null, outputTokens: null, costCents: null }, inputBytes: 0, outputBytes: 0, timedOut: false, cancelled: controller.signal.aborted, error: String(error?.message || error) };
      } finally {
        clearTimeout(timer);
        ctx.signal?.removeEventListener?.('abort', onParentAbort);
      }
      // Adapters see only an AbortSignal.  Attribute a local deadline abort to timeout rather than
      // caller cancellation so it is auditable and eligible for the bounded retry policy.
      if (deadlineElapsed && result?.cancelled) result = { ...result, timedOut: true, cancelled: false, error: 'provider timed out' };
      const durationMs = Date.now() - started;
      last = { ...result, attempts: attempt, durationMs };
      recordInvocation(ctx, providerId, def, last);
      if (isReal) { result.ok ? recordSuccess(providerId) : recordFailure(providerId); }
      if (result.ok || result.cancelled) break; // never retry a caller cancellation; stop on success
    }
  } finally {
    slot.release();
  }

  const executionMode = last.cancelled ? 'cancelled' : last.ok ? (last.mode === 'mock' ? 'mock' : 'real') : 'failed';
  return {
    executionMode, ok: Boolean(last.ok), provider: providerId, adapterType: def.adapterType, model: last.model || def.modelIdentifiers[0],
    summary: last.summary || '', artifacts: Array.isArray(last.artifacts) ? last.artifacts : [],
    usage: last.usage || { inputTokens: null, outputTokens: null, costCents: null },
    attempts: last.attempts || 1, durationMs: last.durationMs || 0, timedOut: Boolean(last.timedOut), cancelled: Boolean(last.cancelled), error: last.error || null,
  };
}

function blocked(provider, adapterType, code, reason) {
  return { executionMode: 'blocked', ok: false, provider, adapterType, model: null, summary: '', artifacts: [], usage: { inputTokens: null, outputTokens: null, costCents: null }, attempts: 0, durationMs: 0, timedOut: false, cancelled: false, error: reason, blockCode: code };
}
function cancelledResult(provider, def, attempt) {
  return { ok: false, provider, adapterType: def.adapterType, model: def.modelIdentifiers[0], mode: def.adapterType === 'mock' ? 'mock' : 'real', summary: '', artifacts: [], usage: { inputTokens: null, outputTokens: null, costCents: null }, inputBytes: 0, outputBytes: 0, timedOut: false, cancelled: true, error: 'cancelled', attempts: attempt, durationMs: 0 };
}
function recordInvocation(ctx, providerId, def, r) {
  if (!ctx.runId) return;
  insertProviderInvocation(ctx.runId, ctx.taskId, {
    provider: providerId, adapterType: def.adapterType, model: r.model, mode: r.mode,
    status: r.ok ? 'completed' : r.timedOut ? 'timeout' : r.cancelled ? 'cancelled' : 'failed',
    attempt: r.attempts, inputBytes: r.inputBytes, outputBytes: r.outputBytes,
    inputTokens: r.usage?.inputTokens, outputTokens: r.usage?.outputTokens, costCents: r.usage?.costCents,
    durationMs: r.durationMs, timedOut: r.timedOut, cancelled: r.cancelled, error: r.error,
  });
}

/**
 * Budget predicate: a run stays within budget when the actual cost does not exceed the ceiling.
 * A null cost (provider did not report one) is treated as within budget — no invented numbers.
 */
export function withinBudget(costCents, ceilingCents) {
  if (costCents === null || costCents === undefined) return true;
  const cost = Number(costCents) || 0;
  const ceiling = Number(ceilingCents) || 0;
  return cost <= ceiling;
}
