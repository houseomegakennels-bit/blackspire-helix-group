#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(process.argv[2] || 'ci-artifacts');
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
try {
  const metadata = readJson('build-metadata.json');
  const manifest = readJson('release-package/RELEASE_EVIDENCE.json');
  const packagedCommit = fs.readFileSync(path.join(root, 'release-package/COMMIT_SHA'), 'utf8').trim();
  const checkoutTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
  const expected = {
    commit: process.env.GITHUB_SHA,
    node: process.version,
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
  };
  if (!/^[0-9a-f]{40}$/.test(metadata.commit) || metadata.commit !== packagedCommit || metadata.commit !== manifest.commitSha
    || metadata.commit !== expected.commit || !/^[0-9a-f]{40}$/.test(metadata.tree) || metadata.tree !== checkoutTree
    || !/^[0-9a-f]{64}$/.test(metadata.artifactDigest) || metadata.artifactDigest !== manifest.artifact?.digest
    || metadata.node !== expected.node || metadata.node !== manifest.runtime?.nodeVersion
    || metadata.runId !== expected.runId || metadata.runAttempt !== expected.runAttempt
    || manifest.ci?.runId !== expected.runId || manifest.buildId !== `${expected.runId}.${expected.runAttempt}`) {
    throw new Error('CI metadata does not match the packaged release evidence');
  }
  process.stdout.write('{"state":"VERIFIED","kind":"blackspire-ci-release-artifact"}\n');
} catch (error) {
  process.stderr.write(`release artifact verification failed: ${error.message}\n`);
  process.exit(1);
}
