import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { computeArtifactDigest, writeReleaseEvidence } from '../packages/shared/release-evidence.js';

const workflow = fs.readFileSync('.github/workflows/blackspire-ci.yml', 'utf8');
const validator = path.resolve('scripts/ci-validate-whitespace-range.sh');

function git(root, ...args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-ci-range-'));
  git(root, 'init', '-q'); git(root, 'config', 'user.email', 'ci@example.invalid'); git(root, 'config', 'user.name', 'CI Test');
  fs.writeFileSync(path.join(root, 'file.txt'), 'base\n'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'base');
  return root;
}

function validate(root, env) {
  return spawnSync('bash', [validator], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } });
}

test('CI cancels superseded runs and has read-only repository permissions', () => {
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.match(workflow, /concurrency:[\s\S]*cancel-in-progress: true/);
  assert.match(workflow, /github\.event\.pull_request\.number \|\| github\.ref/);
});

test('CI invokes the full-history trusted-range whitespace gate', () => {
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /BLACKSPIRE_CI_BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/);
  assert.match(workflow, /BLACKSPIRE_CI_BEFORE_SHA: \$\{\{ github\.event\.before \}\}/);
  assert.match(workflow, /bash scripts\/ci-validate-whitespace-range\.sh/);
  assert.match(workflow, /npm run production:preflight/);
  assert.match(workflow, /npm audit --audit-level=high/);
});

test('PR range catches retained whitespace from a non-tip trusted commit', () => {
  const root = repo(); const base = git(root, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, 'file.txt'), 'base\nretained trailing space \n'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'bad non-tip');
  fs.writeFileSync(path.join(root, 'second.txt'), 'clean tip\n'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'clean tip');
  const result = validate(root, { BLACKSPIRE_CI_EVENT_NAME: 'pull_request', BLACKSPIRE_CI_BASE_SHA: base });
  assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /trailing whitespace/);
});

test('trusted earlier boundary includes every stacked commit and excludes prior history', () => {
  const root = repo();
  fs.writeFileSync(path.join(root, 'old.txt'), 'historical trailing space \n'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'excluded history');
  const base = git(root, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, 'stack.txt'), 'one\n'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'stack one');
  fs.appendFileSync(path.join(root, 'stack.txt'), 'two\n'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'stack two');
  assert.equal(validate(root, { BLACKSPIRE_CI_EVENT_NAME: 'pull_request', BLACKSPIRE_CI_BASE_SHA: base }).status, 0);
});

test('malformed, missing, and non-ancestor trusted boundaries fail closed', () => {
  const root = repo();
  assert.notEqual(validate(root, { BLACKSPIRE_CI_EVENT_NAME: 'pull_request', BLACKSPIRE_CI_BASE_SHA: 'bad' }).status, 0);
  assert.notEqual(validate(root, { BLACKSPIRE_CI_EVENT_NAME: 'pull_request', BLACKSPIRE_CI_BASE_SHA: 'f'.repeat(40) }).status, 0);
  const base = git(root, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, 'main.txt'), 'main\n'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'main child');
  const main = git(root, 'rev-parse', 'HEAD'); git(root, 'checkout', '-qb', 'other', base);
  fs.writeFileSync(path.join(root, 'other.txt'), 'other\n'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'other');
  const unrelated = git(root, 'rev-parse', 'HEAD'); git(root, 'checkout', '-q', main);
  assert.notEqual(validate(root, { BLACKSPIRE_CI_EVENT_NAME: 'pull_request', BLACKSPIRE_CI_BASE_SHA: unrelated }).status, 0);
});

test('push validates the complete trusted before-to-head range', () => {
  const root = repo(); const before = git(root, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(root, 'bad.txt'), 'bad space \n'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'bad');
  fs.writeFileSync(path.join(root, 'tip.txt'), 'clean\n'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'tip');
  assert.notEqual(validate(root, { BLACKSPIRE_CI_EVENT_NAME: 'push', BLACKSPIRE_CI_BEFORE_SHA: before }).status, 0);
});

test('CI publishes commit, tree, runtime, and run identity metadata', () => {
  for (const field of ['git rev-parse HEAD', 'git rev-parse HEAD^{tree}', 'node --version', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'ci-artifacts/build-metadata.json']) {
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
    'GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'artifactDigest', 'nodeVersion',
    'expectedEnvironment', 'repository', 'buildId', 'computeArtifactDigest']) {
    assert.match(verifier, new RegExp(field.replace(/[{}^$.*+?()[\]\\|]/g, '\\$&')));
  }
  assert.match(verifier, /process\.exit\(1\)/);
  assert.doesNotMatch(workflow, /require\('\.\/ci-artifacts\/release-package\/RELEASE_EVIDENCE\.json'\).*artifact\.digest/,
    'CI metadata must independently hash the package rather than copy its manifest digest');
});

test('CI release artifact verifier independently detects package-tree mutation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-ci-artifact-'));
  const artifact = path.join(root, 'release-package');
  fs.mkdirSync(artifact);
  const commit = git(process.cwd(), 'rev-parse', 'HEAD');
  const tree = git(process.cwd(), 'rev-parse', 'HEAD^{tree}');
  fs.writeFileSync(path.join(artifact, 'COMMIT_SHA'), `${commit}\n`);
  fs.writeFileSync(path.join(artifact, 'package.json'), '{"version":"0.1.0"}\n');
  const common = { GITHUB_SHA: commit, GITHUB_REPOSITORY: 'houseomegakennels-bit/blackspire-helix-group',
    GITHUB_RUN_ID: '12345', GITHUB_RUN_ATTEMPT: '2' };
  const manifest = writeReleaseEvidence(artifact, { artifactRoot: artifact, commitSha: commit,
    expectedEnvironment: 'disposable-staging', buildTimestamp: '2026-08-24T00:00:00.000Z',
    sourceRef: 'refs/pull/1/merge', buildId: '12345.2', ciProvider: 'github-actions', ciRunId: '12345',
    artifactName: `blackspire-command-${commit}`, packageVersion: '0.1.0', nodeVersion: process.version,
    repository: common.GITHUB_REPOSITORY });
  const metadata = { repository: common.GITHUB_REPOSITORY,
    environment: 'disposable-staging', commit, tree, artifactDigest: computeArtifactDigest(artifact),
    node: process.version, runId: '12345', runAttempt: '2' };
  const writeMetadata = (value) => fs.writeFileSync(path.join(root, 'build-metadata.json'), `${JSON.stringify(value)}\n`);
  writeMetadata(metadata);
  const verify = () => spawnSync(process.execPath, ['scripts/verify-ci-release-artifact.js', root],
    { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, ...common } });
  assert.equal(verify().status, 0);
  writeMetadata({ ...metadata, repository: 'wrong/repository' });
  assert.notEqual(verify().status, 0);
  writeMetadata({ ...metadata, environment: 'production' });
  assert.notEqual(verify().status, 0);
  writeMetadata(metadata);
  fs.writeFileSync(path.join(artifact, 'package.json'), '{"version":"tampered"}\n');
  const rejected = verify();
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /release artifact verification failed/);
  assert.notEqual(computeArtifactDigest(artifact), manifest.artifact.digest);
});
