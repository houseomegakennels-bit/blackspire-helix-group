const SHA = /^[0-9a-f]{40}$/;
const ALLOWED_ENVIRONMENTS = new Set(['staging', 'disposable-staging']);

function reason(code, severity, detail) {
  return { code, severity, detail };
}

export function verifyPostDeploy(input, nowMs = Date.now()) {
  if (!input || typeof input !== 'object') throw new Error('verification input must be an object');
  const expected = input.expected || {};
  const observed = input.observed || {};
  const startedMs = Date.parse(input.startedAt || '');
  const graceSeconds = Number(input.startupGraceSeconds);
  const windowSeconds = Number(input.verificationWindowSeconds);
  const observedMs = Date.parse(input.observedAt || '');
  if (!Number.isFinite(startedMs)) throw new Error('startedAt must be an ISO timestamp');
  if (!Number.isInteger(graceSeconds) || graceSeconds < 0 || graceSeconds > 300) throw new Error('startupGraceSeconds must be an integer from 0 to 300');
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 900) throw new Error('verificationWindowSeconds must be an integer from 1 to 900');
  if (nowMs < startedMs) throw new Error('verification clock precedes deployment start');
  if (!Number.isFinite(observedMs)) throw new Error('observedAt must be an ISO timestamp');
  const elapsedSeconds = Math.floor((nowMs - startedMs) / 1000);
  const withinGrace = elapsedSeconds < graceSeconds;
  const windowExpired = elapsedSeconds > windowSeconds;
  const reasons = [];

  if (observedMs < startedMs) reasons.push(reason('observation_precedes_deployment', 'intervention', 'observation predates this deployment'));
  if (observedMs > nowMs + 5_000) reasons.push(reason('observation_clock_skew', 'intervention', 'observation timestamp is in the future'));
  if (nowMs - observedMs > windowSeconds * 1_000) reasons.push(reason('observation_stale', 'rollback', 'observation is older than the verification window'));

  if (!ALLOWED_ENVIRONMENTS.has(expected.environment) || observed.environment !== expected.environment) reasons.push(reason('environment_identity_mismatch', 'intervention', 'deployed environment identity is absent, unknown, or unexpected'));
  if (!SHA.test(expected.commit || '') || observed.commit !== expected.commit) reasons.push(reason('commit_fingerprint_mismatch', 'intervention', 'deployed commit does not match the approved commit'));
  if (!expected.buildFingerprint || observed.buildFingerprint !== expected.buildFingerprint) reasons.push(reason('build_fingerprint_mismatch', 'intervention', 'deployed build fingerprint does not match the approved build'));
  if (!expected.migrationVersion || observed.migrationVersion !== expected.migrationVersion) reasons.push(reason('migration_version_mismatch', 'intervention', 'migration version does not match the approved version'));
  if (observed.providersDisabled !== true) reasons.push(reason('providers_not_disabled', 'intervention', 'external providers are not proven disabled'));
  if (!['disabled', 'sandbox', 'dry-run'].includes(observed.telegramMode)) reasons.push(reason('telegram_not_sandboxed', 'intervention', 'Telegram is not proven disabled or sandboxed'));

  const unhealthy = (code, value, detail) => {
    if (value === true) return;
    reasons.push(reason(code, withinGrace && !windowExpired ? 'observe' : 'rollback', detail));
  };
  unhealthy('liveness_failed', observed.liveness, 'liveness check did not pass');
  unhealthy('readiness_failed', observed.readiness, 'readiness check did not pass');
  unhealthy('database_unavailable', observed.databaseConnected, 'database connectivity check did not pass');
  unhealthy('queue_unavailable', observed.queueConnected, 'queue connectivity check did not pass');
  unhealthy('worker_heartbeat_stale', observed.workerHeartbeatFresh, 'worker heartbeat is absent or stale');
  if (observed.health === 'degraded') reasons.push(reason('degraded_health', withinGrace && !windowExpired ? 'observe' : 'rollback', 'service reports degraded health'));
  else if (observed.health !== 'healthy') reasons.push(reason('unknown_health', withinGrace && !windowExpired ? 'observe' : 'rollback', 'service health is absent or unhealthy'));

  let classification = 'proceed';
  if (reasons.some((item) => item.severity === 'intervention')) classification = 'operator intervention required';
  else if (reasons.some((item) => item.severity === 'rollback')) classification = 'rollback recommended';
  else if (reasons.length || withinGrace) classification = 'observe';

  const summary = classification === 'proceed'
    ? `STAGING VERIFIED · ${expected.commit.slice(0, 8)} · healthy`
    : `${classification.toUpperCase()} · ${reasons.map((item) => item.code).join(', ') || 'startup grace active'}`;
  return {
    schemaVersion: 1,
    kind: 'blackspire-post-deploy-verification',
    readOnly: true,
    automaticActionTaken: false,
    classification,
    elapsedSeconds,
    withinGrace,
    windowExpired,
    environment: observed.environment || null,
    expected: { environment: expected.environment || null, commit: expected.commit || null, buildFingerprint: expected.buildFingerprint || null, migrationVersion: expected.migrationVersion || null },
    startedAt: new Date(startedMs).toISOString(),
    observedAt: new Date(observedMs).toISOString(),
    evaluatedAt: new Date(nowMs).toISOString(),
    startupGraceSeconds: graceSeconds,
    verificationWindowSeconds: windowSeconds,
    observed: {
      environment: observed.environment || null,
      commit: observed.commit || null,
      buildFingerprint: observed.buildFingerprint || null,
      migrationVersion: observed.migrationVersion || null,
      health: observed.health || null,
      liveness: observed.liveness === true,
      readiness: observed.readiness === true,
      databaseConnected: observed.databaseConnected === true,
      queueConnected: observed.queueConnected === true,
      workerHeartbeatFresh: observed.workerHeartbeatFresh === true,
      telegramMode: observed.telegramMode || null,
      providersDisabled: observed.providersDisabled === true,
    },
    reasons,
    mobileSummary: summary,
  };
}

export function recomputePostDeployAudit(audit, nowMs = Date.now()) {
  if (!audit || audit.kind !== 'blackspire-post-deploy-verification') throw new Error('unsupported post-deploy audit');
  return verifyPostDeploy({
    startedAt: audit.startedAt,
    observedAt: audit.observedAt,
    startupGraceSeconds: audit.startupGraceSeconds,
    verificationWindowSeconds: audit.verificationWindowSeconds,
    expected: audit.expected,
    observed: audit.observed,
  }, nowMs);
}
