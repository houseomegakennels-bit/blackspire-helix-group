import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { recomputePostDeployAudit, verifyPostDeploy } from '../packages/shared/post-deploy-verifier.js';
import { createDeploymentIdentityProvider, serializeDeploymentIdentity } from '../packages/shared/deployment-identity.js';
import { writeReleaseEvidence } from '../packages/shared/release-evidence.js';
import fsNode from 'node:fs';
import osNode from 'node:os';
import pathNode from 'node:path';

const start = '2026-08-05T00:00:00.000Z';
const commit = 'a'.repeat(40);
const artifactDigest = 'd'.repeat(64);
const healthy = {
  startedAt: start, observedAt: '2026-08-05T00:02:00.000Z', startupGraceSeconds: 30, verificationWindowSeconds: 300,
  expected: { environment: 'disposable-staging', commit, artifactDigest, buildFingerprint: 'build-123', migrationVersion: 'schema-7' },
  observed: { deploymentIdentity: { state:'VERIFIED', environment:{state:'VERIFIED',value:'disposable-staging'}, build:{state:'VERIFIED',value:commit}, releaseEvidence:{state:'VERIFIED',artifactDigest,expectedEnvironment:'disposable-staging'} }, rollbackTargetState:'VERIFIED', buildFingerprint: 'build-123', migrationVersion: 'schema-7', health: 'healthy', liveness: true, readiness: true, workerHeartbeatFresh: true, queueConnected: true, databaseConnected: true, providersDisabled: true, telegramMode: 'dry-run' },
};

test('healthy disposable staging produces a read-only proceed audit', () => {
  const report = verifyPostDeploy(healthy, Date.parse(healthy.observedAt));
  assert.equal(report.classification, 'proceed');
  assert.equal(report.releaseClassification, 'VERIFIED_RELEASE');
  assert.equal(report.automaticActionTaken, false);
  assert.match(report.mobileSummary, /STAGING VERIFIED/);
  assert.deepEqual(report.observed, healthy.observed);
});

test('stale, missing, and skewed observation times fail closed', () => {
  const now = Date.parse(healthy.observedAt);
  const stale = structuredClone(healthy); stale.startedAt = new Date(now - 600_000).toISOString(); stale.observedAt = new Date(now - 301_000).toISOString();
  assert.equal(verifyPostDeploy(stale, now).classification, 'rollback recommended');
  assert.ok(verifyPostDeploy(stale, now).reasons.some(({ code }) => code === 'observation_stale'));
  assert.throws(() => verifyPostDeploy({ ...healthy, observedAt: undefined }, now), /observedAt/);
  const future = structuredClone(healthy); future.observedAt = new Date(now + 5_001).toISOString();
  assert.equal(verifyPostDeploy(future, now).classification, 'operator intervention required');
});

test('verification window expiry fails closed while exact boundary remains valid', () => {
  const bounded = structuredClone(healthy);
  bounded.verificationWindowSeconds = 900;
  bounded.observedAt = new Date(Date.parse(start) + 900_000).toISOString();
  const atBoundary = verifyPostDeploy(bounded, Date.parse(start) + 900_000);
  assert.equal(atBoundary.windowExpired, false);
  assert.equal(atBoundary.classification, 'proceed');

  bounded.observedAt = new Date(Date.parse(start) + 900_001).toISOString();
  const expired = verifyPostDeploy(bounded, Date.parse(start) + 900_001);
  assert.equal(expired.windowExpired, true);
  assert.equal(expired.classification, 'rollback recommended');
  assert.deepEqual(expired.reasons.map(({ code }) => code), ['verification_window_expired']);
  assert.doesNotMatch(expired.mobileSummary, /STAGING VERIFIED/);
});

test('missing gating evidence cannot inherit a healthy result', () => {
  for (const field of ['liveness', 'readiness', 'databaseConnected', 'queueConnected', 'workerHeartbeatFresh']) {
    const missing = structuredClone(healthy); delete missing.observed[field];
    assert.notEqual(verifyPostDeploy(missing, Date.parse(missing.observedAt)).classification, 'proceed', field);
  }
});

test('audit replay recomputes from complete evidence and ignores a tampered summary', () => {
  const now = Date.parse(healthy.observedAt);
  const audit = { ...verifyPostDeploy(healthy, now), recordedAt: new Date(now).toISOString(), classification: 'rollback recommended', reasons: [{ code: 'forged' }] };
  const replay = recomputePostDeployAudit(audit, now);
  assert.equal(replay.classification, 'proceed');
  assert.deepEqual(replay.observed, healthy.observed);
});

test('replay detects stale or tampered observation timestamps', () => {
  const now = Date.parse(healthy.observedAt);
  const audit = { ...verifyPostDeploy(healthy, now), recordedAt: new Date(now).toISOString() };
  audit.startedAt = new Date(now - 600_000).toISOString();
  audit.observedAt = new Date(now - 301_000).toISOString();
  assert.equal(recomputePostDeployAudit(audit, now).classification, 'rollback recommended');
  delete audit.observedAt;
  assert.throws(() => recomputePostDeployAudit(audit, now), /observedAt/);
});

test('observation field order and duplicate snapshots cannot create freshness', () => {
  const reordered = structuredClone(healthy);
  reordered.observed = Object.fromEntries(Object.entries(reordered.observed).reverse());
  assert.equal(verifyPostDeploy(reordered, Date.parse(reordered.observedAt)).classification, 'proceed');
  const duplicateShape = structuredClone(healthy); duplicateShape.observed = [healthy.observed, healthy.observed];
  assert.notEqual(verifyPostDeploy(duplicateShape, Date.parse(duplicateShape.observedAt)).classification, 'proceed');
});

test('degraded health observes during grace and recommends rollback after grace', () => {
  const degraded = structuredClone(healthy); degraded.observed.health = 'degraded'; degraded.observed.readiness = false;
  degraded.observedAt = new Date(Date.parse(start) + 10_000).toISOString();
  assert.equal(verifyPostDeploy(degraded, Date.parse(start) + 10_000).classification, 'observe');
  degraded.observedAt = new Date(Date.parse(start) + 120_000).toISOString();
  const report = verifyPostDeploy(degraded, Date.parse(start) + 120_000);
  assert.equal(report.classification, 'rollback recommended');
  assert.deepEqual(report.reasons.map((item) => item.code), ['readiness_failed', 'degraded_health']);
});

test('the audit identity projection sanitizes in place and survives replay', () => {
  // Regression guard for the rebase of PR #95 onto the merged verification-window work. An
  // earlier projection FLATTENED the identity to {environment: value, build: value}, which
  // dropped each component's `state`. verifyPostDeploy() reads identity.environment?.state, so
  // replaying a VERIFIED audit through recomputePostDeployAudit() then failed closed to
  // 'operator intervention required' -- a clean deployment reported as needing intervention on
  // every replay. Pin BOTH halves: the shape round-trips, and malformed input is still clamped.
  const report = verifyPostDeploy(healthy, Date.parse(healthy.observedAt));
  assert.deepEqual(report.observed.deploymentIdentity, healthy.observed.deploymentIdentity);
  assert.equal(recomputePostDeployAudit(report, Date.parse(healthy.observedAt)).classification, 'proceed');
  // The release-evidence projection has the same round-trip obligation, and regressed the same
  // way: verifyPostDeploy compares releaseEvidence.expectedEnvironment against
  // expected.environment, so dropping it from the audit made every replay of a VALID audit raise
  // release_environment_mismatch and downgrade to 'operator intervention required'.
  assert.equal(report.observed.deploymentIdentity.releaseEvidence.expectedEnvironment,
    healthy.observed.deploymentIdentity.releaseEvidence.expectedEnvironment,
    'the audit must carry every field its own re-verification reads');
  assert.deepEqual(recomputePostDeployAudit(report, Date.parse(healthy.observedAt)).reasons, []);

  const malformed = structuredClone(healthy);
  malformed.observed.deploymentIdentity = {
    state: 'TOTALLY-BOGUS',
    environment: { state: 'not-a-state', value: 'disposable-staging' },
    build: { state: 'VERIFIED', value: 'not-a-sha' },
  };
  const clamped = verifyPostDeploy(malformed, Date.parse(malformed.observedAt)).observed.deploymentIdentity;
  assert.equal(clamped.state, 'UNKNOWN');
  assert.equal(clamped.environment.state, 'UNKNOWN');
  assert.equal(clamped.build.value, null, 'a non-SHA build value must not reach the audit record');
});

test('identity, migration, provider, and Telegram mismatches require intervention', () => {
  const unsafe = structuredClone(healthy);
  Object.assign(unsafe.observed, { deploymentIdentity:{state:'MISMATCH',environment:{state:'MISMATCH',value:'production'},build:{state:'MISMATCH',value:'b'.repeat(40)}}, buildFingerprint: 'wrong', migrationVersion: 'old', providersDisabled: false, telegramMode: 'polling' });
  const report = verifyPostDeploy(unsafe, Date.parse(unsafe.observedAt));
  assert.equal(report.classification, 'operator intervention required');
  assert.ok(report.reasons.every((item) => item.severity === 'intervention'));
  // Assert the specific codes, not just the classification. Asserting only the classification let
  // the four identity gates satisfy this test on their own, so the provider and Telegram gates
  // below could each be deleted outright with the suite still green.
  assert.deepEqual(report.reasons.map((item) => item.code).sort(), [
    'artifact_digest_mismatch', 'build_fingerprint_mismatch', 'commit_fingerprint_mismatch',
    'deployment_identity_unverified', 'environment_identity_mismatch', 'migration_version_mismatch',
    'providers_not_disabled', 'release_environment_mismatch', 'telegram_not_sandboxed',
  ]);
});

// Each gate below is isolated: every other input stays healthy, so the asserted reason code can
// only originate from the gate under test and that gate cannot be removed without failing here.
// Both are load-bearing -- scripts/post-deploy-verify.js exits non-zero on this classification.
test('the providers gate alone requires intervention and is not satisfied by a truthy value', () => {
  for (const providersDisabled of [false, undefined, null, 'true', 1]) {
    const unsafe = structuredClone(healthy); unsafe.observed.providersDisabled = providersDisabled;
    const report = verifyPostDeploy(unsafe, Date.parse(unsafe.observedAt));
    assert.deepEqual(report.reasons.map((item) => item.code), ['providers_not_disabled'], `providersDisabled must fail closed: ${String(providersDisabled)}`);
    assert.equal(report.classification, 'operator intervention required');
  }
  assert.equal(verifyPostDeploy(healthy, Date.parse(healthy.observedAt)).classification, 'proceed');
});

test('the Telegram gate accepts only proven-safe modes and rejects mock', () => {
  // `mock` is deliberately NOT accepted here even though packages/health-transitions/sources.js
  // counts it as sandboxed; see docs/HEALTH_TRANSITION_OPERATOR_DIAGNOSTICS.md. Widening this gate
  // to unify the two constants would weaken a deployment safety check, so the divergence is now
  // pinned by an executable test rather than defended by prose alone.
  for (const telegramMode of ['mock', 'polling', 'webhook', 'live', undefined, null, '', 'Sandbox', 'dry_run', 'sandbox ']) {
    const unsafe = structuredClone(healthy); unsafe.observed.telegramMode = telegramMode;
    const report = verifyPostDeploy(unsafe, Date.parse(unsafe.observedAt));
    assert.deepEqual(report.reasons.map((item) => item.code), ['telegram_not_sandboxed'], `telegramMode must fail closed: ${String(telegramMode)}`);
    assert.equal(report.classification, 'operator intervention required');
  }
  for (const telegramMode of ['disabled', 'sandbox', 'dry-run']) {
    const safe = structuredClone(healthy); safe.observed.telegramMode = telegramMode;
    assert.equal(verifyPostDeploy(safe, Date.parse(safe.observedAt)).classification, 'proceed', `telegramMode must be accepted: ${telegramMode}`);
  }
});

test('unknown server identity cannot be promoted by caller-supplied legacy fields', () => {
  const spoofed = structuredClone(healthy);
  spoofed.observed.deploymentIdentity = { state:'UNKNOWN', environment:{state:'UNKNOWN',value:null}, build:{state:'UNKNOWN',value:null} };
  spoofed.observed.environment = healthy.expected.environment;
  spoofed.observed.commit = healthy.expected.commit;
  const report = verifyPostDeploy(spoofed, Date.parse(spoofed.observedAt));
  assert.equal(report.classification, 'operator intervention required');
  assert.ok(report.reasons.some((item) => item.code === 'deployment_identity_unverified'));
});

test('artifact mismatch and missing rollback evidence fail closed without automatic rollback', () => {
  const mismatch=structuredClone(healthy); mismatch.observed.deploymentIdentity.releaseEvidence.artifactDigest='e'.repeat(64); mismatch.observed.rollbackTargetState='MISSING';
  const report=verifyPostDeploy(mismatch,Date.parse(mismatch.observedAt));
  assert.equal(report.classification,'operator intervention required'); assert.equal(report.releaseClassification,'RELEASE_MISMATCH'); assert.equal(report.automaticActionTaken,false);
  assert.ok(report.reasons.some((item)=>item.code==='artifact_digest_mismatch')); assert.ok(report.reasons.some((item)=>item.code==='rollback_target_unverified'));
});

test('CLI writes a private, exclusive audit record without taking action', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-post-deploy-'));
  const input = path.join(root, 'input.json'); const audit = path.join(root, 'audit.json');
  const current = structuredClone(healthy);
  const now = new Date(); current.startedAt = new Date(now.getTime() - 60_000).toISOString(); current.observedAt = now.toISOString();
  fs.writeFileSync(input, JSON.stringify(current));
  const result = spawnSync(process.execPath, [path.resolve('scripts/post-deploy-verify.js'), '--input', input, '--audit-output', audit], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).classification, 'proceed');
  assert.equal(fs.statSync(audit).mode & 0o777, 0o600);
  const persisted = JSON.parse(fs.readFileSync(audit, 'utf8'));
  assert.notEqual(persisted.recordedAt, persisted.startedAt);
  assert.deepEqual(persisted.observed, current.observed);
  const duplicate = spawnSync(process.execPath, [path.resolve('scripts/post-deploy-verify.js'), '--input', input, '--audit-output', audit], { encoding: 'utf8' });
  assert.notEqual(duplicate.status, 0);
});

test('verification budgets are bounded', () => {
  assert.throws(() => verifyPostDeploy({ ...healthy, verificationWindowSeconds: 901 }, Date.parse(healthy.observedAt)), /1 to 900/);
  assert.throws(() => verifyPostDeploy({ ...healthy, startupGraceSeconds: 301 }, Date.parse(healthy.observedAt)), /0 to 300/);
});

test('a real disposable-staging identity from the provider verifies end to end', () => {
  // Every other fixture in this file hand-writes observed.deploymentIdentity, so none of them
  // prove the identity PROVIDER can actually produce a value the verifier accepts. That gap is
  // how a state of affairs shipped in which NO owner could emit 'disposable-staging' and every
  // disposable rehearsal was permanently 'operator intervention required'. Build the identity
  // from a real provider and run it through verification untouched.
  const root = fsNode.mkdtempSync(pathNode.join(osNode.tmpdir(), 'blackspire-disposable-e2e-'));
  try {
    const artifact = pathNode.join(root, 'releases', commit);
    fsNode.mkdirSync(artifact, { recursive: true });
    fsNode.writeFileSync(pathNode.join(artifact, 'COMMIT_SHA'), `${commit}\n`);
    fsNode.writeFileSync(pathNode.join(artifact, 'package.json'), JSON.stringify({ version: '0.1.0' }));

    const evidence = writeReleaseEvidence(artifact, {
      commitSha: commit, expectedEnvironment: 'disposable-staging',
      buildTimestamp: '2026-08-10T00:00:00.000Z', buildId: 'e2e-1', ciProvider: 'local-disposable',
      artifactName: 'e2e', packageVersion: '0.1.0', nodeVersion: 'v22.23.1',
      repository: 'houseomegakennels-bit/blackspire-helix-group',
    });
    const identity = serializeDeploymentIdentity(createDeploymentIdentityProvider({
      stateOwner: 'vps-disposable-staging',
      artifactRoot: artifact,
      expectedEnvironment: 'disposable-staging',
      expectedBuildSha: commit,
      deploymentRecord: { commitSha: commit, artifactDigest: evidence.artifact.digest, environment: 'disposable-staging' },
    }).get());
    assert.equal(identity.state, 'VERIFIED', 'the provider itself must verify before the report is built');

    const input = structuredClone(healthy);
    input.observed.deploymentIdentity = identity;
    // The intended artifact must be the one the evidence actually describes -- the point of this
    // test is that a REAL provider output verifies, so the digest comes from the manifest rather
    // than from the shared fixture's placeholder.
    input.expected.artifactDigest = evidence.artifact.digest;
    const report = verifyPostDeploy(input, Date.parse(input.observedAt));
    assert.equal(report.classification, 'proceed', `a genuine disposable identity must verify: ${JSON.stringify(report.reasons)}`);
    assert.deepEqual(report.reasons, []);
    assert.equal(recomputePostDeployAudit(report, Date.parse(input.observedAt)).classification, 'proceed');
  } finally {
    fsNode.rmSync(root, { recursive: true, force: true });
  }
});
