// Hermes router (Milestone 1 — mock routing only).
//
// Given a Classification, selects a provider + agent from the registries. In Milestone 1 the ONLY
// selectable provider is the credential-free mock; real providers are declared-but-disabled in the
// registry, so routing physically cannot pick one. Milestone 3 replaces the tie-break with verified
// scorecard scoring; the RoutingDecision output contract stays the same.
import { capabilityRegistry, providerRegistry, agentRegistry } from './registries.js';

// Providers eligible to serve every required capability in the given environment. `preferredProvider`
// (an explicitly requested real provider) is honored only if it supports the capabilities; otherwise
// routing fails closed — it never silently substitutes a different provider.
function selectProviderId({ capabilities, environment, preferredProvider }) {
  if (preferredProvider) {
    const ok = capabilities.every((cap) => providerRegistry.supports(preferredProvider, cap));
    if (!ok) throw new Error(`requested provider ${preferredProvider} cannot serve capabilities [${capabilities.join(', ')}]`);
    return preferredProvider;
  }
  // Default: the first globally-enabled provider (mock) that serves all capabilities.
  for (const cap of capabilities) {
    const eligible = providerRegistry.eligible(cap, environment);
    if (eligible.length === 0) return null;
  }
  return 'mock';
}

/**
 * @typedef {Object} RoutingDecision
 * @property {string} provider
 * @property {string} agent
 * @property {string[]} capabilities   capabilities that will be exercised
 * @property {Array<{provider:string,agent:string}>} candidates
 * @property {string} rationale
 * @property {Classification} classification
 */

/**
 * @param {import('./classify.js').Classification} classification
 * @param {Object} [opts] { environment='development', preferredProvider=null }
 * @returns {RoutingDecision}
 */
export function routeTask(classification, opts = {}) {
  const environment = opts.environment || 'development';
  const capabilities = (classification?.requiredCapabilities || []).filter((c) => capabilityRegistry.has(c));
  if (capabilities.length === 0) throw new Error('routeTask: no known required capabilities');

  const maxRisk = classification.risk || 'low';
  const providerId = selectProviderId({ capabilities, environment, preferredProvider: opts.preferredProvider || null });
  if (!providerId) throw new Error(`routeTask: no provider can serve capabilities [${capabilities.join(', ')}] in ${environment}`);

  const agents = [];
  for (const capability of capabilities) {
    for (const agent of agentRegistry.forCapability(capability, maxRisk)) {
      if (agent.providerId === providerId && providerRegistry.supports(providerId, capability)) agents.push(agent.id);
    }
  }
  const agent = agents[0];
  if (!agent) throw new Error(`routeTask: no agent for provider ${providerId} at risk ${maxRisk}`);

  const candidates = providerRegistry.eligible(capabilities[0], environment, { includeDisabled: true })
    .filter((p) => capabilities.every((c) => providerRegistry.supports(p.id, c)))
    .map((p) => ({ provider: p.id, enabled: p.enabled }));

  return {
    provider: providerId,
    agent,
    capabilities,
    candidates,
    rationale: `Routed ${providerId}/${agent} for capabilities [${capabilities.join(', ')}] at risk ${maxRisk} in ${environment}${opts.preferredProvider ? ' (explicit provider request)' : ' (default mock)'}.`,
    classification,
  };
}
