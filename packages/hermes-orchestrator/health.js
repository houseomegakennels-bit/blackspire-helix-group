// Hermes provider health + cooldown (Milestone 2).
//
// Tracks per-provider health from real invocation outcomes and enforces a cooldown after repeated
// failures. Health is advisory for reporting and for refusing a real provider that is in cooldown;
// it NEVER causes a silent fallback to mock — a requested real provider in cooldown is reported as
// blocked/failed, not quietly swapped (see execute.js / orchestrator.js).
import { now } from '../shared/util.js';
import { getProviderHealth, upsertProviderHealth } from './store.js';

const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 60_000;

/** Current health record (or a synthesized 'unknown' default). */
export function currentHealth(provider) {
  const row = getProviderHealth(provider);
  if (!row) return { provider, status: 'unknown', failureCount: 0, disabled: false, cooldownUntil: null, lastSuccessAt: null, lastFailureAt: null };
  return {
    provider, status: row.status, failureCount: row.failure_count || 0, disabled: Boolean(row.disabled),
    cooldownUntil: row.cooldown_until, lastSuccessAt: row.last_success_at, lastFailureAt: row.last_failure_at,
  };
}

/** True when the provider is in an active cooldown window. */
export function inCooldown(provider, at = Date.now()) {
  const h = currentHealth(provider);
  return Boolean(h.cooldownUntil && Date.parse(h.cooldownUntil) > at);
}

export function recordSuccess(provider) {
  upsertProviderHealth(provider, { status: 'healthy', lastSuccessAt: now(), lastFailureAt: currentHealth(provider).lastFailureAt, failureCount: 0, cooldownUntil: null, disabled: false });
}

export function recordFailure(provider) {
  const h = currentHealth(provider);
  const failureCount = (h.failureCount || 0) + 1;
  const tripped = failureCount >= FAILURE_THRESHOLD;
  upsertProviderHealth(provider, {
    status: tripped ? 'cooldown' : 'degraded',
    lastSuccessAt: h.lastSuccessAt,
    lastFailureAt: now(),
    failureCount,
    cooldownUntil: tripped ? new Date(Date.now() + COOLDOWN_MS).toISOString() : h.cooldownUntil,
    disabled: false,
  });
}
