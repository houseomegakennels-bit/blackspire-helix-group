import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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
});
