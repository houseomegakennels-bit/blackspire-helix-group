#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { writeReleaseEvidence, verifyReleaseEvidence, serializeReleaseEvidence } from '../packages/shared/release-evidence.js';

const [command, artifactRoot = '.'] = process.argv.slice(2);
const root = path.resolve(artifactRoot);
if (!['generate', 'verify'].includes(command)) { process.stderr.write('usage: release-evidence.js <generate|verify> <artifact-root>\n'); process.exit(2); }
if (command === 'generate') {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const commitSha = fs.readFileSync(path.join(root, 'COMMIT_SHA'), 'utf8').trim();
  const evidence = writeReleaseEvidence(root, { commitSha, expectedEnvironment: process.env.BLACKSPIRE_EXPECTED_ENVIRONMENT,
    sourceRef: process.env.GITHUB_REF || null, buildId: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_RUN_ID}.${process.env.GITHUB_RUN_ATTEMPT || '1'}` : `local.${commitSha.slice(0, 12)}`,
    buildTimestamp: process.env.BLACKSPIRE_BUILD_TIMESTAMP, ciProvider: process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local-disposable',
    ciRunId: process.env.GITHUB_RUN_ID || null, artifactName: process.env.BLACKSPIRE_ARTIFACT_NAME || `blackspire-command-${commitSha}`,
    packageVersion: packageJson.version, nodeVersion: process.version, repository: process.env.GITHUB_REPOSITORY || 'houseomegakennels-bit/blackspire-helix-group' });
  process.stdout.write(`${JSON.stringify(serializeReleaseEvidence({ state: 'VERIFIED', manifest: evidence }))}\n`);
} else {
  const commitSha = fs.readFileSync(path.join(root, 'COMMIT_SHA'), 'utf8').trim();
  const result = verifyReleaseEvidence({ artifactRoot: root, packagedCommitSha: commitSha, expectedCommitSha: process.env.BLACKSPIRE_EXPECTED_COMMIT || null,
    expectedEnvironment: process.env.BLACKSPIRE_EXPECTED_ENVIRONMENT || null, deploymentRecord: process.env.BLACKSPIRE_DEPLOYMENT_RECORD === 'self'
      ? { commitSha, artifactDigest: JSON.parse(fs.readFileSync(path.join(root, 'RELEASE_EVIDENCE.json'), 'utf8')).artifact.digest, environment: process.env.BLACKSPIRE_EXPECTED_ENVIRONMENT } : null,
    runtimeOverrideSha: process.env.BLACKSPIRE_RUNTIME_COMMIT_OVERRIDE || null });
  process.stdout.write(`${JSON.stringify(serializeReleaseEvidence(result))}\n`); process.exit(result.state === 'VERIFIED' ? 0 : 1);
}
