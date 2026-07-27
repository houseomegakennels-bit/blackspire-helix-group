// Focused, disposable coverage for the restore fail-closed schema contract: scripts/restore.js must
// never report success for a backup that is empty, schema-less, partial, or corrupted, even when
// SQLite itself is willing to open the file (an empty file is a legitimate, valid, empty database as
// far as `PRAGMA integrity_check` is concerned - schema completeness must be proven independently).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { prepareDisposableDatabase } from './helpers/prepare-disposable-database.js';
import { findMissingSchemaObjects, REQUIRED_SCHEMA } from '../packages/shared/schema-validation.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-restore-schema-'));
const node = process.execPath;

function run(script, args, env = {}) {
  return spawnSync(node, [script, ...args], { cwd: process.cwd(), env: { ...process.env, ...env }, encoding: 'utf8' });
}

function freshCase(name) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function writeSidecar(file) {
  fs.writeFileSync(`${file}.sha256`, `${sha256(file)}  ${path.basename(file)}\n`);
}

// A genuine full-schema Blackspire database (via the reviewed migration tooling), backed up with
// the reviewed backup.js, giving a real backup + matching checksum sidecar to restore from.
function fullSchemaBackup(dir, { seed } = {}) {
  const dbPath = path.join(dir, 'state', 'command.sqlite');
  prepareDisposableDatabase(dbPath);
  if (seed) {
    const db = new DatabaseSync(dbPath);
    seed(db);
    db.close();
  }
  const backupDir = path.join(dir, 'backups');
  const backed = run('scripts/backup.js', [backupDir], { BLACKSPIRE_DB_PATH: dbPath });
  assert.equal(backed.status, 0, backed.stderr);
  return { dbPath, ...JSON.parse(backed.stdout) };
}

function restoreArgs(dir) {
  return { BLACKSPIRE_DB_PATH: path.join(dir, 'live.sqlite'), NODE_ENV: 'test', BLACKSPIRE_DISPOSABLE_RESTORE: 'true' };
}

// ---------------------------------------------------------------------------
// Regression proof: the exact pre-fix vulnerability (Gate 3 Finding #1)
// ---------------------------------------------------------------------------

test('REGRESSION: a 0-byte backup with a matching checksum sidecar must never restore as success', () => {
  const dir = freshCase('regression-empty-backup');
  const backup = path.join(dir, 'command-empty.sqlite');
  fs.writeFileSync(backup, Buffer.alloc(0));
  writeSidecar(backup);
  const target = path.join(dir, 'disposable', 'command.sqlite');
  const r = run('scripts/restore.js', [backup, target], restoreArgs(dir));

  // Behavioral proof, not a source-text search: this exact scenario (0-byte file + matching sidecar)
  // is precisely what Gate 3 Phase 8 test 2 showed silently succeeding before this fix.
  assert.notEqual(r.status, 0, 'restore of an empty backup must exit nonzero');
  assert.doesNotMatch(r.stdout, /"ok":true/, 'restore must never print a success object for an empty backup');
  assert.match(r.stderr, /restore refused/i, 'a stable, named restore-refused failure must be reported');
  assert.equal(fs.existsSync(target), false, 'no restored target may exist after a rejected restore');
  assert.equal(fs.statSync(backup).size, 0, 'the source backup must remain unchanged');
});

// ---------------------------------------------------------------------------
// Positive paths
// ---------------------------------------------------------------------------

test('restore succeeds for a valid, full-schema backup and preserves records', () => {
  const dir = freshCase('valid-restore');
  const { backup, dbPath } = fullSchemaBackup(dir, {
    seed: (db) => db.exec("INSERT INTO system_flags(key, value, updated_at) VALUES ('marker', 'kept', '2026-01-01T00:00:00Z');"),
  });
  const target = path.join(dir, 'disposable', 'command.sqlite');
  const r = run('scripts/restore.js', [backup, target], restoreArgs(dir));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), { ok: true, restored: target });

  const restored = new DatabaseSync(target, { readOnly: true });
  try {
    assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.equal(restored.prepare('SELECT value FROM system_flags WHERE key=?').get('marker').value, 'kept');
    for (const table of Object.keys(REQUIRED_SCHEMA)) {
      assert.ok(restored.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table), `${table} present`);
    }
  } finally { restored.close(); }
  assert.equal(fs.existsSync(dbPath), true, 'original source database is untouched');
});

test('restore succeeds for a valid backup whose application tables are legitimately empty (zero rows)', () => {
  const dir = freshCase('valid-empty-rows');
  const { backup } = fullSchemaBackup(dir);
  const target = path.join(dir, 'disposable', 'command.sqlite');
  const r = run('scripts/restore.js', [backup, target], restoreArgs(dir));
  assert.equal(r.status, 0, r.stderr);
  const restored = new DatabaseSync(target, { readOnly: true });
  try {
    assert.equal(restored.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    assert.deepEqual(findMissingSchemaObjects(restored), [], 'a legitimately empty application database is still schema-complete');
    // The seedWorkspace() step in migrate.js seeds a default workspace; tasks legitimately has zero rows.
    assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM tasks').get().n, 0);
  } finally { restored.close(); }
});

test('restore is atomic and leaves no temporary artifacts on success', () => {
  const dir = freshCase('atomic-publish');
  const { backup } = fullSchemaBackup(dir);
  const target = path.join(dir, 'disposable', 'command.sqlite');
  const r = run('scripts/restore.js', [backup, target], restoreArgs(dir));
  assert.equal(r.status, 0, r.stderr);
  const leftovers = fs.readdirSync(path.dirname(target)).filter((name) => name !== path.basename(target));
  assert.deepEqual(leftovers, [], `no temp restore artifacts should remain, found: ${leftovers.join(',')}`);
});

// ---------------------------------------------------------------------------
// Negative paths
// ---------------------------------------------------------------------------

function assertRejected(r, target, { sourceUnchanged } = {}) {
  assert.notEqual(r.status, 0, 'restore must exit nonzero');
  assert.doesNotMatch(r.stdout, /"ok":true/, 'no success object may be printed');
  assert.match(r.stderr, /restore refused/i, 'a stable named failure code must be reported');
  assert.equal(fs.existsSync(target), false, 'no target artifact may remain');
  const tempLeftovers = fs.existsSync(path.dirname(target))
    ? fs.readdirSync(path.dirname(target)).filter((name) => name !== path.basename(target))
    : [];
  assert.deepEqual(tempLeftovers, [], `no partial temp artifact may remain, found: ${tempLeftovers.join(',')}`);
  if (sourceUnchanged) assert.equal(fs.existsSync(sourceUnchanged.path) && fs.statSync(sourceUnchanged.path).size, sourceUnchanged.size);
}

test('restore refuses a missing backup', () => {
  const dir = freshCase('missing-backup');
  const target = path.join(dir, 'disposable', 'command.sqlite');
  const r = run('scripts/restore.js', [path.join(dir, 'nope.sqlite'), target], restoreArgs(dir));
  assertRejected(r, target);
  assert.match(r.stderr, /backup does not exist/);
});

test('restore refuses a directory supplied as the backup', () => {
  const dir = freshCase('directory-as-backup');
  const backupAsDir = path.join(dir, 'command.sqlite');
  fs.mkdirSync(backupAsDir);
  const target = path.join(dir, 'disposable', 'command.sqlite');
  const r = run('scripts/restore.js', [backupAsDir, target], restoreArgs(dir));
  assertRejected(r, target);
  assert.match(r.stderr, /not a regular file/);
});

test('restore refuses a symlinked backup', () => {
  const dir = freshCase('symlinked-backup');
  const { backup } = fullSchemaBackup(dir);
  const link = path.join(dir, 'command-link.sqlite');
  fs.symlinkSync(backup, link);
  fs.symlinkSync(`${backup}.sha256`, `${link}.sha256`);
  const target = path.join(dir, 'disposable', 'command.sqlite');
  const r = run('scripts/restore.js', [link, target], restoreArgs(dir));
  assertRejected(r, target);
  assert.match(r.stderr, /symlink/);
});

test('restore refuses a zero-byte backup even with a matching checksum sidecar', () => {
  const dir = freshCase('zero-byte-backup');
  const backup = path.join(dir, 'command-empty.sqlite');
  fs.writeFileSync(backup, Buffer.alloc(0));
  writeSidecar(backup);
  const target = path.join(dir, 'disposable', 'command.sqlite');
  const r = run('scripts/restore.js', [backup, target], restoreArgs(dir));
  assertRejected(r, target);
  assert.match(r.stderr, /empty \(0 bytes\)/);
});

test('restore refuses a valid SQLite file with no Blackspire schema', () => {
  const dir = freshCase('no-schema');
  const backup = path.join(dir, 'command-plain.sqlite');
  const db = new DatabaseSync(backup);
  db.exec('CREATE TABLE unrelated(id INTEGER PRIMARY KEY, v TEXT);');
  db.close();
  writeSidecar(backup);
  const target = path.join(dir, 'disposable', 'command.sqlite');
  const r = run('scripts/restore.js', [backup, target], restoreArgs(dir));
  assertRejected(r, target);
  assert.match(r.stderr, /missing required Blackspire schema/);
  assert.match(r.stderr, /missing table workspaces/);
});

test('restore refuses a partial/incomplete Blackspire schema (missing tables and columns)', () => {
  const dir = freshCase('partial-schema');
  const dbPath = path.join(dir, 'state', 'command.sqlite');
  prepareDisposableDatabase(dbPath);
  const db = new DatabaseSync(dbPath);
  // Drop one whole required table and one required column from another to simulate an
  // interrupted/partial migration captured in a backup.
  db.exec('DROP TABLE channel_deliveries;');
  db.exec('CREATE TABLE tasks_tmp AS SELECT id, workspace_id, request, status FROM tasks;');
  db.exec('DROP TABLE tasks;');
  db.exec('ALTER TABLE tasks_tmp RENAME TO tasks;');
  db.close();
  const backupDir = path.join(dir, 'backups');
  const backed = run('scripts/backup.js', [backupDir], { BLACKSPIRE_DB_PATH: dbPath });
  assert.equal(backed.status, 0, backed.stderr);
  const record = JSON.parse(backed.stdout);
  const target = path.join(dir, 'disposable', 'command.sqlite');
  const r = run('scripts/restore.js', [record.backup, target], restoreArgs(dir));
  assertRejected(r, target);
  assert.match(r.stderr, /missing required Blackspire schema/);
  assert.match(r.stderr, /missing table channel_deliveries/);
  assert.match(r.stderr, /tasks is missing/);
});

test('restore refuses a truncated/corrupted SQLite backup', () => {
  const dir = freshCase('truncated-backup');
  const { backup: goodBackup } = fullSchemaBackup(dir);
  const backup = path.join(dir, 'command-truncated.sqlite');
  const bytes = fs.readFileSync(goodBackup);
  fs.writeFileSync(backup, bytes.subarray(0, Math.floor(bytes.length / 2)));
  writeSidecar(backup);
  const target = path.join(dir, 'disposable', 'command.sqlite');
  const r = run('scripts/restore.js', [backup, target], restoreArgs(dir));
  assertRejected(r, target);
});

test('restore refuses when PRAGMA integrity_check fails on a checksum-matching corrupted file', () => {
  const dir = freshCase('integrity-failure');
  const { backup: goodBackup } = fullSchemaBackup(dir);
  const backup = path.join(dir, 'command-corrupt.sqlite');
  const bytes = Buffer.from(fs.readFileSync(goodBackup));
  // Corrupt every data page beyond the header so PRAGMA integrity_check cannot report "ok".
  for (let i = 4096; i < bytes.length; i += 97) bytes[i] = bytes[i] ^ 0xff;
  fs.writeFileSync(backup, bytes);
  writeSidecar(backup);
  const target = path.join(dir, 'disposable', 'command.sqlite');
  const r = run('scripts/restore.js', [backup, target], restoreArgs(dir));
  assertRejected(r, target);
});

test('restore refuses an unexpected pre-existing destination and leaves it byte-identical', () => {
  const dir = freshCase('pre-existing-target');
  const { backup } = fullSchemaBackup(dir);
  const target = path.join(dir, 'disposable', 'command.sqlite');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, 'pre-existing unrelated content');
  const before = sha256(target);
  const r = run('scripts/restore.js', [backup, target], restoreArgs(dir));
  assert.notEqual(r.status, 0);
  assert.doesNotMatch(r.stdout, /"ok":true/);
  assert.equal(sha256(target), before, 'pre-existing destination must be left byte-identical');
  const leftovers = fs.readdirSync(path.dirname(target)).filter((name) => name !== path.basename(target));
  assert.deepEqual(leftovers, [], 'no temp artifact may remain next to the untouched destination');
});

test('restore refuses an unwritable restore destination directory', (t) => {
  if (process.getuid?.() === 0) {
    // Directory permission bits are bypassed for root (DAC override); this cannot be exercised
    // as root, matching the same documented limitation Gate 3 recorded for this exact case.
    t.skip('running as root bypasses directory permission bits');
    return;
  }
  const dir = freshCase('unwritable-destination');
  const { backup } = fullSchemaBackup(dir);
  const destDir = path.join(dir, 'disposable');
  fs.mkdirSync(destDir, { recursive: true, mode: 0o500 });
  const target = path.join(destDir, 'command.sqlite');
  try {
    const r = run('scripts/restore.js', [backup, target], restoreArgs(dir));
    assert.notEqual(r.status, 0);
    assert.equal(fs.existsSync(target), false);
  } finally {
    fs.chmodSync(destDir, 0o700);
  }
});

test('restore cleans up an interrupted/incomplete copy and leaves no target (also proves post-copy validation)', () => {
  const dir = freshCase('interrupted-copy');
  const { backup } = fullSchemaBackup(dir);
  const target = path.join(dir, 'disposable', 'command.sqlite');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  // A file-size ulimit is enforced by the kernel regardless of uid (unlike permission bits), so this
  // deterministically interrupts fs.copyFileSync partway through writing the temp file - the same
  // failure mode as a disk-full or killed-mid-copy restore, and the same safety net (post-copy
  // validation of the temp file, or cleanup if the copy itself never finishes) either way.
  const r = spawnSync('bash', ['-c', 'ulimit -f 1; exec "$@"', 'bash', node, 'scripts/restore.js', backup, target], {
    cwd: process.cwd(), env: { ...process.env, ...restoreArgs(dir) }, encoding: 'utf8',
  });
  assert.notEqual(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /"ok":true/);
  assert.equal(fs.existsSync(target), false, 'no target may exist after an interrupted copy');
  const leftovers = fs.readdirSync(path.dirname(target));
  assert.deepEqual(leftovers, [], `no partial temp artifact may remain, found: ${leftovers.join(',')}`);
  assert.ok(fs.existsSync(backup) && fs.statSync(backup).size > 0, 'source backup remains unchanged');
});

test('restore refuses a missing checksum sidecar', () => {
  const dir = freshCase('missing-sidecar');
  const { backup } = fullSchemaBackup(dir);
  fs.unlinkSync(`${backup}.sha256`);
  const target = path.join(dir, 'disposable', 'command.sqlite');
  const r = run('scripts/restore.js', [backup, target], restoreArgs(dir));
  assertRejected(r, target);
  assert.match(r.stderr, /checksum sidecar is required/);
});

// ---------------------------------------------------------------------------
// Shared schema-validation helper (used by both restore.js and packages/task-engine/db.js)
// ---------------------------------------------------------------------------

test('findMissingSchemaObjects reports nothing missing for a fully migrated database', () => {
  const dir = freshCase('helper-full-schema');
  const dbPath = path.join(dir, 'command.sqlite');
  prepareDisposableDatabase(dbPath);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.deepEqual(findMissingSchemaObjects(db), []);
  } finally { db.close(); }
});

test('findMissingSchemaObjects reports missing tables and missing columns distinctly', () => {
  const dir = freshCase('helper-partial-schema');
  const dbPath = path.join(dir, 'command.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE workspaces(id TEXT PRIMARY KEY, name TEXT);');
  db.close();
  const check = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const missing = findMissingSchemaObjects(check);
    assert.ok(missing.some((m) => m.startsWith('workspaces is missing')), 'reports the partial table with its missing columns');
    assert.ok(missing.some((m) => m === 'missing table tasks'), 'reports an entirely absent required table');
  } finally { check.close(); }
});
