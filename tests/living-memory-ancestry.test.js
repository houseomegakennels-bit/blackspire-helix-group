import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkerSource = fs.readFileSync(path.join(repoRoot, 'scripts', 'check-living-memory.sh'), 'utf8');
const gitBinary = '/usr/bin/git';
const trustedOrigin = 'https://github.com/houseomegakennels-bit/blackspire-helix-group.git';
const canonicalMemoryFiles = [
  'BLACKSPIRE_SOURCE_OF_TRUTH.md',
  'BLACKSPIRE_ACTIVE_CONTEXT.md',
  'BLACKSPIRE_NEXT_ACTIONS.md',
  'BLACKSPIRE_DECISIONS.md',
  'BLACKSPIRE_SESSION_LOG.md',
  'BLACKSPIRE_MEMORY_MAINTENANCE.md',
];
const activeFixtureRoots = new Set();

function removeFixtureRoot(root) {
  fs.rmSync(root, { recursive: true, force: true });
  activeFixtureRoots.delete(root);
}

process.on('exit', () => {
  for (const root of activeFixtureRoots) fs.rmSync(root, { recursive: true, force: true });
});

function command(binary, args, options = {}) {
  const result = spawnSync(binary, args, {
    encoding: 'utf8',
    timeout: 15_000,
    ...options,
  });
  // The Codex sandbox can attach an EPERM bookkeeping error after a child has actually run and
  // returned a real status. A null status is the authoritative spawn failure.
  assert.notEqual(result.status, null, `failed to spawn ${binary}: ${result.error?.message}`);
  return result;
}

function git(cwd, ...args) {
  const result = command(gitBinary, args, {
    cwd,
    env: {
      PATH: '/usr/bin:/bin',
      HOME: path.join(cwd, '.test-home'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      LC_ALL: 'C',
    },
  });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

function commitFile(repo, relative, contents, message) {
  fs.mkdirSync(path.dirname(path.join(repo, relative)), { recursive: true });
  fs.writeFileSync(path.join(repo, relative), contents);
  git(repo, 'add', '--', relative);
  git(repo, 'commit', '--quiet', '--no-gpg-sign', '-m', message);
  return git(repo, 'rev-parse', 'HEAD');
}

function writeMemory(repo, trustedMain, reviewed) {
  fs.mkdirSync(path.join(repo, 'docs'), { recursive: true });
  for (const file of canonicalMemoryFiles) {
    const body = file === 'BLACKSPIRE_SOURCE_OF_TRUTH.md'
      ? `# Blackspire Canonical Source of Truth

- Base \`origin/main\`: \`${trustedMain}\`
- Last verified implementation commit: \`${reviewed}\`
`
      : `# ${file}\n`;
    fs.writeFileSync(path.join(repo, 'docs', file), body);
  }
}

function installChecker(repo, source = checkerSource) {
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true });
  const checker = path.join(repo, 'scripts', 'check-living-memory.sh');
  fs.writeFileSync(checker, source, { mode: 0o755 });
  return checker;
}

function createFixture({ merge = false, directoryLabel = 'baseline', objectFormat = 'sha1' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `living memory ; metachar [${directoryLabel}] $-`));
  activeFixtureRoots.add(root);
  try {
    const repo = path.join(root, 'intended repository with spaces ; and $chars');
    fs.mkdirSync(repo);
    git(repo, 'init', '--quiet', '--initial-branch=main', `--object-format=${objectFormat}`);
    git(repo, 'config', '--local', 'user.name', 'Blackspire Test');
    git(repo, 'config', '--local', 'user.email', 'blackspire-test.invalid');
    git(repo, 'remote', 'add', 'origin', trustedOrigin);
    const base = commitFile(repo, 'history.txt', 'base\n', 'base');

    let reviewed;
    if (merge) {
      git(repo, 'switch', '--quiet', '-c', 'reviewed-feature');
      reviewed = commitFile(repo, 'reviewed.txt', 'reviewed\n', 'reviewed feature');
      git(repo, 'switch', '--quiet', 'main');
      commitFile(repo, 'main.txt', 'main advance\n', 'main advance');
      git(repo, 'merge', '--quiet', '--no-ff', '--no-gpg-sign', '-m', 'merge reviewed feature', 'reviewed-feature');
    } else {
      reviewed = commitFile(repo, 'reviewed.txt', 'reviewed\n', 'reviewed linear commit');
      commitFile(repo, 'main.txt', 'trusted main\n', 'trusted main advance');
    }
    const trustedMain = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'update-ref', 'refs/remotes/origin/main', trustedMain);
    git(repo, 'switch', '--quiet', '-c', 'memory-correction');
    writeMemory(repo, trustedMain, reviewed);
    installChecker(repo);
    git(repo, 'add', '--', 'docs', 'scripts/check-living-memory.sh');
    git(repo, 'commit', '--quiet', '--no-gpg-sign', '-m', 'memory correction');
    return { root, repo, base, reviewed, trustedMain, checker: path.join(repo, 'scripts', 'check-living-memory.sh') };
  } catch (error) {
    removeFixtureRoot(root);
    throw error;
  }
}

function runChecker(fixture, { cwd = fixture.repo, env = {}, checker = fixture.checker } = {}) {
  return command('/usr/bin/bash', [checker], {
    cwd,
    env: {
      PATH: '/usr/bin:/bin',
      HOME: path.join(fixture.root, 'caller-home'),
      LC_ALL: 'C',
      ...env,
    },
  });
}

function assertPass(result) {
  assert.equal(result.status, 0, `expected pass:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(result.stdout, /LIVING_MEMORY_RESULT: PASS/);
}

function assertFail(result, diagnostic) {
  assert.notEqual(result.status, 0, `expected failure:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(`LIVING_MEMORY_ERROR: ${diagnostic}(?:\\b|:)`));
  assert.doesNotMatch(result.stdout, /LIVING_MEMORY_RESULT: PASS/);
}

function withFixture(options, callback) {
  const fixture = createFixture(options);
  try {
    callback(fixture);
  } finally {
    removeFixtureRoot(fixture.root);
  }
}

test('living memory: valid linear reviewed ancestry passes', () => {
  withFixture({}, (fixture) => assertPass(runChecker(fixture)));
});

test('living memory: valid reviewed merge ancestry passes', () => {
  withFixture({ merge: true }, (fixture) => assertPass(runChecker(fixture)));
});

test('living memory: canonical full SHA-256 object IDs pass in a SHA-256 repository', () => {
  withFixture({ objectFormat: 'sha256' }, (fixture) => {
    assert.equal(fixture.reviewed.length, 64);
    assert.equal(fixture.trustedMain.length, 64);
    assertPass(runChecker(fixture));
  });
});

test('living memory: abbreviated SHA-256 object IDs fail closed', () => {
  withFixture({ objectFormat: 'sha256' }, (fixture) => {
    writeMemory(fixture.repo, fixture.trustedMain, fixture.reviewed.slice(0, 40));
    assertFail(runChecker(fixture), 'INVALID_RECORDED_COMMIT');
  });
});

test('living memory: missing recorded commit fails closed', () => {
  withFixture({}, (fixture) => {
    writeMemory(fixture.repo, fixture.trustedMain, '1'.repeat(40));
    assertFail(runChecker(fixture), 'RECORDED_COMMIT_MISSING');
  });
});

test('living memory: missing trusted main ref fails closed', () => {
  withFixture({}, (fixture) => {
    git(fixture.repo, 'update-ref', '-d', 'refs/remotes/origin/main');
    assertFail(runChecker(fixture), 'TRUSTED_MAIN_REF_MISSING');
  });
});

test('living memory: missing trusted origin remote fails closed', () => {
  withFixture({}, (fixture) => {
    git(fixture.repo, 'remote', 'remove', 'origin');
    assertFail(runChecker(fixture), 'GIT_OPERATION_FAILED');
  });
});

test('living memory: repointed origin/main fails closed', () => {
  withFixture({}, (fixture) => {
    git(fixture.repo, 'update-ref', 'refs/remotes/origin/main', fixture.base);
    assertFail(runChecker(fixture), 'TRUSTED_MAIN_MISMATCH');
  });
});

test('living memory: reverse ancestry fails closed', () => {
  withFixture({}, (fixture) => {
    const descendant = git(fixture.repo, 'rev-parse', 'HEAD');
    writeMemory(fixture.repo, fixture.trustedMain, descendant);
    assertFail(runChecker(fixture), 'REVIEWED_COMMIT_NOT_ANCESTOR');
  });
});

test('living memory: divergent history fails closed', () => {
  withFixture({}, (fixture) => {
    git(fixture.repo, 'switch', '--quiet', '--orphan', 'divergent-source');
    const divergent = commitFile(fixture.repo, 'divergent.txt', 'divergent\n', 'divergent');
    git(fixture.repo, 'switch', '--quiet', 'memory-correction');
    writeMemory(fixture.repo, fixture.trustedMain, divergent);
    assertFail(runChecker(fixture), 'REVIEWED_COMMIT_NOT_ANCESTOR');
  });
});

test('living memory: unrelated history fails closed', () => {
  withFixture({}, (fixture) => {
    const other = path.join(fixture.root, 'unrelated');
    fs.mkdirSync(other);
    git(other, 'init', '--quiet', '--initial-branch=main');
    git(other, 'config', '--local', 'user.name', 'Test');
    git(other, 'config', '--local', 'user.email', 'test.invalid');
    const unrelated = commitFile(other, 'other.txt', 'other\n', 'other');
    git(fixture.repo, 'fetch', '--quiet', other, `${unrelated}:refs/heads/unrelated-import`);
    writeMemory(fixture.repo, fixture.trustedMain, unrelated);
    assertFail(runChecker(fixture), 'REVIEWED_COMMIT_NOT_ANCESTOR');
  });
});

test('living memory: orphaned history fails closed', () => {
  withFixture({}, (fixture) => {
    git(fixture.repo, 'switch', '--quiet', '--orphan', 'orphan');
    const orphan = commitFile(fixture.repo, 'orphan.txt', 'orphan\n', 'orphan');
    git(fixture.repo, 'switch', '--quiet', 'memory-correction');
    writeMemory(fixture.repo, fixture.trustedMain, orphan);
    assertFail(runChecker(fixture), 'REVIEWED_COMMIT_NOT_ANCESTOR');
  });
});

test('living memory: rewritten reviewed history fails closed', () => {
  withFixture({}, (fixture) => {
    git(fixture.repo, 'switch', '--quiet', '-c', 'rewritten', fixture.base);
    const rewritten = commitFile(fixture.repo, 'reviewed.txt', 'rewritten\n', 'rewritten review');
    git(fixture.repo, 'switch', '--quiet', 'memory-correction');
    writeMemory(fixture.repo, fixture.trustedMain, rewritten);
    assertFail(runChecker(fixture), 'REVIEWED_COMMIT_NOT_ANCESTOR');
  });
});

test('living memory: shallow or incomplete history fails explicitly', () => {
  const source = createFixture({ directoryLabel: 'shallow-source' });
  const shallowRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'living-memory-shallow-clone-'));
  try {
    const clone = path.join(shallowRoot, 'clone');
    const result = command(gitBinary, ['clone', '--quiet', '--depth=1', `file://${source.repo}`, clone], {
      env: { PATH: '/usr/bin:/bin', HOME: shallowRoot, GIT_CONFIG_NOSYSTEM: '1' },
    });
    assert.equal(result.status, 0, result.stderr);
    git(clone, 'remote', 'set-url', 'origin', trustedOrigin);
    git(clone, 'config', '--local', '--unset-all', 'remote.origin.fetch');
    git(clone, 'config', '--local', '--add', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
    git(clone, 'update-ref', 'refs/remotes/origin/main', git(clone, 'rev-parse', 'HEAD'));
    writeMemory(clone, git(clone, 'rev-parse', 'HEAD'), git(clone, 'rev-parse', 'HEAD'));
    installChecker(clone);
    assertFail(runChecker({ root: shallowRoot, repo: clone, checker: path.join(clone, 'scripts', 'check-living-memory.sh') }), 'SHALLOW_REPOSITORY');
  } finally {
    removeFixtureRoot(source.root);
    fs.rmSync(shallowRoot, { recursive: true, force: true });
  }
});

const invalidRecordedValues = [
  ['empty value', ''],
  ['whitespace-padded value', ` ${'a'.repeat(40)} `],
  ['abbreviated object ID', 'a'.repeat(12)],
  ['symbolic HEAD revision', 'HEAD'],
  ['symbolic branch revision', 'main'],
  ['symbolic tag revision', 'refs/tags/reviewed'],
  ['caret revision expression', `${'a'.repeat(40)}^`],
  ['tilde revision expression', `${'a'.repeat(40)}~1`],
  ['colon revision expression', `${'a'.repeat(40)}:file`],
  ['reflog revision expression', 'HEAD@{1}'],
  ['two-dot revision range', 'HEAD..main'],
  ['three-dot revision range', 'HEAD...main'],
  ['malformed hexadecimal value', 'z'.repeat(40)],
  ['option-like value', '--help'],
  ['shell-content value', '$(touch SHOULD_NOT_EXIST)'],
  ['semicolon shell-content value', 'HEAD; touch SHOULD_NOT_EXIST'],
];

for (const [name, value] of invalidRecordedValues) {
  test(`living memory: rejects ${name}`, () => {
    withFixture({}, (fixture) => {
      writeMemory(fixture.repo, fixture.trustedMain, value);
      assertFail(runChecker(fixture), 'INVALID_RECORDED_COMMIT');
      assert.equal(fs.existsSync(path.join(fixture.repo, 'SHOULD_NOT_EXIST')), false);
    });
  });
}

test('living memory: rejects a noncanonical uppercase full object ID', () => {
  withFixture({}, (fixture) => {
    writeMemory(fixture.repo, fixture.trustedMain, fixture.reviewed.toUpperCase());
    assertFail(runChecker(fixture), 'INVALID_RECORDED_COMMIT');
  });
});

test('living memory: rejects an ambiguous symbolic ref without resolving it', () => {
  withFixture({}, (fixture) => {
    git(fixture.repo, 'branch', 'collision', fixture.reviewed);
    git(fixture.repo, 'tag', 'collision', fixture.trustedMain);
    writeMemory(fixture.repo, fixture.trustedMain, 'collision');
    assertFail(runChecker(fixture), 'INVALID_RECORDED_COMMIT');
  });
});

test('living memory: hostile current repository cannot redirect the checker', () => {
  withFixture({}, (fixture) => {
    const hostile = path.join(fixture.root, 'hostile current repository');
    fs.mkdirSync(hostile);
    git(hostile, 'init', '--quiet', '--initial-branch=main');
    git(hostile, 'config', '--local', 'user.name', 'Hostile');
    git(hostile, 'config', '--local', 'user.email', 'hostile.invalid');
    commitFile(hostile, 'hostile.txt', 'hostile\n', 'hostile');
    assertPass(runChecker(fixture, { cwd: hostile }));
  });
});

test('living memory: hostile origin URL fails closed', () => {
  withFixture({}, (fixture) => {
    git(fixture.repo, 'remote', 'set-url', 'origin', 'https://example.invalid/attacker/repository.git');
    assertFail(runChecker(fixture), 'UNTRUSTED_ORIGIN_URL');
  });
});

test('living memory: hostile origin fetch refspec fails closed', () => {
  withFixture({}, (fixture) => {
    git(fixture.repo, 'config', '--local', '--unset-all', 'remote.origin.fetch');
    git(fixture.repo, 'config', '--local', '--add', 'remote.origin.fetch', '+refs/heads/evil:refs/remotes/origin/main');
    assertFail(runChecker(fixture), 'UNTRUSTED_ORIGIN_FETCH_REFSPEC');
  });
});

test('living memory: hostile PATH and substituted git executable cannot control the result', () => {
  withFixture({}, (fixture) => {
    const hostileBin = path.join(fixture.root, 'hostile-bin');
    fs.mkdirSync(hostileBin);
    fs.writeFileSync(path.join(hostileBin, 'git'), '#!/usr/bin/env bash\necho HOSTILE_GIT_EXECUTED\nexit 0\n', { mode: 0o755 });
    const marker = path.join(fixture.root, 'git-wrapper-ran');
    fs.writeFileSync(path.join(hostileBin, 'git-upload-pack'), `#!/usr/bin/env bash\ntouch ${JSON.stringify(marker)}\nexit 0\n`, { mode: 0o755 });
    const result = runChecker(fixture, {
      env: {
        PATH: `${hostileBin}:/usr/bin:/bin`,
        GIT_EXEC_PATH: hostileBin,
        BLACKSPIRE_GIT_BIN: path.join(hostileBin, 'git'),
      },
    });
    assertPass(result);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /HOSTILE_GIT_EXECUTED/);
    assert.equal(fs.existsSync(marker), false);
  });
});

test('living memory: Git subprocess failure is named and is not reported as not-ancestor', () => {
  withFixture({}, (fixture) => {
    fs.appendFileSync(path.join(fixture.repo, '.git', 'config'), '\n[broken\n');
    const result = runChecker(fixture);
    assertFail(result, 'GIT_OPERATION_FAILED');
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /REVIEWED_COMMIT_NOT_ANCESTOR/);
  });
});

test('living memory: replace refs fail closed and cannot forge ancestry', () => {
  withFixture({}, (fixture) => {
    git(fixture.repo, 'replace', fixture.reviewed, fixture.trustedMain);
    assertFail(runChecker(fixture), 'REPLACEMENT_HISTORY_PRESENT');
  });
});

test('living memory: graft history fails closed', () => {
  withFixture({}, (fixture) => {
    const grafts = path.join(fixture.repo, '.git', 'info', 'grafts');
    fs.mkdirSync(path.dirname(grafts), { recursive: true });
    fs.writeFileSync(grafts, `${fixture.trustedMain} ${fixture.reviewed}\n`);
    assertFail(runChecker(fixture), 'GRAFT_HISTORY_PRESENT');
  });
});

test('living memory: global system and user Git configuration cannot interfere', () => {
  withFixture({}, (fixture) => {
    const hostileHome = path.join(fixture.root, 'hostile-home');
    fs.mkdirSync(hostileHome);
    const hostileConfig = path.join(fixture.root, 'hostile-system.gitconfig');
    fs.writeFileSync(path.join(hostileHome, '.gitconfig'), '[core]\n  graftsFile = /attacker/grafts\n[protocol "file"]\n  allow = always\n');
    fs.writeFileSync(hostileConfig, '[url "https://attacker.invalid/"]\n  insteadOf = https://github.com/\n');
    assertPass(runChecker(fixture, {
      env: {
        HOME: hostileHome,
        GIT_CONFIG_GLOBAL: path.join(hostileHome, '.gitconfig'),
        GIT_CONFIG_SYSTEM: hostileConfig,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.graftsFile',
        GIT_CONFIG_VALUE_0: '/attacker/grafts',
      },
    }));
  });
});

test('living memory: object alternates fail closed', () => {
  withFixture({}, (fixture) => {
    const alternates = path.join(fixture.repo, '.git', 'objects', 'info', 'alternates');
    fs.mkdirSync(path.dirname(alternates), { recursive: true });
    fs.writeFileSync(alternates, '/attacker/objects\n');
    assertFail(runChecker(fixture), 'OBJECT_ALTERNATES_PRESENT');
  });
});

test('living memory: attacker-controlled alternate environment is ignored', () => {
  withFixture({}, (fixture) => {
    assertPass(runChecker(fixture, {
      env: {
        GIT_ALTERNATE_OBJECT_DIRECTORIES: '/attacker/objects',
        GIT_OBJECT_DIRECTORY: '/attacker/objects',
        GIT_DIR: '/attacker/repository.git',
        GIT_WORK_TREE: '/attacker/worktree',
        GIT_COMMON_DIR: '/attacker/common',
        GIT_REPLACE_REF_BASE: 'refs/attacker/',
      },
    }));
  });
});

test('negative proof: reversing the exact ancestry direction makes the reverse-history test fail', () => {
  withFixture({}, (fixture) => {
    const descendant = git(fixture.repo, 'rev-parse', 'HEAD');
    writeMemory(fixture.repo, fixture.trustedMain, descendant);
    assertFail(runChecker(fixture), 'REVIEWED_COMMIT_NOT_ANCESTOR');
    const weakened = checkerSource.replace(
      '# SECURITY_CHECK: exact-ancestry-direction',
      'reviewed_commit_tmp="$reviewed_commit"; reviewed_commit="$trusted_main_commit"; trusted_main_commit="$reviewed_commit_tmp"\n# SECURITY_CHECK: exact-ancestry-direction',
    );
    const checker = installChecker(fixture.repo, weakened);
    assertPass(runChecker(fixture, { checker }));
  });
});

test('negative proof: removing canonical object-ID validation makes a symbolic revision pass', () => {
  withFixture({}, (fixture) => {
    writeMemory(fixture.repo, fixture.trustedMain, 'HEAD');
    assertFail(runChecker(fixture), 'INVALID_RECORDED_COMMIT');
    const weakened = checkerSource.replace(
      '# SECURITY_CHECK: canonical-object-id',
      'reviewed_commit="$recorded_base"\n# SECURITY_CHECK: canonical-object-id',
    );
    const checker = installChecker(fixture.repo, weakened);
    assertPass(runChecker(fixture, { checker }));
  });
});

test('negative proof: removing remote identity binding makes a hostile remote pass', () => {
  withFixture({}, (fixture) => {
    git(fixture.repo, 'remote', 'set-url', 'origin', 'https://attacker.invalid/repository.git');
    assertFail(runChecker(fixture), 'UNTRUSTED_ORIGIN_URL');
    const weakened = checkerSource.replace(
      '# SECURITY_CHECK: trusted-origin-url',
      'origin_url="$TRUSTED_ORIGIN_URL"\n# SECURITY_CHECK: trusted-origin-url',
    );
    const checker = installChecker(fixture.repo, weakened);
    assertPass(runChecker(fixture, { checker }));
  });
});

test('negative proof: removing replacement-history rejection makes a replacement fixture pass', () => {
  withFixture({}, (fixture) => {
    git(fixture.repo, 'replace', fixture.reviewed, fixture.trustedMain);
    assertFail(runChecker(fixture), 'REPLACEMENT_HISTORY_PRESENT');
    const weakened = checkerSource.replace(
      '# SECURITY_CHECK: reject-replacement-history',
      'replacement_refs=""\n# SECURITY_CHECK: reject-replacement-history',
    );
    const checker = installChecker(fixture.repo, weakened);
    assertPass(runChecker(fixture, { checker }));
  });
});

test('negative proof: removing origin/main equality lets a repointed trusted ref pass', () => {
  withFixture({}, (fixture) => {
    git(fixture.repo, 'update-ref', 'refs/remotes/origin/main', fixture.base);
    assertFail(runChecker(fixture), 'TRUSTED_MAIN_MISMATCH');
    const weakened = checkerSource.replace(
      '# SECURITY_CHECK: trusted-main-equality',
      'trusted_main_commit="$recorded_base"\n# SECURITY_CHECK: trusted-main-equality',
    );
    const checker = installChecker(fixture.repo, weakened);
    assertPass(runChecker(fixture, { checker }));
  });
});
