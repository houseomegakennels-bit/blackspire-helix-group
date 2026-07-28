// Hermes mock workflow executor (Milestone 1).
//
// Executes a routed workflow using ONLY the credential-free mock provider from the reviewed
// packages/providers substrate. It hard-refuses any non-mock provider, so even a mis-configured
// routing decision cannot cause real provider execution in M1. It performs no shell execution and
// writes no files — it returns a deterministic, redactable result the verifier can check.
import { executeProviderRequest } from '../providers/providers.js';

/**
 * @typedef {Object} ExecutionResult
 * @property {boolean} ok
 * @property {string} provider
 * @property {string} mode
 * @property {string} summary
 * @property {Array<{path:string,content:string}>} artifacts
 * @property {{inputTokens:number,outputTokens:number,costCents:number}} usage
 * @property {string|null} error
 */

/** @param {import('./route.js').RoutingDecision} routing @param {import('./normalize.js').NormalizedTask} normalized */
export async function executeWorkflow(routing, normalized) {
  if (routing.provider !== 'mock') {
    // Fail closed. Milestone 1 is mock-only by contract; a non-mock provider must never execute.
    return { ok: false, provider: routing.provider, mode: 'refused', summary: '', artifacts: [], usage: zeroUsage(), error: `Milestone 1 refuses non-mock provider execution: ${routing.provider}` };
  }
  const selected = { provider: 'mock', mode: 'mock', model: 'mock-hermes-status-v1' };
  const packet = { taskId: normalized.taskId, request: normalized.objective, idempotencyKey: normalized.idempotencyKey };
  const result = await executeProviderRequest({ selected, packet, workspace: null, deadline: null });
  return {
    ok: Boolean(result.ok),
    provider: result.provider || 'mock',
    mode: result.mode || 'mock',
    summary: result.summary || '',
    artifacts: Array.isArray(result.artifacts) ? result.artifacts : [],
    usage: {
      inputTokens: result.usage?.inputTokens || 0,
      outputTokens: result.usage?.outputTokens || 0,
      costCents: result.usage?.costCents || 0,
    },
    error: result.ok ? null : (result.error || 'mock execution failed'),
  };
}

const zeroUsage = () => ({ inputTokens: 0, outputTokens: 0, costCents: 0 });
