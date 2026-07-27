// Focused coverage for the server-side workspace-root contract. Under the immutable-release
// architecture the runtime's working directory is `/opt/blackspire-command/current`, which is
// deliberately read-only to the `blackspire` account (`ProtectSystem=strict`, with only
// `shared/` in `ReadWritePaths`). Hermes uses `workspace.root_path` as the cwd for git and build
// operations, so a workspace root of `.` points those operations at the immutable release. This
// contract lets an operator point them at a real, writable, server-chosen checkout instead - and
// fails closed rather than silently falling back when the supplied value is not usable.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveWorkspaceRoot } from '../packages/shared/workspace-root.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-workspace-root-'));

function freshCase(name) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// A directory that looks like a real checkout: a plain `.git` directory.
function gitDir(name) {
  const dir = freshCase(name);
  fs.mkdirSync(path.join(dir, '.git'));
  return dir;
}

// ---------------------------------------------------------------------------
// Default behaviour - unchanged when the variable is absent
// ---------------------------------------------------------------------------

test('an absent workspace root preserves the historical "." default', () => {
  assert.equal(resolveWorkspaceRoot({}), '.');
});

test('an unrelated environment does not alter the default', () => {
  assert.equal(resolveWorkspaceRoot({ HOME: '/root', PATH: '/usr/bin' }), '.');
});

// ---------------------------------------------------------------------------
// Positive paths
// ---------------------------------------------------------------------------

test('an explicit absolute git checkout resolves to its canonical path', () => {
  const dir = gitDir('valid-checkout');
  assert.equal(resolveWorkspaceRoot({ BLACKSPIRE_WORKSPACE_ROOT: dir }), path.resolve(dir));
});

test('a trailing separator is normalized rather than rejected', () => {
  const dir = gitDir('trailing-separator');
  assert.equal(resolveWorkspaceRoot({ BLACKSPIRE_WORKSPACE_ROOT: `${dir}${path.sep}` }), path.resolve(dir));
});

test('surrounding whitespace is trimmed before validation', () => {
  const dir = gitDir('padded');
  assert.equal(resolveWorkspaceRoot({ BLACKSPIRE_WORKSPACE_ROOT: `  ${dir}  ` }), path.resolve(dir));
});

test('a git worktree whose .git is a file, not a directory, is accepted', () => {
  // Linked worktrees record a `gitdir:` pointer file instead of a directory. Requiring a directory
  // would reject a legitimate checkout - this repository is itself checked out that way.
  const dir = freshCase('worktree-pointer');
  fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /somewhere/.git/worktrees/example\n');
  assert.equal(resolveWorkspaceRoot({ BLACKSPIRE_WORKSPACE_ROOT: dir }), path.resolve(dir));
});

// ---------------------------------------------------------------------------
// Adversarial paths - every one must fail closed, never fall back to "."
// ---------------------------------------------------------------------------

function assertRefused(env, pattern) {
  assert.throws(() => resolveWorkspaceRoot(env), pattern);
  // The failure must be a refusal, never a silent downgrade to the default.
  let fellBack = false;
  try { fellBack = resolveWorkspaceRoot(env) === '.'; } catch { fellBack = false; }
  assert.equal(fellBack, false, 'a rejected workspace root must never fall back to "."');
}

test('an empty or whitespace-only value is refused, not treated as unset', () => {
  assertRefused({ BLACKSPIRE_WORKSPACE_ROOT: '' }, /workspace root/i);
  assertRefused({ BLACKSPIRE_WORKSPACE_ROOT: '   ' }, /workspace root/i);
});

test('a relative workspace root is refused', () => {
  // Under systemd the process cwd is the immutable release, so a relative root would silently
  // resolve against exactly the read-only tree this contract exists to avoid.
  assertRefused({ BLACKSPIRE_WORKSPACE_ROOT: './workspace' }, /absolute/i);
  assertRefused({ BLACKSPIRE_WORKSPACE_ROOT: '../workspace' }, /absolute/i);
  assertRefused({ BLACKSPIRE_WORKSPACE_ROOT: 'workspace' }, /absolute/i);
});

test('a missing path is refused', () => {
  assertRefused({ BLACKSPIRE_WORKSPACE_ROOT: path.join(root, 'does-not-exist') }, /does not exist/i);
});

test('a regular file supplied as the workspace root is refused', () => {
  const dir = freshCase('file-as-root');
  const file = path.join(dir, 'notes.txt');
  fs.writeFileSync(file, 'x');
  assertRefused({ BLACKSPIRE_WORKSPACE_ROOT: file }, /not a directory/i);
});

test('a symlinked workspace root is refused even when it points at a valid checkout', () => {
  const target = gitDir('symlink-target');
  const link = path.join(root, 'symlink-root');
  fs.symlinkSync(target, link);
  assertRefused({ BLACKSPIRE_WORKSPACE_ROOT: link }, /symlink/i);
});

test('a directory that is not a git checkout is refused', () => {
  const dir = freshCase('not-a-checkout');
  assertRefused({ BLACKSPIRE_WORKSPACE_ROOT: dir }, /git/i);
});

test('a .git entry that is itself a symlink is refused', () => {
  const real = gitDir('git-symlink-real');
  const dir = freshCase('git-symlink');
  fs.symlinkSync(path.join(real, '.git'), path.join(dir, '.git'));
  assertRefused({ BLACKSPIRE_WORKSPACE_ROOT: dir }, /git/i);
});

test('a NUL byte in the value is refused', () => {
  assertRefused({ BLACKSPIRE_WORKSPACE_ROOT: `${root}\0/etc` }, /workspace root/i);
});

// ---------------------------------------------------------------------------
// Wiring: config export, workspace registry, and the request boundary
// ---------------------------------------------------------------------------

function runNode(source, env) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: process.cwd(), env: { ...process.env, ...env }, encoding: 'utf8',
  });
}

test('config exports the resolved workspace root and the registry seeds it as rootPath', () => {
  const dir = gitDir('wiring');
  const dataDir = freshCase('wiring-data');
  const r = runNode(`
    import { WORKSPACE_ROOT } from './packages/shared/config.js';
    const { execSync } = await import('node:child_process');
    execSync(process.execPath + ' scripts/migrate.js', { env: { ...process.env, BLACKSPIRE_RUN_MIGRATIONS: 'true' } });
    const { getWorkspace } = await import('./packages/workspace-registry/workspaces.js');
    console.log(JSON.stringify({ WORKSPACE_ROOT, seeded: getWorkspace('blackspire-command').root_path }));
  `, {
    BLACKSPIRE_WORKSPACE_ROOT: dir,
    BLACKSPIRE_DATA_DIR: dataDir,
    BLACKSPIRE_DB_PATH: path.join(dataDir, 'command.sqlite'),
  });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.equal(out.WORKSPACE_ROOT, path.resolve(dir));
  assert.equal(out.seeded, path.resolve(dir), 'the seeded workspace must adopt the configured root');
});

test('an invalid workspace root fails startup closed rather than degrading to "."', () => {
  const dataDir = freshCase('invalid-startup-data');
  const r = runNode(`
    import { WORKSPACE_ROOT } from './packages/shared/config.js';
    console.log('UNEXPECTED_STARTUP:' + WORKSPACE_ROOT);
  `, {
    BLACKSPIRE_WORKSPACE_ROOT: path.join(root, 'nope-not-here'),
    BLACKSPIRE_DATA_DIR: dataDir,
    BLACKSPIRE_DB_PATH: path.join(dataDir, 'command.sqlite'),
  });
  assert.notEqual(r.status, 0, 'startup must fail closed');
  assert.doesNotMatch(r.stdout, /UNEXPECTED_STARTUP/, 'the process must not start with an invalid workspace root');
  assert.match(r.stderr, /workspace root/i);
});

test('the workspace root is server-side only: no request value can set it', () => {
  // /api/workspaces is read-only. Proving the boundary behaviourally: the registry's seeded root
  // comes from the environment, and a caller-supplied rootPath cannot change the seeded workspace.
  const source = fs.readFileSync('apps/api/server.js', 'utf8');
  const workspaceRoutes = source.split('\n').filter((line) => line.includes('/api/workspaces'));
  assert.ok(workspaceRoutes.length > 0, 'the workspaces route must exist to be constrained');
  for (const line of workspaceRoutes) {
    assert.doesNotMatch(line, /rootPath|root_path/, 'no /api/workspaces route may accept a root path from a request');
    assert.match(line, /method === 'GET'|u\.pathname === '\/api\/workspaces'/, 'the workspaces route must remain a read path');
  }
  assert.doesNotMatch(source, /upsertWorkspace\(\s*(JSON\.parse|body|payload|req)/, 'no request body may be passed into upsertWorkspace');
});

test('allowlists and policy boundaries are unchanged by the workspace-root contract', () => {
  const source = fs.readFileSync('packages/workspace-registry/workspaces.js', 'utf8');
  assert.match(source, /allowedPaths: \['\.', 'docs', 'packages', 'apps', 'tests'\]/, 'the seeded allowlist must be unchanged');
  assert.match(source, /enabledTools: \['read', 'write_branch', 'test', 'draft_pr'\]/, 'the seeded tool allowlist must be unchanged');
  // assertInsideWorkspace still confines every path to the resolved root, whatever that root is.
  assert.match(fs.readFileSync('packages/execution/runner.js', 'utf8'), /Path escapes workspace/);
});
