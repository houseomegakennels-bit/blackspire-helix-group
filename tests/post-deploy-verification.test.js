import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { recomputePostDeployAudit, verifyPostDeploy } from '../packages/shared/post-deploy-verifier.js';

const start = '2026-08-05T00:00:00.000Z';
const commit = 'a'.repeat(40);
const healthy = {
  startedAt: start, observedAt: '2026-08-05T00:02:00.000Z', startupGraceSeconds: 30, verificationWindowSeconds: 300,
  expected: { environment: 'disposable-staging', commit, buildFingerprint: 'build-123', migrationVersion: 'schema-7' },
  observed: { environment: 'disposable-staging', commit, buildFingerprint: 'build-123', migrationVersion: 'schema-7', health: 'healthy', liveness: true, readiness: true, workerHeartbeatFresh: true, queueConnected: true, databaseConnected: true, providersDisabled: true, telegramMode: 'dry-run' },
};

test('healthy disposable staging produces a read-only proceed audit', () => {
  const report = verifyPostDeploy(healthy, Date.parse(healthy.observedAt));
  assert.equal(report.classification, 'proceed');
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

test('identity, migration, provider, and Telegram mismatches require intervention', () => {
  const unsafe = structuredClone(healthy);
  Object.assign(unsafe.observed, { environment: 'production', commit: 'b'.repeat(40), buildFingerprint: 'wrong', migrationVersion: 'old', providersDisabled: false, telegramMode: 'polling' });
  const report = verifyPostDeploy(unsafe, Date.parse(unsafe.observedAt));
  assert.equal(report.classification, 'operator intervention required');
  assert.ok(report.reasons.every((item) => item.severity === 'intervention'));
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
