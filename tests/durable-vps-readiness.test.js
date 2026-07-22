import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-vps-readiness-'));
const node = process.execPath;
const fixtureOwner = spawnSync('id', ['-un'], { encoding: 'utf8' }).stdout.trim();
const fixtureGroup = spawnSync('id', ['-gn'], { encoding: 'utf8' }).stdout.trim();

function run(script, args, env = {}) {
  const command = script.endsWith('.sh') ? 'bash' : node;
  return spawnSync(command, [script, ...args], { cwd: process.cwd(), env: { ...process.env, ...env }, encoding: 'utf8' });
}

function releaseEnvironment(releaseRoot) {
  return {
    BLACKSPIRE_RELEASE_ROOT: releaseRoot,
    BLACKSPIRE_SOURCE_ROOT: process.cwd(),
    BLACKSPIRE_RELEASE_OWNER: fixtureOwner,
    BLACKSPIRE_RELEASE_GROUP: fixtureGroup
  };
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

test('release creation is exact, idempotent, and switching is atomic', () => {
  const releaseRoot = path.join(root, 'releases');
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
  assert.equal(run('scripts/release-create.sh', [sha], env).stdout.trim(), release);
  assert.equal(run('scripts/release-switch.sh', [sha], env).status, 0);
  assert.equal(fs.realpathSync(path.join(releaseRoot, 'current')), release);
});

test('immutable release grants runtime read/traverse access without runtime write access', () => {
  const releaseRoot = path.join(root, 'runtime-access');
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).stdout.trim();
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
  for (const entry of fs.readdirSync(release, { recursive: true })) {
    const stat = fs.lstatSync(path.join(release, entry));
    if (stat.isSymbolicLink()) continue;
    assert.equal(stat.mode & 0o022, 0, `${entry} must not be writable by group or other`);
  }
  assert.equal(fs.statSync(path.join(releaseRoot, 'shared')).mode & 0o777, 0o700, 'release creation must not loosen shared state');
});

test('release creation rejects symlink roots and removes incomplete artifacts on ownership failure', () => {
  const sha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: process.cwd(), encoding: 'utf8' }).stdout.trim();
  const realRoot = path.join(root, 'real-release-root');
  const symlinkRoot = path.join(root, 'symlink-release-root');
  fs.mkdirSync(realRoot, { recursive: true });
  fs.symlinkSync(realRoot, symlinkRoot);
  const linked = run('scripts/release-create.sh', [sha], releaseEnvironment(symlinkRoot));
  assert.notEqual(linked.status, 0);
  assert.match(linked.stderr, /must not be a symlink/);
  assert.equal(fs.existsSync(path.join(realRoot, 'releases')), false, 'a rejected release root must not be populated');

  const failedRoot = path.join(root, 'failed-release-root');
  const failed = run('scripts/release-create.sh', [sha], {
    ...releaseEnvironment(failedRoot),
    BLACKSPIRE_RELEASE_OWNER: '__blackspire_missing_owner__'
  });
  assert.notEqual(failed.status, 0);
  const releases = path.join(failedRoot, 'releases');
  assert.equal(fs.existsSync(path.join(releases, sha)), false, 'failed ownership application must not promote a release');
  assert.deepEqual(fs.readdirSync(releases).filter((entry) => entry.includes('.incomplete-')), [], 'failed ownership application must clean incomplete artifacts');
});

test('production verifier fails closed for provider credentials and test mode', () => {
  const env = { NODE_ENV: 'production', BLACKSPIRE_RUNTIME_MODE: 'production', BLACKSPIRE_STATE_OWNER: 'vps-production', BLACKSPIRE_DB_PATH: '/opt/blackspire-vps-readiness/command.sqlite', BLACKSPIRE_PROVIDER_MODE: 'manual', BLACKSPIRE_HERMES_MODE: 'restricted', COMMAND_ADMIN_TOKEN: 'x'.repeat(32), SESSION_SECRET: 'y'.repeat(40), OPENAI_API_KEY: 'forbidden' };
  const result = run('scripts/verify-environment.sh', ['vps-production'], env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /OPENAI_API_KEY/);
});
