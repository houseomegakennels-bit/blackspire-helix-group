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
import { computeArtifactDigest, DEPLOYMENT_RECORD_FILE } from '../packages/shared/release-evidence.js';

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
  const record = { schema: 'blackspire-deployment-record', version: 1, commitSha, artifactDigest, environment, recordedAt: new Date().toISOString() };

  // Written atomically so a crashed deploy cannot leave a half-written record that would be
  // read as a malformed (and therefore absent) record on the next start.
  const target = path.join(root, DEPLOYMENT_RECORD_FILE);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o644 });
  fs.renameSync(temporary, target);

  process.stdout.write(`${JSON.stringify({ state: 'RECORDED', commitSha, artifactDigest, environment })}\n`);
} catch (error) {
  process.stderr.write(`deployment record failed: ${error.message}\n`);
  process.exit(1);
}
