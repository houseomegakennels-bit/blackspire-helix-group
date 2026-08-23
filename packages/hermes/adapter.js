import { mockHermesResponse, validateHermesRequest, validateHermesResponse } from './contract.js';
import { activeModes } from '../providers/providers.js';

// Provider "modes" that mean the provider cannot actually execute anything.
// Production selection treats every one of these as unavailable so a
// misconfigured or profile-disabled provider fails closed instead of being
// dispatched to and failing later inside the task pipeline.
const UNUSABLE_PROVIDER_MODES = new Set([
  'unconfigured',
  'unavailable',
  'manual-handoff',
  'disabled-by-profile',
  'direct-api-unimplemented',
  'api-disabled-pending-cost-accounting',
  'cli-disabled-pending-accounting',
]);
const PRODUCTION_PROVIDER_MODE = {
  codex: 'cli',
};

/**
 * Decide which provider a production Hermes dispatch may use.
 *
 * Authority comes from two server-controlled sources only:
 *   1. BLACKSPIRE_PRODUCTION_PROVIDERS - the server allowlist, in preference order.
 *   2. allowedProviders - derived from the persisted workspace provider policy.
 *
 * The task's own text is never consulted, so a task cannot name or elevate its
 * own provider. Selection is the intersection of both lists, in server order,
 * restricted to providers that are actually available right now.
 */
export function resolveProductionProvider({ env = process.env, allowedProviders = [], availability = activeModes } = {}) {
  if (env.BLACKSPIRE_RUNTIME_MODE !== 'production') throw new Error('production Hermes requires production runtime mode');

  const serverAllowlist = String(env.BLACKSPIRE_PRODUCTION_PROVIDERS || '').split(',').map((entry) => entry.trim()).filter(Boolean);
  if (!serverAllowlist.length) throw new Error('production Hermes requires an explicit server provider allowlist');
  if (serverAllowlist.includes('mock')) throw new Error('production Hermes must not fall back to the mock provider');
  if (serverAllowlist.includes('claudeCode')) throw new Error('Claude Code production execution is disabled pending accounting and authentication review');

  const permitted = serverAllowlist.filter((provider) => allowedProviders.includes(provider));
  if (!permitted.length) throw new Error('no provider is permitted by both the server allowlist and workspace policy');

  const modes = availability() || {};
  const provider = permitted.find((candidate) => {
    if (!modes[candidate] || UNUSABLE_PROVIDER_MODES.has(modes[candidate])) return false;
    const requiredMode = PRODUCTION_PROVIDER_MODE[candidate];
    if (!requiredMode) return false;
    return modes[candidate] === requiredMode;
  });
  if (!provider) throw new Error('no configured production provider is available');

  return { provider, mode: modes[provider], model: env.BLACKSPIRE_PRODUCTION_MODEL || null };
}

// Mirrors the request identity exactly, the same way mockHermesResponse does, so
// the synthesized response still has to clear validateHermesResponse below.
function productionHermesResponse(request, selection) {
  return {
    version: request.version,
    requestId: request.requestId,
    canonicalConversationId: request.canonicalConversationId,
    canonicalTaskId: request.canonicalTaskId,
    actorId: request.actorId,
    workspaceId: request.workspaceId,
    channel: request.channel,
    costCeilingCents: request.costCeilingCents,
    provider: selection.provider,
    model: selection.model,
    status: 'selected',
    summary: `Production Hermes selected the server-allowlisted ${selection.provider} provider (${selection.mode}).`,
  };
}

export async function dispatchHermes(request, { env = process.env, fetchImpl = fetch, allowedProviders = ['mock'], availability = activeModes } = {}) {
  validateHermesRequest(request);
  const mode = env.BLACKSPIRE_HERMES_MODE || 'mock';
  let raw;
  if (mode === 'mock') raw = mockHermesResponse(request);
  else if (mode === 'production') raw = productionHermesResponse(request, resolveProductionProvider({ env, allowedProviders, availability }));
  else if (mode === 'restricted-test') {
    const endpoint = new URL(env.RESTRICTED_HERMES_URL || '');
    if (!['127.0.0.1','localhost','::1'].includes(endpoint.hostname) || endpoint.protocol !== 'http:') throw new Error('restricted Hermes must be credential-free loopback HTTP');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, Date.parse(request.deadline) - Date.now()));
    try {
      const response = await fetchImpl(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request), signal: controller.signal });
      raw = await response.text();
      if (!response.ok) throw new Error(`restricted Hermes failed with HTTP ${response.status}`);
    } finally { clearTimeout(timer); }
  } else throw new Error('Hermes mode is not explicitly allowed');
  return validateHermesResponse(raw, request, { allowedProviders });
}
