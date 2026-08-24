import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createDeploymentIdentityProvider, validateDeploymentIdentityForStartup } from '../packages/shared/deployment-identity.js';
import { writeReleaseEvidence, computeArtifactDigest, DEPLOYMENT_RECORD_FILE } from '../packages/shared/release-evidence.js';

// The deployment record is the deployer's own statement of what it put live. Before this
// producer existed, packages/shared/deployment-identity.js reported DEPLOYMENT_RECORD_MISSING
// for every release, downgrading the identity to UNVERIFIED and refusing startup on
// vps-staging and vps-production -- a completely valid release could never be started.
const sha = 'a'.repeat(40);
const producer = path.resolve('scripts/write-deployment-record.js');

function release({ environment = 'staging', commit = sha } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-deployment-record-'));
  const artifact = path.join(root, 'releases', commit);
  fs.mkdirSync(path.join(artifact, 'apps'), { recursive: true });
  fs.writeFileSync(path.join(artifact, 'COMMIT_SHA'), `${commit}\n`);
  fs.writeFileSync(path.join(artifact, 'package.json'), '{"version":"0.1.0"}');
  fs.writeFileSync(path.join(artifact, 'apps', 'server.js'), 'export const ready = true;\n');
  writeReleaseEvidence(artifact, { commitSha: commit, expectedEnvironment: environment, buildTimestamp: '2026-08-13T00:00:00.000Z',
    sourceRef: 'refs/heads/main', buildId: 'local.1', ciProvider: 'local-disposable', ciRunId: null, artifactName: `blackspire-${commit}`,
    packageVersion: '0.1.0', nodeVersion: process.version, repository: 'houseomegakennels-bit/blackspire-helix-group' });
  return { root, artifact };
}

function record(artifact, env = {}) {
  return spawnSync(process.execPath, [producer, artifact], { encoding: 'utf8', env: { ...process.env, BLACKSPIRE_STATE_OWNER: 'vps-staging', ...env } });
}

function identity(artifact, { owner = 'vps-staging', expectedEnvironment = 'staging', commit = sha } = {}) {
  return createDeploymentIdentityProvider({ stateOwner: owner, artifactRoot: artifact, expectedEnvironment, expectedBuildSha: commit }).get();
}

test('a valid release cannot start until the deployment record exists, and can once it does', () => {
  const { root, artifact } = release();

  const before = identity(artifact);
  assert.equal(before.releaseEvidence.state, 'UNVERIFIED');
  assert.ok(before.releaseEvidence.reasons.includes('DEPLOYMENT_RECORD_MISSING'));
  assert.equal(before.state, 'UNVERIFIED');
  assert.equal(validateDeploymentIdentityForStartup(before, 'vps-staging').ok, false);

  const written = record(artifact);
  assert.equal(written.status, 0, written.stderr);
  const report = JSON.parse(written.stdout);
  assert.equal(report.state, 'RECORDED');
  // Derived, not asserted against a literal: the recorded digest must be the real one.
  assert.equal(report.artifactDigest, computeArtifactDigest(artifact));
  assert.equal(report.commitSha, sha);
  assert.equal(report.environment, 'staging');

  const after = identity(artifact);
  assert.equal(after.releaseEvidence.state, 'VERIFIED');
  assert.equal(after.state, 'VERIFIED');
  assert.equal(validateDeploymentIdentityForStartup(after, 'vps-staging').ok, true);
  fs.rmSync(root, { recursive: true });
});

test('the recorded digest is recomputed from the packaged bytes, so post-deploy tampering is caught', () => {
  const { root, artifact } = release();
  assert.equal(record(artifact).status, 0);
  assert.equal(identity(artifact).state, 'VERIFIED');
  // A copied-from-the-manifest digest could not detect this; a recomputed one does.
  fs.appendFileSync(path.join(artifact, 'apps', 'server.js'), 'tampered\n');
  const tampered = identity(artifact);
  assert.equal(tampered.state, 'MISMATCH');
  assert.ok(tampered.releaseEvidence.reasons.includes('ARTIFACT_DIGEST_MISMATCH'));
  assert.equal(validateDeploymentIdentityForStartup(tampered, 'vps-staging').ok, false);
  fs.rmSync(root, { recursive: true });
});

test('the deployment record is outside digest coverage so recording does not invalidate the release', () => {
  const { root, artifact } = release();
  const before = computeArtifactDigest(artifact);
  assert.equal(record(artifact).status, 0);
  assert.ok(fs.existsSync(path.join(artifact, DEPLOYMENT_RECORD_FILE)));
  assert.equal(computeArtifactDigest(artifact), before);
  // No temporary file is left behind to be read as a partial record.
  assert.equal(fs.existsSync(path.join(artifact, `${DEPLOYMENT_RECORD_FILE}.tmp`)), false);
  fs.rmSync(root, { recursive: true });
});

test('a record naming another environment is a mismatch rather than a silent pass', () => {
  // Written directly rather than through the producer, which now refuses this case outright
  // before the symlink swap. This pins the READ side: if such a record reaches a running
  // system by any route, startup must still refuse it.
  const { root, artifact } = release({ environment: 'staging' });
  assert.equal(record(artifact).status, 0);
  const file = path.join(artifact, DEPLOYMENT_RECORD_FILE);
  const written = JSON.parse(fs.readFileSync(file, 'utf8'));
  written.environment = 'production';
  fs.writeFileSync(file, `${JSON.stringify(written)}\n`);
  const result = identity(artifact);
  assert.ok(result.releaseEvidence.reasons.includes('ENVIRONMENT_MISMATCH'));
  assert.equal(result.state, 'MISMATCH');
  assert.equal(validateDeploymentIdentityForStartup(result, 'vps-staging').ok, false);
  fs.rmSync(root, { recursive: true });
});

test('the environment must come from the host and an unknown one is refused', () => {
  const { root, artifact } = release();
  const unknownOwner = record(artifact, { BLACKSPIRE_STATE_OWNER: 'not-a-real-owner' });
  assert.equal(unknownOwner.status, 1);
  assert.match(unknownOwner.stderr, /deployment environment is unknown/);
  const badEnvironment = record(artifact, { BLACKSPIRE_DEPLOYMENT_ENVIRONMENT: 'not-an-environment' });
  assert.equal(badEnvironment.status, 1);
  // Nothing was written by either refusal.
  assert.equal(fs.existsSync(path.join(artifact, DEPLOYMENT_RECORD_FILE)), false);
  fs.rmSync(root, { recursive: true });
});

test('a malformed or symlinked record is treated as absent rather than trusted', () => {
  const { root, artifact } = release();
  const target = path.join(artifact, DEPLOYMENT_RECORD_FILE);

  fs.writeFileSync(target, '{not json');
  assert.ok(identity(artifact).releaseEvidence.reasons.includes('DEPLOYMENT_RECORD_MISSING'));

  fs.rmSync(target);
  const outside = path.join(root, 'foreign-record.json');
  fs.writeFileSync(outside, JSON.stringify({ commitSha: sha, artifactDigest: computeArtifactDigest(artifact), environment: 'staging' }));
  fs.symlinkSync(outside, target);
  const linked = identity(artifact);
  assert.ok(linked.releaseEvidence.reasons.includes('DEPLOYMENT_RECORD_MISSING'), 'a symlinked record must not be trusted');
  assert.equal(validateDeploymentIdentityForStartup(linked, 'vps-staging').ok, false);
  fs.rmSync(root, { recursive: true });
});

test('release-switch records the deployment before making the release current', () => {
  const script = fs.readFileSync('scripts/release-switch.sh', 'utf8');
  const recorded = script.indexOf('write-deployment-record.js');
  const swapped = script.indexOf('current.next');
  assert.notEqual(recorded, -1, 'release-switch must produce a deployment record');
  assert.ok(recorded < swapped, 'the record must be written before the symlink swap');
  // set -e plus no `|| true`: a failed record must abort the switch.
  assert.match(script, /set -euo pipefail/);
  assert.doesNotMatch(script, /write-deployment-record\.js[^\n]*\|\|/);
});

test('a record naming a different commit than the manifest is a mismatch', () => {
  // The record's commit binding had no test: a record could name another commit entirely and
  // nothing failed, because the packaged COMMIT_SHA is checked on a separate path.
  const { root, artifact } = release();
  assert.equal(record(artifact).status, 0);
  const file = path.join(artifact, DEPLOYMENT_RECORD_FILE);
  const written = JSON.parse(fs.readFileSync(file, 'utf8'));
  written.commitSha = 'b'.repeat(40);
  fs.writeFileSync(file, `${JSON.stringify(written)}\n`);
  const result = identity(artifact);
  assert.ok(result.releaseEvidence.reasons.includes('COMMIT_MISMATCH'));
  assert.equal(result.state, 'MISMATCH');
  assert.equal(validateDeploymentIdentityForStartup(result, 'vps-staging').ok, false);
  fs.rmSync(root, { recursive: true });
});

test('the recorded digest is recomputed from the tree, not copied out of the manifest', () => {
  // Falsifiability: an implementation that copied manifest.artifact.digest could never produce
  // this refusal, because the comparison would be the manifest against itself.
  const { root, artifact } = release();
  fs.appendFileSync(path.join(artifact, 'apps', 'server.js'), 'changed after sealing\n');
  const result = record(artifact);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /packaged artifact digest does not match the release tree/);
  // The refusal names the digest actually recomputed from the tree.
  assert.match(result.stderr, new RegExp(computeArtifactDigest(artifact)));
  assert.equal(fs.existsSync(path.join(artifact, DEPLOYMENT_RECORD_FILE)), false);
  fs.rmSync(root, { recursive: true });
});

test('the record adopts the release tree ownership so re-switch and rollback stay valid', () => {
  // The release tree has a uniform ownership contract enforced on EVERY validation. A record
  // left with foreign ownership permanently failed re-validation, which made rollback to any
  // release that had ever been current impossible.
  const { root, artifact } = release();
  assert.equal(record(artifact).status, 0);
  const expected = fs.statSync(artifact);
  const written = fs.statSync(path.join(artifact, DEPLOYMENT_RECORD_FILE));
  assert.equal(written.uid, expected.uid, 'record must adopt the release directory owner');
  assert.equal(written.gid, expected.gid, 'record must adopt the release directory group');
  assert.equal(written.mode & 0o777, 0o644, 'record must satisfy the 0644 file mode contract');
  fs.rmSync(root, { recursive: true });
});

test('recording refuses before the symlink swap when the release would not verify', () => {
  // A release sealed for one environment must not be installed into another: without this the
  // deployer installs a release its own startup will refuse, and -- with the previous release
  // also unrollbackable -- strands the service.
  const { root, artifact } = release({ environment: 'staging' });
  const result = record(artifact, { BLACKSPIRE_DEPLOYMENT_ENVIRONMENT: 'production' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /release does not verify for production/);
  assert.match(result.stderr, /ENVIRONMENT_MISMATCH/);
  // Nothing is left behind for a later start to read as a valid record.
  assert.equal(fs.existsSync(path.join(artifact, DEPLOYMENT_RECORD_FILE)), false);
  fs.rmSync(root, { recursive: true });
});

test('release-create seals the environment the host owns rather than defaulting to unassigned', () => {
  // The documented VPS procedure is a bare `release-create.sh <sha>`. Defaulting the sealed
  // environment to 'unassigned' meant the manifest disagreed with the host at startup and the
  // release was refused, which is the same defect class the deployment record was added to fix.
  const script = fs.readFileSync('scripts/release-create.sh', 'utf8');
  assert.match(script, /BLACKSPIRE_EXPECTED_ENVIRONMENT:-\$\(release_expected_environment\)/);
  assert.match(fs.readFileSync('scripts/release-tree-validator.sh', 'utf8'), /release_expected_environment\(\)/);
  assert.doesNotMatch(script, /BLACKSPIRE_EXPECTED_ENVIRONMENT:-unassigned/);
  for (const [owner, environment] of Object.entries({ 'vps-production': 'production', 'vps-staging': 'staging',
    'vps-disposable-staging': 'disposable-staging', 'codespace-disposable': 'development', 'iphone-test-disposable': 'test' })) {
    const resolved = spawnSync('bash', ['-c', 'source scripts/release-tree-validator.sh; release_expected_environment'],
      { encoding: 'utf8', env: { ...process.env, BLACKSPIRE_STATE_OWNER: owner } });
    assert.equal(resolved.status, 0, resolved.stderr);
    assert.equal(resolved.stdout.trim(), environment, owner);
  }
  const noOwner = spawnSync('bash', ['-c', 'source scripts/release-tree-validator.sh; release_expected_environment'],
    { encoding: 'utf8', env: { ...process.env, BLACKSPIRE_STATE_OWNER: '' } });
  assert.equal(noOwner.stdout.trim(), 'unassigned', 'a host declaring no owner stays unassigned');
});
