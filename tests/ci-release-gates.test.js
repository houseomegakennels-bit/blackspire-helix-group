import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync('.github/workflows/blackspire-ci.yml', 'utf8');

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
});
