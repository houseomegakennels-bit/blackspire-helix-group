#!/usr/bin/env node
// Writes the deployment record for a release as it is made current.
//
// This is the missing producer for the deployment-record side of the release-evidence
// contract. Without it, packages/shared/deployment-identity.js reports
// DEPLOYMENT_RECORD_MISSING for every release, which downgrades the identity to UNVERIFIED
// and refuses startup for vps-staging and vps-production -- a release that is otherwise
// completely valid could never be started.
//
// The record states what the DEPLOYER observed and intended, separately from what the
// artifact claims about itself:
//   commitSha       read from the packaged COMMIT_SHA
//   artifactDigest  RECOMPUTED from the packaged bytes, never copied out of the manifest
//   environment     supplied by the host, never read from the artifact
//
// Recomputing rather than copying is the point: if the two disagree, the tree changed
// between packaging and deployment.
import fs from 'node:fs';
import path from 'node:path';
import { computeArtifactDigest, verifyReleaseEvidence, loadReleaseEvidence, DEPLOYMENT_RECORD_FILE } from '../packages/shared/release-evidence.js';

const SHA = /^[0-9a-f]{40}$/;
const ENVIRONMENTS = new Set(['unassigned', 'development', 'test', 'staging', 'disposable-staging', 'production']);
const OWNER_ENVIRONMENTS = {
  'vps-production': 'production',
  'vps-staging': 'staging',
  'vps-disposable-staging': 'disposable-staging',
  'codespace-disposable': 'development',
  'iphone-test-disposable': 'test',
};

const releaseDir = process.argv[2];
if (!releaseDir) {
  process.stderr.write('usage: write-deployment-record.js <release-directory>\n');
  process.exit(2);
}

try {
  const root = fs.realpathSync(releaseDir);
  const environment = process.env.BLACKSPIRE_DEPLOYMENT_ENVIRONMENT
    || OWNER_ENVIRONMENTS[process.env.BLACKSPIRE_STATE_OWNER || ''] || '';
  if (!ENVIRONMENTS.has(environment)) {
    throw new Error('deployment environment is unknown: set BLACKSPIRE_DEPLOYMENT_ENVIRONMENT or a recognised BLACKSPIRE_STATE_OWNER');
  }

  const commitSha = fs.readFileSync(path.join(root, 'COMMIT_SHA'), 'utf8').trim().toLowerCase();
  if (!SHA.test(commitSha)) throw new Error('packaged COMMIT_SHA is not a full commit SHA');

  const artifactDigest = computeArtifactDigest(root);

  // Fail fast, and name the recomputed value. This is what makes "recomputed, never copied out
  // of the manifest" a falsifiable claim rather than a comment: an implementation that copied
  // the manifest's digest could never produce this refusal.
  const packaged = loadReleaseEvidence(root);
  if (packaged.manifest && packaged.manifest.artifact?.digest !== artifactDigest) {
    throw new Error(`packaged artifact digest does not match the release tree: recomputed ${artifactDigest}`);
  }

  const record = { schema: 'blackspire-deployment-record', version: 1, commitSha, artifactDigest, environment, recordedAt: new Date().toISOString() };

  // Written atomically so a crashed deploy cannot leave a half-written record that would be
  // read as a malformed (and therefore absent) record on the next start.
  const target = path.join(root, DEPLOYMENT_RECORD_FILE);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o644 });

  // The release tree has an ownership contract (root:blackspire, 0644 files) enforced by
  // scripts/release-tree-validator.sh on EVERY validation, including the one release-switch.sh
  // runs and the one release-rollback.sh inherits. release-create.sh chowns the tree when it
  // builds it, long before this record exists, so a record left with the deploying user's
  // ownership permanently fails re-validation and makes rollback to this release impossible.
  // Inherit the release directory's own ownership rather than hardcoding names that do not
  // exist in development or test environments.
  const owner = fs.statSync(root);
  try {
    fs.chownSync(temporary, owner.uid, owner.gid);
  } catch (error) {
    const current = fs.statSync(temporary);
    if (current.uid !== owner.uid || current.gid !== owner.gid) {
      fs.rmSync(temporary, { force: true });
      throw new Error(`deployment record could not adopt the release ownership contract: ${error.message}`);
    }
  }
  fs.chmodSync(temporary, 0o644);
  fs.renameSync(temporary, target);

  // Prove the release we are about to make current actually verifies, before release-switch.sh
  // swaps the symlink. Without this the deployer can install a release that its own startup
  // identity check will refuse, and -- with the rollback target also refused -- strand the
  // service with no scripted way back.
  const verified = verifyReleaseEvidence({ artifactRoot: root, packagedCommitSha: commitSha,
    expectedCommitSha: commitSha, expectedEnvironment: environment, deploymentRecord: record });
  if (verified.state !== 'VERIFIED') {
    fs.rmSync(target, { force: true });
    throw new Error(`release does not verify for ${environment}: ${verified.reasons.join(',') || verified.reasonCode}`);
  }

  process.stdout.write(`${JSON.stringify({ state: 'RECORDED', commitSha, artifactDigest, environment })}\n`);
} catch (error) {
  process.stderr.write(`deployment record failed: ${error.message}\n`);
  process.exit(1);
}
