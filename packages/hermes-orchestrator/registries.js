// Hermes capability / provider / agent registries (Milestone 2 — typed registries).
//
// The typed lookup surfaces Hermes resolves capabilities and providers through. Provider selection
// is NOT hardcoded elsewhere: the router asks these registries which provider/agent can serve a
// capability, and the executor asks the provider registry for the adapter. The mock provider is the
// only ENABLED provider; the Anthropic (non-agentic Claude) provider is declared but DISABLED by
// default and only usable in the development profile behind explicit flags/allowlists
// (see runtime-profile.js). No provider is production-eligible in this milestone.

/**
 * @typedef {Object} CapabilityDefinition
 * @property {string} id
 * @property {string} description
 * @property {'low'|'medium'|'high'} riskLevel
 * @property {string[]} requiredPermissions
 * @property {string[]} providerCompatibility   provider ids that may serve this capability
 * @property {string[]} toolRequirements
 * @property {Array<'development'|'test'|'production'>} environmentRestrictions  environments where allowed
 * @property {boolean} verificationRequired
 */

/**
 * @typedef {Object} ProviderDefinition
 * @property {string} id
 * @property {string} displayName
 * @property {'mock'|'api'|'cli'|'fake'} adapterType
 * @property {boolean} enabled                    globally enabled (mock only in M2)
 * @property {Array<'development'|'test'|'production'>} allowedEnvironments
 * @property {string[]} supportedCapabilities
 * @property {string[]} modelIdentifiers
 * @property {'unknown'|'healthy'|'degraded'|'cooldown'|'disabled'} defaultHealth
 * @property {'not_required'|'env'} authentication   how credentials are supplied
 * @property {string|null} authEnvVar                env var holding the credential (never a value)
 * @property {number} concurrencyLimit
 * @property {number} timeoutMs
 * @property {{maxRetries:number}} retryPolicy
 * @property {{maxInputBytes:number, maxOutputBytes:number, maxCostCents:number}} usageLimits
 * @property {{unit:string, note:string}} costMetadata
 * @property {boolean} productionEligible
 */

/** @type {CapabilityDefinition[]} */
const CAPABILITIES = Object.freeze([
  { id: 'status.report', description: 'Report status / answer read-only questions', riskLevel: 'low', requiredPermissions: ['read'], providerCompatibility: ['mock', 'anthropic', 'fake'], toolRequirements: [], environmentRestrictions: ['development', 'test', 'production'], verificationRequired: true },
  { id: 'doc.edit', description: 'Propose safe local documentation edits', riskLevel: 'low', requiredPermissions: ['read'], providerCompatibility: ['mock', 'anthropic', 'fake'], toolRequirements: [], environmentRestrictions: ['development', 'test'], verificationRequired: true },
  { id: 'code.edit', description: 'Propose local code edits (a real adapter proposes text only; no execution)', riskLevel: 'medium', requiredPermissions: ['read'], providerCompatibility: ['mock', 'anthropic', 'fake'], toolRequirements: [], environmentRestrictions: ['development', 'test'], verificationRequired: true },
]);

/** @type {ProviderDefinition[]} */
const PROVIDERS = Object.freeze([
  {
    id: 'mock', displayName: 'Deterministic Mock', adapterType: 'mock', enabled: true,
    allowedEnvironments: ['development', 'test', 'production'], supportedCapabilities: ['status.report', 'doc.edit', 'code.edit'],
    modelIdentifiers: ['mock-hermes-status-v1'], defaultHealth: 'healthy', authentication: 'not_required', authEnvVar: null,
    concurrencyLimit: 8, timeoutMs: 5000, retryPolicy: { maxRetries: 1 },
    usageLimits: { maxInputBytes: 16_384, maxOutputBytes: 65_536, maxCostCents: 0 }, costMetadata: { unit: 'none', note: 'free deterministic mock' }, productionEligible: false,
  },
  {
    // Non-agentic Claude via the Anthropic Messages API. Pure text-in/JSON-out: no shell, no file
    // access, no agentic tools. DISABLED by default and dev-only; refused under the production
    // profile even if credentials exist (see runtime-profile.js and adapters/anthropic-dev.js).
    id: 'anthropic', displayName: 'Claude (Anthropic Messages API, non-agentic)', adapterType: 'api', enabled: false,
    allowedEnvironments: ['development'], supportedCapabilities: ['status.report', 'doc.edit', 'code.edit'],
    modelIdentifiers: ['claude-sonnet-4-5'], defaultHealth: 'unknown', authentication: 'env', authEnvVar: 'ANTHROPIC_API_KEY',
    concurrencyLimit: 2, timeoutMs: 30_000, retryPolicy: { maxRetries: 1 },
    usageLimits: { maxInputBytes: 12_000, maxOutputBytes: 24_000, maxCostCents: 25 }, costMetadata: { unit: 'tokens', note: 'provider reports tokens; cost derived if pricing configured, else unavailable' }, productionEligible: false,
  },
  {
    // In-repo deterministic fake used ONLY by the automated test suite via dependency injection.
    // Not selectable at runtime (allowedEnvironments excludes real profiles unless explicitly wired
    // in a test), so no paid call is ever required by the normal suite.
    id: 'fake', displayName: 'Deterministic Fake Provider (tests only)', adapterType: 'fake', enabled: false,
    allowedEnvironments: ['test'], supportedCapabilities: ['status.report', 'doc.edit', 'code.edit'],
    modelIdentifiers: ['fake-v1'], defaultHealth: 'unknown', authentication: 'not_required', authEnvVar: null,
    concurrencyLimit: 4, timeoutMs: 5000, retryPolicy: { maxRetries: 1 },
    usageLimits: { maxInputBytes: 12_000, maxOutputBytes: 24_000, maxCostCents: 0 }, costMetadata: { unit: 'none', note: 'test fixture' }, productionEligible: false,
  },
]);

/**
 * @typedef {Object} AgentDefinition
 * @property {string} id @property {string} description @property {string} providerId
 * @property {string[]} capabilities @property {'low'|'medium'|'high'} maxRisk
 */
/** @type {AgentDefinition[]} */
const AGENTS = Object.freeze([
  { id: 'mock-generalist', description: 'Credential-free deterministic mock agent', providerId: 'mock', capabilities: ['status.report', 'doc.edit', 'code.edit'], maxRisk: 'medium' },
  { id: 'claude-dev', description: 'Non-agentic Claude proposer (development-only, disabled by default)', providerId: 'anthropic', capabilities: ['status.report', 'doc.edit', 'code.edit'], maxRisk: 'medium' },
]);

const RISK_ORDER = { low: 0, medium: 1, high: 2 };

export const capabilityRegistry = {
  list: () => CAPABILITIES,
  get: (id) => CAPABILITIES.find((c) => c.id === id) || null,
  has: (id) => CAPABILITIES.some((c) => c.id === id),
  allowedInEnvironment: (id, env) => {
    const c = CAPABILITIES.find((x) => x.id === id);
    return Boolean(c && c.environmentRestrictions.includes(env));
  },
};

export const providerRegistry = {
  list: () => PROVIDERS,
  get: (id) => PROVIDERS.find((p) => p.id === id) || null,
  // Providers eligible to serve a capability in a given environment. `enabledOnly` returns only the
  // globally-enabled providers (mock) — the executor separately applies the dev real-provider gate.
  eligible: (capability, environment, { includeDisabled = false } = {}) =>
    PROVIDERS.filter((p) =>
      (includeDisabled || p.enabled)
      && p.allowedEnvironments.includes(environment)
      && p.supportedCapabilities.includes(capability)),
  supports: (id, capability) => {
    const p = PROVIDERS.find((x) => x.id === id);
    return Boolean(p && p.supportedCapabilities.includes(capability));
  },
};

export const agentRegistry = {
  list: () => AGENTS,
  get: (id) => AGENTS.find((a) => a.id === id) || null,
  // An agent may serve any task whose risk is at or below the agent's maxRisk.
  forCapability: (capability, taskRisk = 'low') =>
    AGENTS.filter((a) => a.capabilities.includes(capability) && RISK_ORDER[a.maxRisk] >= RISK_ORDER[taskRisk]),
  forProvider: (providerId) => AGENTS.filter((a) => a.providerId === providerId),
};

/** Validate a provider definition shape (used by tests and defensive checks). */
export function validateProviderDefinition(p) {
  const required = ['id', 'displayName', 'adapterType', 'enabled', 'allowedEnvironments', 'supportedCapabilities', 'concurrencyLimit', 'timeoutMs', 'retryPolicy', 'usageLimits', 'productionEligible'];
  for (const k of required) if (!(k in p)) throw new Error(`ProviderDefinition missing ${k}`);
  if (p.productionEligible) throw new Error(`no provider may be production-eligible in Milestone 2 (${p.id})`);
  if (p.allowedEnvironments.includes('production') && p.adapterType !== 'mock') throw new Error(`only the mock provider may be allowed in production (${p.id})`);
  return true;
}
