// Hermes capability / provider / agent registries (Milestone 1 — interfaces + mock seed data).
//
// These are the typed lookup surfaces the router queries. In Milestone 1 they are in-memory,
// deterministic, and describe ONLY the credential-free mock executor, so routing can never select a
// real provider. Milestone 3 backs them with the hermes_* registry tables and real adapters; the
// interface shapes here are the contract those tables must satisfy.
//
// The provider registry intentionally wraps the reviewed packages/providers/providers.js substrate
// rather than duplicating provider knowledge: M1 only exposes 'mock', but the shape mirrors what a
// real adapter registration will look like.

/**
 * @typedef {Object} Capability
 * @property {string} id            stable capability id (e.g. 'code.edit')
 * @property {string} description
 * @property {'low'|'medium'|'high'} maxRisk highest task risk this capability may serve
 */

/**
 * @typedef {Object} ProviderDefinition
 * @property {string} id            provider id understood by packages/providers (e.g. 'mock')
 * @property {'mock'|'handoff'|'api'|'cli'} executionMode
 * @property {boolean} credentialFree  true if it needs no secret to run
 * @property {string[]} capabilities   capability ids this provider can serve
 * @property {boolean} enabled         M1: only the mock provider is enabled
 */

/**
 * @typedef {Object} AgentDefinition
 * @property {string} id
 * @property {string} description
 * @property {string} providerId       which provider executes this agent
 * @property {string[]} capabilities
 * @property {'low'|'medium'|'high'} maxRisk
 */

/** @type {Capability[]} */
const CAPABILITIES = Object.freeze([
  { id: 'status.report', description: 'Report status / answer read-only questions', maxRisk: 'low' },
  { id: 'doc.edit', description: 'Propose safe local documentation edits', maxRisk: 'low' },
  { id: 'code.edit', description: 'Propose local code edits (routed to a real adapter in a later milestone)', maxRisk: 'medium' },
]);

/** @type {ProviderDefinition[]} */
const PROVIDERS = Object.freeze([
  { id: 'mock', executionMode: 'mock', credentialFree: true, capabilities: ['status.report', 'doc.edit', 'code.edit'], enabled: true },
  // Declared but DISABLED in M1 — present so the routing interface is shaped for the future without
  // making a real provider selectable. execute.js only ever runs 'mock'.
  { id: 'manual', executionMode: 'handoff', credentialFree: true, capabilities: ['code.edit'], enabled: false },
]);

/** @type {AgentDefinition[]} */
const AGENTS = Object.freeze([
  { id: 'mock-generalist', description: 'Credential-free deterministic mock agent', providerId: 'mock', capabilities: ['status.report', 'doc.edit', 'code.edit'], maxRisk: 'medium' },
]);

export const capabilityRegistry = {
  list: () => CAPABILITIES,
  get: (id) => CAPABILITIES.find((c) => c.id === id) || null,
  has: (id) => CAPABILITIES.some((c) => c.id === id),
};

export const providerRegistry = {
  list: () => PROVIDERS,
  enabled: () => PROVIDERS.filter((p) => p.enabled),
  get: (id) => PROVIDERS.find((p) => p.id === id) || null,
  supports: (id, capability) => {
    const p = PROVIDERS.find((x) => x.id === id);
    return Boolean(p && p.enabled && p.capabilities.includes(capability));
  },
};

export const agentRegistry = {
  list: () => AGENTS,
  get: (id) => AGENTS.find((a) => a.id === id) || null,
  // An agent may serve any task whose risk is at or below the agent's maxRisk. So a maxRisk=medium
  // agent serves low and medium tasks, but not high. taskRisk defaults to 'low' (least restrictive).
  forCapability: (capability, taskRisk = 'low') => {
    const order = { low: 0, medium: 1, high: 2 };
    return AGENTS.filter((a) => a.capabilities.includes(capability) && order[a.maxRisk] >= order[taskRisk]);
  },
};
