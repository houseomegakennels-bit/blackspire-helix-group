import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyPostDeploy } from '../packages/shared/post-deploy-verifier.js';

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
});

test('degraded health observes during grace and recommends rollback after grace', () => {
  const degraded = structuredClone(healthy); degraded.observed.health = 'degraded'; degraded.observed.readiness = false;
  assert.equal(verifyPostDeploy(degraded, Date.parse(start) + 10_000).classification, 'observe');
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
  fs.writeFileSync(input, JSON.stringify(healthy));
  const result = spawnSync(process.execPath, [path.resolve('scripts/post-deploy-verify.js'), '--input', input, '--audit-output', audit], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).classification, 'proceed');
  assert.equal(fs.statSync(audit).mode & 0o777, 0o600);
  const duplicate = spawnSync(process.execPath, [path.resolve('scripts/post-deploy-verify.js'), '--input', input, '--audit-output', audit], { encoding: 'utf8' });
  assert.notEqual(duplicate.status, 0);
});

test('verification budgets are bounded', () => {
  assert.throws(() => verifyPostDeploy({ ...healthy, verificationWindowSeconds: 901 }, Date.parse(healthy.observedAt)), /1 to 900/);
  assert.throws(() => verifyPostDeploy({ ...healthy, startupGraceSeconds: 301 }, Date.parse(healthy.observedAt)), /0 to 300/);
});
