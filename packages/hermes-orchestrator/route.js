// Hermes router (Milestone 1 — mock routing only).
//
// Given a Classification, selects a provider + agent from the registries. In Milestone 1 the ONLY
// selectable provider is the credential-free mock; real providers are declared-but-disabled in the
// registry, so routing physically cannot pick one. Milestone 3 replaces the tie-break with verified
// scorecard scoring; the RoutingDecision output contract stays the same.
import { capabilityRegistry, providerRegistry, agentRegistry } from './registries.js';

/**
 * @typedef {Object} RoutingDecision
 * @property {string} provider
 * @property {string} agent
 * @property {string[]} capabilities   capabilities that will be exercised
 * @property {Array<{provider:string,agent:string}>} candidates
 * @property {string} rationale
 * @property {Classification} classification
 */

/** @returns {RoutingDecision} */
export function routeTask(classification) {
  const capabilities = (classification?.requiredCapabilities || []).filter((c) => capabilityRegistry.has(c));
  if (capabilities.length === 0) throw new Error('routeTask: no known required capabilities');

  const maxRisk = classification.risk || 'low';
  const candidates = [];
  for (const capability of capabilities) {
    for (const agent of agentRegistry.forCapability(capability, maxRisk)) {
      if (providerRegistry.supports(agent.providerId, capability)) {
        candidates.push({ provider: agent.providerId, agent: agent.id });
      }
    }
  }
  // Deduplicate candidate (provider,agent) pairs, preserving order.
  const seen = new Set();
  const unique = candidates.filter((c) => {
    const key = `${c.provider}:${c.agent}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length === 0) {
    throw new Error(`routeTask: no enabled provider/agent can serve capabilities [${capabilities.join(', ')}] at risk ${maxRisk}`);
  }

  // M1 tie-break: first eligible candidate. All eligible candidates are the mock provider by
  // construction, so this is deterministic and credential-free.
  const chosen = unique[0];
  return {
    provider: chosen.provider,
    agent: chosen.agent,
    capabilities,
    candidates: unique,
    rationale: `Milestone 1 mock routing: selected ${chosen.provider}/${chosen.agent} for capabilities [${capabilities.join(', ')}] at risk ${maxRisk}. Real providers are registry-disabled in M1.`,
    classification,
  };
}
