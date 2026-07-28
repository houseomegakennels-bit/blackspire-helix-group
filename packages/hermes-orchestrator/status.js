// Hermes runtime status surface (Milestone 2).
//
// Builds the read-only status object the API/PWA render. It exposes ONLY safe metadata: profile,
// registered providers and their enabled/health/capability state, whether authentication is
// *configured* (a boolean — never the value), recent development runs, and the kill-switch state.
// It never returns credentials, raw prompts, unredacted provider output, or internal reasoning.
import { getFlag } from '../task-engine/tasks.js';
import { providerRegistry, capabilityRegistry } from './registries.js';
import { resolveRuntimeProfile } from './runtime-profile.js';
import { currentHealth } from './health.js';
import { recentProviderInvocations, recentOutcomeEvaluations, getOutcomeComponents } from './store.js';
import { all } from '../task-engine/db.js';
import { redactString } from './redaction.js';

export function buildRuntimeStatus(env = process.env) {
  const rp = resolveRuntimeProfile(env);
  const killSwitch = getFlag('emergency_stop') === 'active';

  const providers = providerRegistry.list().map((p) => ({
    id: p.id,
    displayName: p.displayName,
    adapterType: p.adapterType,
    enabled: p.enabled,
    allowedEnvironments: p.allowedEnvironments,
    capabilities: p.supportedCapabilities,
    productionEligible: p.productionEligible,
    // Boolean only — the credential value is NEVER read into this surface.
    authentication: p.authentication === 'not_required'
      ? 'not_required'
      : (p.authEnvVar && env[p.authEnvVar] ? 'configured' : 'not_configured'),
    health: healthView(currentHealth(p.id)),
  }));

  const recentRuns = safeRows(all('SELECT id, task_id, workspace_id, actor_id, channel, status, outcome, provider, agent, cost_cents, created_at FROM hermes_workflow_runs ORDER BY created_at DESC LIMIT 10'))
    .map((r) => ({
      id: r.id, taskId: r.task_id, workspaceId: r.workspace_id, actorId: r.actor_id, channel: r.channel,
      status: r.status, outcome: r.outcome, provider: r.provider, agent: r.agent, costCents: r.cost_cents, createdAt: r.created_at,
    }));

  const recentInvocations = recentProviderInvocations(10).map((i) => ({
    provider: i.provider, adapterType: i.adapter_type, model: i.model, mode: i.mode, status: i.status,
    attempt: i.attempt, durationMs: i.duration_ms, timedOut: Boolean(i.timed_out), cancelled: Boolean(i.cancelled),
    usage: { inputTokens: i.input_tokens, outputTokens: i.output_tokens, costCents: i.cost_cents },
    // A redacted, already-redacted-at-write error string only.
    error: i.error ? redactString(i.error) : null,
  }));
  const recentEvaluations = recentOutcomeEvaluations(10).map((e) => ({
    id: e.id, workspaceId: e.workspace_id, taskId: e.task_id, runId: e.run_id,
    executionMode: e.execution_mode, provider: e.provider_id, terminalStatus: e.terminal_status,
    verificationStatus: e.verification_status, learningEligibility: e.learning_eligibility,
    retryCount: e.retry_count, durationMs: e.duration_ms, costCents: e.cost_cents,
    timedOut: Boolean(e.timed_out), cancelled: Boolean(e.cancelled), evaluatorVersion: e.evaluator_version,
    provenanceDigest: e.provenance_digest, components: getOutcomeComponents(e.id).map((c) => ({ name: c.name, value: c.value, status: c.status })),
  }));

  return {
    runtime: { profile: rp.profile, realProviderEnabled: rp.realProviderEnabled, providerAllowlist: rp.providerAllowlist, killSwitch },
    executionModeDefault: 'mock',
    providers,
    capabilities: capabilityRegistry.list().map((c) => ({ id: c.id, description: c.description, riskLevel: c.riskLevel, verificationRequired: c.verificationRequired, environmentRestrictions: c.environmentRestrictions })),
    recentRuns,
    recentInvocations,
    recentEvaluations,
  };
}

function healthView(h) {
  return { status: h.status, failureCount: h.failureCount, disabled: h.disabled, cooldownUntil: h.cooldownUntil, lastSuccessAt: h.lastSuccessAt, lastFailureAt: h.lastFailureAt };
}
function safeRows(rows) { return Array.isArray(rows) ? rows : []; }
