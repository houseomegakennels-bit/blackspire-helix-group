// Hermes runtime profile + real-provider gating (Milestone 2).
//
// Single source of truth for "may a real provider run right now, and which ones". Every real
// adapter and the executor consult this so gating is centralized, not scattered. It is fail-closed:
// real execution requires ALL of (development profile) AND (explicit dev flag) AND (provider on the
// dev allowlist), and is refused outright under the production profile even if credentials exist.
//
// Environment inputs (all optional; safe defaults):
//   BLACKSPIRE_RUNTIME_MODE=production        -> production profile (real providers always refused)
//   HERMES_RUNTIME_PROFILE=development|production|test  (explicit override; production is sticky)
//   HERMES_DEV_REAL_PROVIDER=true             -> the explicit development feature flag
//   HERMES_DEV_PROVIDER_ALLOWLIST=anthropic,... -> providers permitted on the dev real path
//   HERMES_DEV_WORKSPACE_ALLOWLIST=/path,...   -> dev checkouts a real run may target
//   system_flags.emergency_stop=active        -> kill switch (handled by the orchestrator)

const csv = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

/**
 * @typedef {Object} RuntimeProfile
 * @property {'development'|'production'|'test'} profile
 * @property {boolean} isProduction
 * @property {boolean} realProviderFlag        the explicit dev feature flag is set
 * @property {string[]} providerAllowlist       providers permitted on the real dev path
 * @property {string[]} workspaceAllowlist      absolute dev checkouts a real run may target
 * @property {boolean} realProviderEnabled      profile===development && flag && allowlist non-empty
 */

/** @returns {RuntimeProfile} */
export function resolveRuntimeProfile(env = process.env) {
  const production = env.BLACKSPIRE_RUNTIME_MODE === 'production'
    || env.HERMES_RUNTIME_PROFILE === 'production'
    || env.BLACKSPIRE_STATE_OWNER === 'vps-production';
  let profile;
  if (production) profile = 'production';
  // An explicit development override wins over an ambient NODE_ENV=test, so the real dev path can be
  // exercised deterministically under the test runner. Production can never be overridden this way.
  else if (env.HERMES_RUNTIME_PROFILE === 'development') profile = 'development';
  else if (env.HERMES_RUNTIME_PROFILE === 'test' || env.NODE_ENV === 'test') profile = 'test';
  else profile = 'development';

  const realProviderFlag = env.HERMES_DEV_REAL_PROVIDER === 'true';
  const providerAllowlist = csv(env.HERMES_DEV_PROVIDER_ALLOWLIST);
  const workspaceAllowlist = csv(env.HERMES_DEV_WORKSPACE_ALLOWLIST);

  // Real execution is ONLY ever enabled in the development profile. Production and test never enable
  // it, regardless of flags or credentials.
  const realProviderEnabled = profile === 'development' && realProviderFlag && providerAllowlist.length > 0;

  return { profile, isProduction: production, realProviderFlag, providerAllowlist, workspaceAllowlist, realProviderEnabled };
}

/**
 * Decide whether a specific real provider may execute, returning a fail-closed reason when not.
 * @returns {{allowed:boolean, reason?:string}}
 */
export function realProviderPermitted(providerId, rp = resolveRuntimeProfile()) {
  if (rp.isProduction) return { allowed: false, reason: 'production profile forbids real provider execution' };
  if (rp.profile !== 'development') return { allowed: false, reason: `real providers run only in the development profile (current: ${rp.profile})` };
  if (!rp.realProviderFlag) return { allowed: false, reason: 'HERMES_DEV_REAL_PROVIDER is not enabled' };
  if (!rp.providerAllowlist.includes(providerId)) return { allowed: false, reason: `provider ${providerId} is not on HERMES_DEV_PROVIDER_ALLOWLIST` };
  return { allowed: true };
}

/** A dev real run may only target a workspace on the explicit allowlist. */
export function workspacePermitted(workspaceRoot, rp = resolveRuntimeProfile()) {
  if (!workspaceRoot) return { allowed: false, reason: 'no workspace root supplied for a real run' };
  if (rp.workspaceAllowlist.length === 0) return { allowed: false, reason: 'HERMES_DEV_WORKSPACE_ALLOWLIST is empty' };
  return rp.workspaceAllowlist.includes(workspaceRoot)
    ? { allowed: true }
    : { allowed: false, reason: 'workspace root is not on HERMES_DEV_WORKSPACE_ALLOWLIST' };
}
