const SHA = /^[0-9a-f]{40}$/;
const ALLOWED_ENVIRONMENTS = new Set(['staging', 'disposable-staging']);
const DIGEST = /^[0-9a-f]{64}$/;

function reason(code, severity, detail) {
  return { code, severity, detail };
}

export function verifyPostDeploy(input, nowMs = Date.now()) {
  if (!input || typeof input !== 'object') throw new Error('verification input must be an object');
  const expected = input.expected || {};
  const observed = input.observed || {};
  const identity = observed.deploymentIdentity || {};
  const startedMs = Date.parse(input.startedAt || '');
  const graceSeconds = Number(input.startupGraceSeconds);
  const windowSeconds = Number(input.verificationWindowSeconds);
  if (!Number.isFinite(startedMs)) throw new Error('startedAt must be an ISO timestamp');
  if (!Number.isInteger(graceSeconds) || graceSeconds < 0 || graceSeconds > 300) throw new Error('startupGraceSeconds must be an integer from 0 to 300');
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 900) throw new Error('verificationWindowSeconds must be an integer from 1 to 900');
  if (nowMs < startedMs) throw new Error('verification clock precedes deployment start');
  const elapsedSeconds = Math.floor((nowMs - startedMs) / 1000);
  const withinGrace = elapsedSeconds < graceSeconds;
  const windowExpired = elapsedSeconds > windowSeconds;
  const reasons = [];

  if (identity.state !== 'VERIFIED') reasons.push(reason('deployment_identity_unverified', 'intervention', 'server deployment identity is not verified'));
  if (!ALLOWED_ENVIRONMENTS.has(expected.environment) || identity.environment?.state !== 'VERIFIED' || identity.environment?.value !== expected.environment) reasons.push(reason('environment_identity_mismatch', 'intervention', 'server environment identity is absent, unverified, or unexpected'));
  if (!SHA.test(expected.commit || '') || identity.build?.state !== 'VERIFIED' || identity.build?.value !== expected.commit) reasons.push(reason('commit_fingerprint_mismatch', 'intervention', 'server build identity does not match the approved commit'));
  const releaseEvidence = identity.releaseEvidence || {};
  if (releaseEvidence.state === 'MISMATCH' || (expected.artifactDigest && releaseEvidence.artifactDigest !== expected.artifactDigest)) reasons.push(reason('artifact_digest_mismatch', 'intervention', 'runtime artifact evidence does not match the intended artifact'));
  else if (releaseEvidence.state !== 'VERIFIED' || !DIGEST.test(expected.artifactDigest || '') || !DIGEST.test(releaseEvidence.artifactDigest || '')) reasons.push(reason('release_evidence_insufficient', 'intervention', 'release evidence is absent or unverified'));
  if (releaseEvidence.expectedEnvironment !== expected.environment) reasons.push(reason('release_environment_mismatch', 'intervention', 'release evidence environment does not match the intended deployment'));
  if (observed.rollbackTargetState !== 'VERIFIED') reasons.push(reason('rollback_target_unverified', 'intervention', 'a verified rollback target is not available'));
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
  const releaseClassification = reasons.some((item) => ['artifact_digest_mismatch','release_environment_mismatch','commit_fingerprint_mismatch'].includes(item.code)) ? 'RELEASE_MISMATCH'
    : reasons.some((item) => ['release_evidence_insufficient','rollback_target_unverified'].includes(item.code)) ? 'INSUFFICIENT_EVIDENCE'
      : classification === 'operator intervention required' ? 'OPERATOR_INTERVENTION_REQUIRED'
        : classification === 'proceed' ? 'VERIFIED_RELEASE' : 'DEGRADED_RELEASE';
  return {
    schemaVersion: 1,
    kind: 'blackspire-post-deploy-verification',
    readOnly: true,
    automaticActionTaken: false,
    classification,
    releaseClassification,
    elapsedSeconds,
    withinGrace,
    windowExpired,
    environment: identity.environment?.value || null,
    expected: { environment: expected.environment || null, commit: expected.commit || null, artifactDigest: DIGEST.test(expected.artifactDigest || '') ? expected.artifactDigest : null, buildFingerprint: expected.buildFingerprint || null, migrationVersion: expected.migrationVersion || null },
    observed: { deploymentIdentity: { state: ['VERIFIED','UNVERIFIED','MISMATCH','UNKNOWN'].includes(identity.state) ? identity.state : 'UNKNOWN', environment: identity.environment?.value || null, build: SHA.test(identity.build?.value || '') ? identity.build.value : null, releaseEvidence: { state: releaseEvidence.state || 'MISSING', artifactDigest: DIGEST.test(releaseEvidence.artifactDigest || '') ? releaseEvidence.artifactDigest : null } }, rollbackTargetState: observed.rollbackTargetState || null, buildFingerprint: observed.buildFingerprint || null, migrationVersion: observed.migrationVersion || null, health: observed.health || null, telegramMode: observed.telegramMode || null, providersDisabled: observed.providersDisabled === true },
    reasons,
    mobileSummary: summary,
  };
}
