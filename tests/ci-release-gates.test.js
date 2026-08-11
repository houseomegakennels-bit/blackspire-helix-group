import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/blackspire-ci.yml', 'utf8');
const deploymentWorkflow = fs.readFileSync('.github/workflows/deploy-oracle-helix.yml', 'utf8');

test('CI cancels superseded runs and has read-only repository permissions', () => {
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /concurrency:[\s\S]*cancel-in-progress: true/);
  assert.match(workflow, /github\.event\.pull_request\.number \|\| github\.ref/);
});

test('CI enforces shell, whitespace, preflight, and high-audit release gates', () => {
  assert.match(workflow, /fetch-depth: 2/);
  assert.match(workflow, /git ls-files -z '\*\.sh' \| xargs -0 -r -n1 bash -n/);
  assert.match(workflow, /git diff --check HEAD\^ HEAD/);
  assert.match(workflow, /npm run production:preflight/);
  assert.match(workflow, /npm audit --audit-level=high/);
});

test('CI publishes commit, tree, runtime, and run identity metadata', () => {
  for (const field of ['git rev-parse HEAD', 'git rev-parse HEAD^{tree}', 'node --version',
    'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'ci-artifacts/build-metadata.json']) {
    assert.match(workflow, new RegExp(field.replace(/[{}^$.*+?()[\]\\|]/g, '\\$&')));
  }
  assert.match(workflow, /Upload build metadata[\s\S]*if-no-files-found: error/);
  assert.match(workflow, /Package immutable release evidence[\s\S]*git archive HEAD/);
  assert.match(workflow, /release-evidence\.js generate ci-artifacts\/release-package/);
  assert.match(workflow, /release-evidence\.js verify ci-artifacts\/release-package/);
  assert.match(workflow, /artifactDigest/);
  assert.match(workflow, /Cross-check packaged release and CI metadata[\s\S]*verify-ci-release-artifact\.js ci-artifacts/);
});

test('CI release artifact verifier cross-checks every authoritative identity source', () => {
  const verifier = fs.readFileSync('scripts/verify-ci-release-artifact.js', 'utf8');
  for (const field of ['build-metadata.json', 'RELEASE_EVIDENCE.json', 'COMMIT_SHA', 'GITHUB_SHA',
    'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'artifactDigest', 'nodeVersion', 'buildId']) {
    assert.match(verifier, new RegExp(field.replace(/[{}^$.*+?()[\]\\|]/g, '\\$&')));
  }
  assert.match(verifier, /process\.exit\(1\)/);
});

test('official JavaScript actions use reviewed Node 24 releases pinned by immutable commit', () => {
  const combined = `${workflow}\n${deploymentWorkflow}`;
  assert.doesNotMatch(combined, /actions\/(?:checkout|setup-node|upload-artifact)@v\d/);
  assert.match(combined, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7\.0\.1/g);
  assert.match(combined, /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7\.0\.0/);
  assert.match(combined, /actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7\.0\.1/g);
});
