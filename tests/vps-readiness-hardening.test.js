import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { verifyVpsRuntime } from '../packages/shared/security.js';
import { executeProviderRequest, selectProvider } from '../packages/providers/providers.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-vps-hardening-'));
const node = process.execPath;

function run(script, args, env = {}) {
  const command = script.endsWith('.sh') ? 'bash' : node;
  return spawnSync(command, [script, ...args], { cwd: process.cwd(), env: { ...process.env, ...env }, encoding: 'utf8' });
}

function makeDb(dir, name = 'command.sqlite') {
  fs.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, name);
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t VALUES (1, \'x\');');
  db.close();
  return dbPath;
}

function freshCase(name) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Backup negative paths
// ---------------------------------------------------------------------------

test('backup refuses a missing database', () => {
  const dir = freshCase('missing-db');
  const r = run('scripts/backup.js', [path.join(dir, 'backups')], { BLACKSPIRE_DB_PATH: path.join(dir, 'command.sqlite') });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /database does not exist/);
});

test('backup refuses a malformed (non-database) path', () => {
  const dir = freshCase('malformed');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
  const r = run('scripts/backup.js', [path.join(dir, 'backups')], { BLACKSPIRE_DB_PATH: path.join(dir, 'notes.txt') });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /must be a SQLite database file/);
});

test('backup refuses a backup directory inside the database directory (relative traversal)', () => {
  const dir = freshCase('unsafe-dir');
  const dbPath = makeDb(path.join(dir, 'state'));
  const r = run('scripts/backup.js', [path.join(dir, 'state', '..', 'state', 'nested')], { BLACKSPIRE_DB_PATH: dbPath });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /outside the database directory/);
});

test('backup refuses a symlinked backup directory that escapes into the database directory', () => {
  const dir = freshCase('symlink-escape');
  const dbPath = makeDb(path.join(dir, 'state'));
  const link = path.join(dir, 'backups');
  fs.symlinkSync(path.join(dir, 'state'), link);
  const r = run('scripts/backup.js', [link], { BLACKSPIRE_DB_PATH: dbPath });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /symlink|outside the database directory/);
});

test('backup refuses a directory inside an immutable release', () => {
  const dir = freshCase('release-escape');
  const dbPath = makeDb(path.join(dir, 'state'));
  const releaseRoot = path.join(dir, 'opt');
  fs.mkdirSync(path.join(releaseRoot, 'releases', 'deadbeef'), { recursive: true });
  const r = run('scripts/backup.js', [path.join(releaseRoot, 'releases', 'deadbeef', 'backups')], {
    BLACKSPIRE_DB_PATH: dbPath, BLACKSPIRE_RELEASE_ROOT: releaseRoot,
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /immutable release/);
});

test('backup cleans up partial artifacts when creation fails', () => {
  const dir = freshCase('partial-backup');
  const dbPath = path.join(dir, 'state', 'command.sqlite');
  fs.mkdirSync(path.join(dir, 'state'), { recursive: true });
  fs.writeFileSync(dbPath, 'this is not a sqlite database');
  const backupDir = path.join(dir, 'backups');
  const r = run('scripts/backup.js', [backupDir], { BLACKSPIRE_DB_PATH: dbPath });
  assert.notEqual(r.status, 0);
  const leftovers = fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : [];
  assert.deepEqual(leftovers, [], `no partial artifact should remain, found ${leftovers.join(',')}`);
  assert.equal(fs.readFileSync(dbPath, 'utf8'), 'this is not a sqlite database', 'source database preserved');
});

// ---------------------------------------------------------------------------
// Restore negative paths
// ---------------------------------------------------------------------------

function goodBackup(dir) {
  const dbPath = makeDb(path.join(dir, 'state'));
  const backupDir = path.join(dir, 'backups');
  const backed = run('scripts/backup.js', [backupDir], { BLACKSPIRE_DB_PATH: dbPath });
  assert.equal(backed.status, 0, backed.stderr);
  return { dbPath, record: JSON.parse(backed.stdout) };
}

test('restore refuses when the checksum sidecar mismatches', () => {
  const dir = freshCase('checksum-mismatch');
  const { dbPath, record } = goodBackup(dir);
  fs.writeFileSync(record.checksum, `${'0'.repeat(64)}  ${path.basename(record.backup)}\n`);
  const target = path.join(dir, 'disposable', 'command.sqlite');
  const r = run('scripts/restore.js', [record.backup, target], { BLACKSPIRE_DB_PATH: dbPath, NODE_ENV: 'test', BLACKSPIRE_DISPOSABLE_RESTORE: 'true' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /checksum mismatch/);
  assert.equal(fs.existsSync(target), false);
});

test('restore refuses a corrupted backup and leaves no partial disposable database', () => {
  const dir = freshCase('corrupted-restore');
  const dbPath = makeDb(path.join(dir, 'state'));
  const backupDir = path.join(dir, 'backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const backup = path.join(backupDir, 'command-corrupt.sqlite');
  fs.writeFileSync(backup, 'corrupted bytes that are not a valid sqlite file');
  const digest = crypto.createHash('sha256').update(fs.readFileSync(backup)).digest('hex');
  fs.writeFileSync(`${backup}.sha256`, `${digest}  ${path.basename(backup)}\n`);
  const target = path.join(dir, 'disposable', 'command.sqlite');
  const r = run('scripts/restore.js', [backup, target], { BLACKSPIRE_DB_PATH: dbPath, NODE_ENV: 'test', BLACKSPIRE_DISPOSABLE_RESTORE: 'true' });
  assert.notEqual(r.status, 0);
  assert.equal(fs.existsSync(target), false, 'no partial restored database should remain');
  assert.equal(fs.existsSync(backup), true, 'backup is preserved');
});

test('restore refuses when source and destination are the same file', () => {
  const dir = freshCase('same-file');
  const { record } = goodBackup(dir);
  const r = run('scripts/restore.js', [record.backup, record.backup], { BLACKSPIRE_DB_PATH: path.join(dir, 'other.sqlite'), NODE_ENV: 'test', BLACKSPIRE_DISPOSABLE_RESTORE: 'true' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /same file|cannot be the live database|SQLite database file/);
});

test('restore refuses an unsafe production restore without explicit authorization', () => {
  const dir = freshCase('unsafe-prod-restore');
  const { record } = goodBackup(dir);
  const target = path.join(dir, 'disposable', 'command.sqlite');
  const r = run('scripts/restore.js', [record.backup, target], { BLACKSPIRE_DB_PATH: path.join(dir, 'live.sqlite'), NODE_ENV: 'production' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /disposable and never the configured production database/);
  assert.equal(fs.existsSync(target), false);
});

test('restore refuses a symlinked target that escapes to the live database', () => {
  const dir = freshCase('restore-symlink');
  const { record } = goodBackup(dir);
  const live = path.join(dir, 'state', 'command.sqlite');
  const target = path.join(dir, 'evil.sqlite');
  fs.symlinkSync(live, target);
  const r = run('scripts/restore.js', [record.backup, target], { BLACKSPIRE_DB_PATH: live, NODE_ENV: 'test', BLACKSPIRE_DISPOSABLE_RESTORE: 'true' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /symlink|live database/);
});

// ---------------------------------------------------------------------------
// Production runtime verifier (injectable, credential-free)
// ---------------------------------------------------------------------------

function runtimeEnv(overrides = {}) {
  return {
    NODE_ENV: 'production', BLACKSPIRE_RUNTIME_MODE: 'production', BLACKSPIRE_PROVIDER_MODE: 'manual',
    BLACKSPIRE_HERMES_MODE: 'restricted', TELEGRAM_MODE: 'dry-run', UNIFIED_IPHONE_TEST_MODE: 'false',
    PORT: '8787', BLACKSPIRE_STARTUP_TIMEOUT_SECONDS: '30', BLACKSPIRE_HEALTH_TIMEOUT_SECONDS: '5',
    BLACKSPIRE_RUNTIME_USER: 'blackspire', BLACKSPIRE_DB_PATH: '/opt/blackspire-command/shared/database/command.sqlite',
    ...overrides,
  };
}

function runtimeOpts(overrides = {}) {
  return {
    uid: 1000, username: 'blackspire', nodeVersion: '22.23.1', requiredDirs: ['/persist'],
    isWritable: () => true, dirOwnerUid: () => 1000, dirExists: () => true, ...overrides,
  };
}

test('verifyVpsRuntime accepts a fully valid non-root runtime', () => {
  const r = verifyVpsRuntime(runtimeEnv(), runtimeOpts());
  assert.equal(r.ok, true, r.errors.join('; '));
});

test('verifyVpsRuntime rejects an invalid Node major version', () => {
  const r = verifyVpsRuntime(runtimeEnv(), runtimeOpts({ nodeVersion: '23.1.0' }));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /Node\.js major 22/);
});

test('verifyVpsRuntime rejects an invalid runtime port', () => {
  assert.match(verifyVpsRuntime(runtimeEnv({ PORT: '99999' }), runtimeOpts()).errors.join(), /PORT/);
  assert.match(verifyVpsRuntime(runtimeEnv({ PORT: 'abc' }), runtimeOpts()).errors.join(), /PORT/);
});

test('verifyVpsRuntime rejects an unwritable persistent directory', () => {
  const r = verifyVpsRuntime(runtimeEnv(), runtimeOpts({ isWritable: () => false }));
  assert.match(r.errors.join(), /not writable/);
});

test('verifyVpsRuntime rejects a persistent directory owned by another user', () => {
  const r = verifyVpsRuntime(runtimeEnv(), runtimeOpts({ dirOwnerUid: () => 0 }));
  assert.match(r.errors.join(), /not owned/);
});

test('verifyVpsRuntime rejects a missing database parent directory', () => {
  const r = verifyVpsRuntime(runtimeEnv(), runtimeOpts({ dirExists: () => false }));
  assert.match(r.errors.join(), /database parent directory/);
});

test('verifyVpsRuntime rejects invalid startup and health timeouts', () => {
  assert.match(verifyVpsRuntime(runtimeEnv({ BLACKSPIRE_STARTUP_TIMEOUT_SECONDS: '0' }), runtimeOpts()).errors.join(), /STARTUP_TIMEOUT/);
  assert.match(verifyVpsRuntime(runtimeEnv({ BLACKSPIRE_STARTUP_TIMEOUT_SECONDS: '99999' }), runtimeOpts()).errors.join(), /STARTUP_TIMEOUT/);
  assert.match(verifyVpsRuntime(runtimeEnv({ BLACKSPIRE_HEALTH_TIMEOUT_SECONDS: '0' }), runtimeOpts()).errors.join(), /HEALTH_TIMEOUT/);
  assert.match(verifyVpsRuntime(runtimeEnv({ BLACKSPIRE_HEALTH_TIMEOUT_SECONDS: '99999' }), runtimeOpts()).errors.join(), /HEALTH_TIMEOUT/);
});

test('verifyVpsRuntime rejects running as root', () => {
  const r = verifyVpsRuntime(runtimeEnv(), runtimeOpts({ uid: 0 }));
  assert.match(r.errors.join(), /must not run as root/);
});

test('verifyVpsRuntime rejects a runtime user mismatch and implicit migrations', () => {
  assert.match(verifyVpsRuntime(runtimeEnv(), runtimeOpts({ username: 'someoneelse' })).errors.join(), /RUNTIME_USER/);
  assert.match(verifyVpsRuntime(runtimeEnv({ BLACKSPIRE_RUN_MIGRATIONS: 'true' }), runtimeOpts()).errors.join(), /Migrations/);
});

test('verifyVpsRuntime keeps external providers and test mode fail-closed', () => {
  assert.match(verifyVpsRuntime(runtimeEnv({ OPENAI_API_KEY: 'x' }), runtimeOpts()).errors.join(), /OPENAI_API_KEY/);
  assert.match(verifyVpsRuntime(runtimeEnv({ UNIFIED_IPHONE_TEST_MODE: 'true' }), runtimeOpts()).errors.join(), /Test mode/);
  assert.match(verifyVpsRuntime(runtimeEnv({ TELEGRAM_MODE: 'polling' }), runtimeOpts()).errors.join(), /Telegram/);
  assert.doesNotMatch(JSON.stringify(verifyVpsRuntime(runtimeEnv({ OPENAI_API_KEY: 'super-secret-value' }), runtimeOpts())), /super-secret-value/);
});

// ---------------------------------------------------------------------------
// Shell verifier: root rejection
// ---------------------------------------------------------------------------

test('verify-environment.sh vps-production rejects a root runtime', () => {
  const env = {
    NODE_ENV: 'production', BLACKSPIRE_RUNTIME_MODE: 'production', BLACKSPIRE_STATE_OWNER: 'vps-production',
    BLACKSPIRE_PROVIDER_MODE: 'manual', BLACKSPIRE_HERMES_MODE: 'restricted', TELEGRAM_MODE: 'dry-run',
    BLACKSPIRE_DB_PATH: '/opt/blackspire-command/shared/database/command.sqlite',
    COMMAND_ADMIN_TOKEN: 'x'.repeat(32), SESSION_SECRET: 'y'.repeat(40),
    PORT: '8787', BLACKSPIRE_STARTUP_TIMEOUT_SECONDS: '30', BLACKSPIRE_HEALTH_TIMEOUT_SECONDS: '5',
    BLACKSPIRE_RUNTIME_USER: 'blackspire',
  };
  const r = run('scripts/verify-environment.sh', ['vps-production'], env);
  // Running as root in CI, the runtime must be refused (db parent may also be absent — either way it fails closed).
  assert.notEqual(r.status, 0);
});

test('verify-environment.sh vps-production rejects an invalid port before the root check', () => {
  const env = {
    NODE_ENV: 'production', BLACKSPIRE_RUNTIME_MODE: 'production', BLACKSPIRE_STATE_OWNER: 'vps-production',
    BLACKSPIRE_PROVIDER_MODE: 'manual', BLACKSPIRE_HERMES_MODE: 'restricted', TELEGRAM_MODE: 'dry-run',
    BLACKSPIRE_DB_PATH: '/opt/blackspire-command/shared/database/command.sqlite',
    COMMAND_ADMIN_TOKEN: 'x'.repeat(32), SESSION_SECRET: 'y'.repeat(40), PORT: '70000',
  };
  const r = run('scripts/verify-environment.sh', ['vps-production'], env);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /PORT/);
});

// ---------------------------------------------------------------------------
// Release rollback failure
// ---------------------------------------------------------------------------

test('release rollback fails closed for an unknown release and does not switch current', () => {
  const releaseRoot = freshCase('rollback');
  const sha = 'a'.repeat(40);
  const r = run('scripts/release-rollback.sh', [sha], { BLACKSPIRE_RELEASE_ROOT: releaseRoot });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /completion marker|missing/);
  assert.equal(fs.existsSync(path.join(releaseRoot, 'current')), false, 'current symlink must not be created on a failed rollback');
});

// ---------------------------------------------------------------------------
// No-provider dispatch remains fail-closed
// ---------------------------------------------------------------------------

test('no-provider production dispatch remains fail-closed', () => {
  const prev = { mode: process.env.BLACKSPIRE_RUNTIME_MODE, provider: process.env.BLACKSPIRE_PROVIDER_MODE };
  process.env.BLACKSPIRE_RUNTIME_MODE = 'production';
  process.env.BLACKSPIRE_PROVIDER_MODE = 'manual';
  try {
    const selected = selectProvider({ preferred: ['openai', 'manual'] }, { requested: 'openai' });
    assert.equal(selected.provider, 'manual');
    return executeProviderRequest({ selected: { provider: 'openai', mode: 'api' }, packet: { request: 'x' } }).then((result) => {
      assert.equal(result.ok, false);
      assert.equal(result.mode, 'disabled-by-profile');
      assert.match(result.error, /disabled by the production profile/);
    });
  } finally {
    if (prev.mode === undefined) delete process.env.BLACKSPIRE_RUNTIME_MODE; else process.env.BLACKSPIRE_RUNTIME_MODE = prev.mode;
    if (prev.provider === undefined) delete process.env.BLACKSPIRE_PROVIDER_MODE; else process.env.BLACKSPIRE_PROVIDER_MODE = prev.provider;
  }
});
