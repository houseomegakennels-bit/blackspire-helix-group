import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-vps-readiness-'));
const node = process.execPath;
const runtimeAccountAvailable = spawnSync('id', ['blackspire'], { encoding: 'utf8' }).status === 0
  && spawnSync('getent', ['group', 'blackspire'], { encoding: 'utf8' }).status === 0;
const runtimeSkipReason = 'blackspire account/group is unavailable; real runtime-access assertions skipped';
const runtimeGid = Number(spawnSync('getent', ['group', 'blackspire'], { encoding: 'utf8' }).stdout.split(':')[2]);
const contractProbe = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-release-contract-probe-'));
const releaseContractAvailable = runtimeAccountAvailable
  && spawnSync('chown', ['root:blackspire', contractProbe], { encoding: 'utf8' }).status === 0;
fs.rmSync(contractProbe, { recursive: true, force: true });
const releaseContractSkipReason = 'host filesystem cannot apply root:blackspire ownership; immutable-release contract tests skipped';

function run(script, args, env = {}) {
  const command = script.endsWith('.sh') ? 'bash' : node;
  const childEnv = { ...process.env, ...env };
  delete childEnv.NODE_TEST_CONTEXT;
  return spawnSync(command, [script, ...args], { cwd: process.cwd(), env: childEnv, encoding: 'utf8' });
}

function releaseEnvironment(releaseRoot) {
  return {
    BLACKSPIRE_RELEASE_ROOT: releaseRoot,
    BLACKSPIRE_SOURCE_ROOT: process.cwd()
  };
}

function runAsBlackspire(script, args = []) {
  return spawnSync('runuser', ['-u', 'blackspire', '--', 'bash', '-c', script, 'blackspire', ...args], {
    cwd: process.cwd(), encoding: 'utf8'
  });
}

function assertImmutableTree(release) {
  for (const entry of fs.readdirSync(release, { recursive: true })) {
    const entryPath = path.join(release, entry);
    const stat = fs.lstatSync(entryPath);
    if (stat.isSymbolicLink()) continue;
    assert.equal(stat.uid, 0, `${entry} must be root-owned`);
    assert.equal(stat.gid, runtimeGid, `${entry} must be blackspire-group-owned`);
    if (stat.isDirectory()) assert.equal(stat.mode & 0o777, 0o755, `${entry} directory mode`);
    if (stat.isFile()) assert.ok([0o644, 0o755].includes(stat.mode & 0o777), `${entry} file mode`);
  }
}

test('WAL-safe backup and disposable restore preserve committed state and checksum', () => {
  const dbDir = path.join(root, 'state');
  const backupDir = path.join(root, 'backups');
  const dbPath = path.join(dbDir, 'command.sqlite');
  fs.mkdirSync(dbDir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE evidence(id TEXT PRIMARY KEY, value TEXT); INSERT INTO evidence VALUES (\'one\', \'redacted\');');
  db.close();
  const backed = run('scripts/backup.js', [backupDir], { BLACKSPIRE_DB_PATH: dbPath });
  assert.equal(backed.status, 0, backed.stderr);
  const record = JSON.parse(backed.stdout);
  assert.equal(fs.statSync(record.backup).mode & 0o777, 0o600);
  const restored = path.join(root, 'disposable', 'command.sqlite');
  const restoredResult = run('scripts/restore.js', [record.backup, restored], { BLACKSPIRE_DB_PATH: dbPath, NODE_ENV: 'test', BLACKSPIRE_DISPOSABLE_RESTORE: 'true' });
  assert.equal(restoredResult.status, 0, restoredResult.stderr);
  const check = new DatabaseSync(restored, { readOnly: true });
  assert.equal(check.prepare('SELECT value FROM evidence WHERE id=?').get('one').value, 'redacted');
  check.close();
  assert.match(fs.readFileSync(record.checksum, 'utf8'), /^[a-f0-9]{64}/);
});

test('release creation is exact, idempotent, and switching is atomic', { skip: releaseContractAvailable ? false : releaseContractSkipReason }, () => {
  const releaseRoot = path.join(root, 'releases');
  fs.mkdirSync(releaseRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(releaseRoot, 0o700);
  const shaResult = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' });
  assert.equal(shaResult.status, 0, shaResult.stderr);
  const sha = shaResult.stdout.trim();
  assert.match(sha, /^[0-9a-f]{40}$/);
  const env = releaseEnvironment(releaseRoot);
  const created = run('scripts/release-create.sh', [sha], env);
  assert.equal(created.status, 0, created.stderr);
  const release = created.stdout.trim();
  assert.equal(fs.readFileSync(path.join(release, 'COMMIT_SHA'), 'utf8').trim(), sha);
  assert.ok(fs.existsSync(path.join(release, '.release-complete')));
  const markerMtime = fs.statSync(path.join(release, '.release-complete')).mtimeMs;
  assert.equal(run('scripts/release-create.sh', [sha], env).stdout.trim(), release, 'completed release is idempotent');
  assert.equal(fs.statSync(path.join(release, '.release-complete')).mtimeMs, markerMtime, 'completed release is not mutated');
  assert.equal(fs.statSync(releaseRoot).mode & 0o777, 0o755);
  assert.equal(fs.statSync(releaseRoot).uid, 0);
  assert.equal(fs.statSync(releaseRoot).gid, runtimeGid);
  assert.equal(fs.statSync(path.join(releaseRoot, 'releases')).mode & 0o777, 0o755);
  assert.equal(fs.statSync(path.join(releaseRoot, 'releases')).uid, 0);
  assert.equal(fs.statSync(path.join(releaseRoot, 'releases')).gid, runtimeGid);
  assertImmutableTree(release);
  assert.equal(run('scripts/release-switch.sh', [sha], env).status, 0);
  assert.equal(fs.realpathSync(path.join(releaseRoot, 'current')), release);
});

test('immutable release grants real blackspire read/traverse/execute access and denies all writes', { skip: releaseContractAvailable ? false : (runtimeAccountAvailable ? releaseContractSkipReason : runtimeSkipReason) }, () => {
  const releaseRoot = path.join(root, 'runtime-access');
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).stdout.trim();
  fs.mkdirSync(releaseRoot, { recursive: true, mode: 0o700 });
  fs.chmodSync(releaseRoot, 0o700);
  fs.mkdirSync(path.join(releaseRoot, 'shared'), { recursive: true, mode: 0o700 });
  fs.chmodSync(path.join(releaseRoot, 'shared'), 0o700);
  const created = run('scripts/release-create.sh', [sha], releaseEnvironment(releaseRoot));
  assert.equal(created.status, 0, created.stderr);
  const release = created.stdout.trim();
  const releaseStat = fs.statSync(release);
  const serverStat = fs.statSync(path.join(release, 'apps', 'api', 'server.js'));
  const entryStat = fs.statSync(path.join(release, 'scripts', 'start-production.sh'));
  assert.equal(releaseStat.mode & 0o777, 0o755, 'runtime must traverse immutable release');
  assert.equal(serverStat.mode & 0o777, 0o644, 'ordinary application files must be readable but not executable');
  assert.equal(entryStat.mode & 0o777, 0o755, 'executable entrypoints retain execute bits');
  assertImmutableTree(release);
  const access = runAsBlackspire([
    'release="$1"',
    'test -x "$release"',
    'test -x "$release/apps/api"',
    'test -r "$release/apps/api/server.js"',
    'test -x "$release/scripts/start-production.sh"',
    'for op in "touch $release/write" "mkdir $release/dir" "printf x >> $release/COMMIT_SHA" "mv $release/COMMIT_SHA $release/moved" "rm $release/COMMIT_SHA" "chmod 0755 $release/COMMIT_SHA" "chown blackspire:blackspire $release/COMMIT_SHA" "ln -s COMMIT_SHA $release/link"; do if bash -c "$op"; then echo "unexpected runtime write: $op" >&2; exit 1; fi; done'
  ].join('\n'), [release]);
  assert.equal(access.status, 0, access.stderr);
  assert.equal(fs.statSync(path.join(releaseRoot, 'shared')).mode & 0o777, 0o700, 'release creation must not loosen shared state');
});

test('release creation rejects symlink roots and symlinked ancestors', () => {
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).stdout.trim();
  const realRoot = path.join(root, 'real-release-root');
  const symlinkRoot = path.join(root, 'symlink-release-root');
  fs.mkdirSync(realRoot, { recursive: true });
  fs.symlinkSync(realRoot, symlinkRoot);
  const linked = run('scripts/release-create.sh', [sha], releaseEnvironment(symlinkRoot));
  assert.notEqual(linked.status, 0);
  assert.match(linked.stderr, /contains symlink/);
  assert.equal(fs.existsSync(path.join(realRoot, 'releases')), false, 'a rejected release root must not be populated');

  const ancestorReal = path.join(root, 'ancestor-real');
  const ancestorLink = path.join(root, 'ancestor-link');
  fs.mkdirSync(ancestorReal);
  fs.symlinkSync(ancestorReal, ancestorLink);
  const ancestor = run('scripts/release-create.sh', [sha], releaseEnvironment(path.join(ancestorLink, 'release-root')));
  assert.notEqual(ancestor.status, 0);
  assert.match(ancestor.stderr, /contains symlink/);

});

test('release creation rejects a symlinked destination without mutating it', { skip: releaseContractAvailable ? false : releaseContractSkipReason }, () => {
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).stdout.trim();
  const destinationRoot = path.join(root, 'destination-root');
  fs.mkdirSync(destinationRoot, { recursive: true });
  const destination = path.join(destinationRoot, 'releases', sha);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.symlinkSync('/tmp', destination);
  const failed = run('scripts/release-create.sh', [sha], releaseEnvironment(destinationRoot));
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /destination must not be a symlink/);
  assert.equal(fs.readlinkSync(destination), '/tmp', 'existing destination is not mutated');
});

test('release creation removes only its incomplete artifact after post-copy failure', { skip: releaseContractAvailable ? false : releaseContractSkipReason }, () => {
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).stdout.trim();
  const failedRoot = path.join(root, 'failed-release-root');
  const shimDir = fs.mkdtempSync(path.join(root, 'chown-shim-'));
  const realChown = spawnSync('command', ['-v', 'chown'], { shell: true, encoding: 'utf8' }).stdout.trim() || '/usr/bin/chown';
  fs.writeFileSync(path.join(shimDir, 'chown'), `#!/usr/bin/env bash\nif [[ "$*" == *'.incomplete-'* ]]; then exit 97; fi\nexec ${realChown} "$@"\n`, { mode: 0o755 });
  const failed = run('scripts/release-create.sh', [sha], {
    ...releaseEnvironment(failedRoot), PATH: `${shimDir}:${process.env.PATH}`
  });
  assert.notEqual(failed.status, 0);
  const releases = path.join(failedRoot, 'releases');
  assert.equal(fs.existsSync(path.join(releases, sha)), false, 'failed ownership application must not promote a release');
  assert.deepEqual(fs.readdirSync(releases).filter((entry) => entry.includes('.incomplete-')), [], 'only incomplete artifacts are cleaned');
});

test('production verifier fails closed for provider credentials and test mode', () => {
  const env = { NODE_ENV: 'production', BLACKSPIRE_RUNTIME_MODE: 'production', BLACKSPIRE_STATE_OWNER: 'vps-production', BLACKSPIRE_DB_PATH: '/opt/blackspire-vps-readiness/command.sqlite', BLACKSPIRE_PROVIDER_MODE: 'manual', BLACKSPIRE_HERMES_MODE: 'restricted', COMMAND_ADMIN_TOKEN: 'x'.repeat(32), SESSION_SECRET: 'y'.repeat(40), OPENAI_API_KEY: 'forbidden' };
  const result = run('scripts/verify-environment.sh', ['vps-production'], env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /OPENAI_API_KEY/);
});
