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
import { findMissingSchemaObjects, listTableNames, REQUIRED_SCHEMA, REQUIRED_SCHEMA_OBJECTS, REQUIRED_TABLE_CHECKS } from '../packages/shared/schema-validation.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-restore-schema-'));
const node = process.execPath;

function run(script, args, env = {}) {
  return spawnSync(node, [script, ...args], { cwd: process.cwd(), env: { ...process.env, ...env }, encoding: 'utf8' });
}

function runModule(source, env = {}) {
  return spawnSync(node, ['--input-type=module', '--eval', source], {
    cwd: process.cwd(), env: { ...process.env, ...env }, encoding: 'utf8',
  });
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

function rewriteTableSql(dbPath, table, replace) {
  const db = new DatabaseSync(dbPath);
  try {
    const before = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql;
    assert.ok(before, `${table} must exist before the schema mutation`);
    const after = replace(before);
    assert.notEqual(after, before, `${table} mutation must change its CREATE TABLE definition`);
    db.exec('PRAGMA writable_schema=ON;');
    db.prepare("UPDATE sqlite_master SET sql=? WHERE type='table' AND name=?").run(after, table);
    const version = Number(db.prepare('PRAGMA schema_version').get().schema_version);
    db.exec(`PRAGMA schema_version=${version + 1};`);
    db.exec('PRAGMA writable_schema=OFF;');
  } finally { db.close(); }
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
// Backup side of the same contract: a snapshot that can never be restored must be refused when it
// is taken, not silently blessed with `ok:true` and a matching checksum and only discovered to be
// worthless during an actual recovery.
// ---------------------------------------------------------------------------

function assertBackupRefused(r, backupDir) {
  assert.notEqual(r.status, 0, 'backup must exit nonzero');
  assert.doesNotMatch(r.stdout, /"ok":true/, 'no success object may be printed');
  assert.match(r.stderr, /backup refused/i, 'a stable named failure must be reported');
  const leftovers = fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : [];
  assert.deepEqual(leftovers, [], `no artifact or checksum sidecar may remain, found: ${leftovers.join(',')}`);
}

test('REGRESSION: backup refuses a zero-byte source instead of recording a checksummed unrestorable snapshot', () => {
  const dir = freshCase('backup-zero-byte-source');
  const dbPath = path.join(dir, 'state', 'command.sqlite');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, Buffer.alloc(0));
  const backupDir = path.join(dir, 'backups');
  const r = run('scripts/backup.js', [backupDir], { BLACKSPIRE_DB_PATH: dbPath });

  assertBackupRefused(r, backupDir);
  assert.match(r.stderr, /contains no tables/);
  assert.equal(fs.statSync(dbPath).size, 0, 'the source database is never modified');
});

test('REGRESSION: backup refuses an empty-but-valid SQLite source (zero tables)', () => {
  const dir = freshCase('backup-empty-source');
  const dbPath = path.join(dir, 'state', 'command.sqlite');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  new DatabaseSync(dbPath).close(); // A file SQLite is perfectly willing to open, with no schema.
  const backupDir = path.join(dir, 'backups');
  const r = run('scripts/backup.js', [backupDir], { BLACKSPIRE_DB_PATH: dbPath });

  assertBackupRefused(r, backupDir);
  assert.match(r.stderr, /contains no tables/);
});

test('REGRESSION: a refused backup produces nothing that restore could later be handed', () => {
  const dir = freshCase('backup-refusal-end-to-end');
  const dbPath = path.join(dir, 'state', 'command.sqlite');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, Buffer.alloc(0));
  const backupDir = path.join(dir, 'backups');
  assertBackupRefused(run('scripts/backup.js', [backupDir], { BLACKSPIRE_DB_PATH: dbPath }), backupDir);

  // The pre-fix pair produced a checksummed 4096-byte snapshot here that restore then had to catch.
  // With the backup side failing closed there is no artifact for a later recovery to mistake as valid.
  assert.equal(fs.existsSync(backupDir) ? fs.readdirSync(backupDir).length : 0, 0);
});

test('backup still succeeds for a legitimate pre-migration source with an older, non-current schema', () => {
  // The backup side must not be pinned to the current application schema: refusing to snapshot a
  // database immediately before migrating it would remove data protection exactly when it matters.
  const dir = freshCase('backup-older-schema');
  const dbPath = path.join(dir, 'state', 'command.sqlite');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE legacy_only(id INTEGER PRIMARY KEY, v TEXT); INSERT INTO legacy_only VALUES (1, 'kept');");
  db.close();
  const backupDir = path.join(dir, 'backups');
  const r = run('scripts/backup.js', [backupDir], { BLACKSPIRE_DB_PATH: dbPath });
  assert.equal(r.status, 0, r.stderr);

  const record = JSON.parse(r.stdout);
  const snapshot = new DatabaseSync(record.backup, { readOnly: true });
  try {
    assert.equal(snapshot.prepare('SELECT v FROM legacy_only WHERE id=1').get().v, 'kept');
  } finally { snapshot.close(); }
});

test('backup of a full-schema database records every source table in the snapshot', () => {
  const dir = freshCase('backup-faithful-snapshot');
  const dbPath = path.join(dir, 'state', 'command.sqlite');
  prepareDisposableDatabase(dbPath);
  const source = new DatabaseSync(dbPath, { readOnly: true });
  const sourceTables = listTableNames(source);
  source.close();

  const r = run('scripts/backup.js', [path.join(dir, 'backups')], { BLACKSPIRE_DB_PATH: dbPath });
  assert.equal(r.status, 0, r.stderr);
  const snapshot = new DatabaseSync(JSON.parse(r.stdout).backup, { readOnly: true });
  try {
    assert.deepEqual(listTableNames(snapshot), sourceTables, 'the snapshot must reproduce the source table set');
  } finally { snapshot.close(); }
});

// ---------------------------------------------------------------------------
// Shared schema-validation helper (used by both restore.js and packages/task-engine/db.js)
// ---------------------------------------------------------------------------

test('listTableNames returns sorted ordinary tables and excludes SQLite internal objects', () => {
  const dir = freshCase('helper-list-tables');
  const dbPath = path.join(dir, 'command.sqlite');
  const db = new DatabaseSync(dbPath);
  // An AUTOINCREMENT column forces SQLite to create the internal `sqlite_sequence` table.
  db.exec('CREATE TABLE zeta(id INTEGER PRIMARY KEY AUTOINCREMENT); CREATE TABLE alpha(id INTEGER);');
  db.close();
  const check = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.deepEqual(listTableNames(check), ['alpha', 'zeta']);
  } finally { check.close(); }
});

test('listTableNames returns an empty list for a schema-less database', () => {
  const dir = freshCase('helper-list-tables-empty');
  const dbPath = path.join(dir, 'command.sqlite');
  new DatabaseSync(dbPath).close();
  const check = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.deepEqual(listTableNames(check), []);
  } finally { check.close(); }
});

test('findMissingSchemaObjects reports nothing missing for a fully migrated database', () => {
  const dir = freshCase('helper-full-schema');
  const dbPath = path.join(dir, 'command.sqlite');
  prepareDisposableDatabase(dbPath);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.deepEqual(findMissingSchemaObjects(db), []);
  } finally { db.close(); }
});

test('review queue index is registered and validated as an exact non-unique keyset index', () => {
  const expected = REQUIRED_SCHEMA_OBJECTS.index.idx_hermes_memory_candidates_review_queue;
  assert.deepEqual(expected, {
    table: 'hermes_memory_candidates', columns: ['workspace_id', 'status', 'created_at', 'id'], unique: false,
  });
  const dir = freshCase('queue-index-shape');
  const dbPath = path.join(dir, 'command.sqlite');
  prepareDisposableDatabase(dbPath);
  const db = new DatabaseSync(dbPath);
  assert.equal(db.prepare('PRAGMA index_list("hermes_memory_candidates")').all()
    .find((row) => row.name === 'idx_hermes_memory_candidates_review_queue')?.unique, 0);
  db.exec('DROP INDEX idx_hermes_memory_candidates_review_queue; CREATE INDEX idx_hermes_memory_candidates_review_queue ON hermes_memory_candidates(status,workspace_id,created_at,id);');
  assert.ok(findMissingSchemaObjects(db).includes('invalid index idx_hermes_memory_candidates_review_queue'));
  db.close();
});

test('required CHECK inventory covers authorization and every Hermes 3A-3C constraint family', () => {
  assert.deepEqual(Object.keys(REQUIRED_TABLE_CHECKS).sort(), [
    'auth_decisions', 'auth_principals', 'auth_workspace_grants',
    'hermes_memory_candidate_rereviews', 'hermes_memory_candidate_reviews',
    'hermes_outcome_corrections', 'hermes_outcome_evaluation_failures',
    'hermes_outcome_source_events', 'hermes_verified_scorecard_sources',
    'hermes_verified_scorecards',
  ]);
  assert.equal(Object.values(REQUIRED_TABLE_CHECKS).reduce((total, checks) => total + checks.length, 0), 52);
});

test('schema validation rejects removed or widened authorization and Hermes CHECK constraints', () => {
  const cases = [
    ['auth-type', 'auth_principals', "CHECK(type IN ('admin','service'))", "CHECK(type IN ('admin','service','guest'))"],
    ['auth-status', 'auth_workspace_grants', "CHECK(status IN ('active','revoked','expired','superseded'))", "CHECK(status IN ('active','revoked','expired','superseded','forged'))"],
    ['auth-allowed', 'auth_decisions', 'CHECK(allowed IN (0,1))', 'CHECK(allowed IN (0,1,2))'],
    ['m3a-version-removed', 'hermes_outcome_corrections', 'CHECK(version>0)', ''],
    ['m3a-events', 'hermes_outcome_source_events', "CHECK(event_type IN ('accepted','rejected','partially_accepted','rollback','follow_up_verification','stability_confirmed','regression_linked'))", "CHECK(event_type IN ('accepted','rejected','partially_accepted','rollback','follow_up_verification','stability_confirmed','regression_linked','invented'))"],
    ['m3a-failure', 'hermes_outcome_evaluation_failures', "CHECK(remediation_state IN ('open','retry_requested','resolved'))", "CHECK(remediation_state IN ('open','retry_requested','resolved','ignored'))"],
    ['m3b-scope', 'hermes_verified_scorecards', 'CHECK(scope_version>0)', 'CHECK(scope_version>=0)'],
    ['m3b-confidence', 'hermes_verified_scorecards', "CHECK(confidence_band IN ('insufficient','limited','established'))", "CHECK(confidence_band IN ('insufficient','limited','established','trusted'))"],
    ['m3b-metric', 'hermes_verified_scorecards', 'CHECK(accepted_count>=0)', 'CHECK(accepted_count>=-1)'],
    ['m3b-source', 'hermes_verified_scorecard_sources', 'CHECK(seq>0)', 'CHECK(seq>=0)'],
    ['m3c-decision', 'hermes_memory_candidate_reviews', "CHECK(decision IN ('recommend_promote','reject','defer_needs_evidence'))", "CHECK(decision IN ('recommend_promote','reject','defer_needs_evidence','promote'))"],
    ['m3c-scope', 'hermes_memory_candidate_reviews', "CHECK(candidate_scope='workspace')", "CHECK(candidate_scope IN ('workspace','global'))"],
    ['m3c-status', 'hermes_memory_candidate_reviews', "CHECK(candidate_status_at_review='pending')", "CHECK(candidate_status_at_review IN ('pending','promoted'))"],
    ['m3c-rereview-link', 'hermes_memory_candidate_rereviews', 'CHECK(id<>root_review_id)', 'CHECK(id=root_review_id OR id<>root_review_id)'],
    ['m3c-rereview-shape', 'hermes_memory_candidate_rereviews', 'CHECK((chain_version=1 AND supersedes_rereview_id IS NULL) OR (chain_version>1 AND supersedes_rereview_id IS NOT NULL))', 'CHECK(chain_version>0)'],
  ];
  for (const [name, table, from, to] of cases) {
    const dir = freshCase(`constraint-${name}`);
    const dbPath = path.join(dir, 'command.sqlite');
    prepareDisposableDatabase(dbPath);
    rewriteTableSql(dbPath, table, (sql) => {
      assert.ok(sql.includes(from), `${name} fixture must find the exact canonical CHECK`);
      return sql.replace(from, to);
    });
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      assert.ok(findMissingSchemaObjects(db).includes(`invalid table constraints ${table}`), `${name} must fail closed`);
    } finally { db.close(); }
  }
});

test('restore refuses a checksum-valid backup with a widened promotion decision constraint', () => {
  const dir = freshCase('constraint-restore');
  const { backup } = fullSchemaBackup(dir);
  rewriteTableSql(backup, 'hermes_memory_candidate_reviews', (sql) => sql.replace(
    "CHECK(decision IN ('recommend_promote','reject','defer_needs_evidence'))",
    "CHECK(decision IN ('recommend_promote','reject','defer_needs_evidence','promote'))"));
  writeSidecar(backup);
  const target = path.join(dir, 'disposable', 'command.sqlite');
  const r = run('scripts/restore.js', [backup, target], restoreArgs(dir));
  assertRejected(r, target);
  assert.match(r.stderr, /invalid table constraints hermes_memory_candidate_reviews/);
});

test('migration postcondition refuses an existing weakened table that CREATE IF NOT EXISTS cannot heal', () => {
  const dir = freshCase('constraint-migration');
  const dbPath = path.join(dir, 'command.sqlite');
  prepareDisposableDatabase(dbPath);
  rewriteTableSql(dbPath, 'auth_decisions', (sql) => sql.replace('CHECK(allowed IN (0,1))', 'CHECK(allowed IN (0,1,2))'));
  const migrated = run('scripts/migrate.js', [], { BLACKSPIRE_DB_PATH: dbPath, BLACKSPIRE_RUN_MIGRATIONS: 'true' });
  assert.notEqual(migrated.status, 0);
  assert.match(migrated.stderr, /invalid table constraints auth_decisions/);
});

test('application startup refuses a database with weakened security constraints', () => {
  const dir = freshCase('constraint-startup');
  const dbPath = path.join(dir, 'command.sqlite');
  prepareDisposableDatabase(dbPath);
  rewriteTableSql(dbPath, 'auth_principals', (sql) => sql.replace(
    "CHECK(type IN ('admin','service'))", "CHECK(type IN ('admin','service','guest'))"));
  const started = runModule(
    "import('./packages/task-engine/db.js').then(({assertSchemaCompatible}) => assertSchemaCompatible())",
    { BLACKSPIRE_DB_PATH: dbPath });
  assert.notEqual(started.status, 0);
  assert.match(started.stderr, /database schema migration required: invalid table constraints auth_principals/);
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

test('findMissingSchemaObjects rejects missing or shape-invalid integrity indexes and immutability triggers', () => {
  const dir = freshCase('helper-integrity-objects');
  const dbPath = path.join(dir, 'command.sqlite');
  prepareDisposableDatabase(dbPath);
  const db = new DatabaseSync(dbPath);
  const index = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND name LIKE 'idx_hermes_outcome_%_unique' ORDER BY name LIMIT 1").get();
  const trigger = db.prepare("SELECT name,tbl_name FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_hermes_outcome_%_immutable_update' ORDER BY name LIMIT 1").get();
  assert.ok(index?.name);
  assert.ok(trigger?.name);
  db.exec(`DROP INDEX ${index.name}; DROP TRIGGER ${trigger.name};`);
  const missing = findMissingSchemaObjects(db);
  assert.ok(missing.includes(`invalid index ${index.name}`));
  assert.ok(missing.includes(`invalid trigger ${trigger.name}`));
  db.exec(`${index.sql.replace('CREATE UNIQUE INDEX', 'CREATE INDEX')};
    CREATE TRIGGER ${trigger.name} BEFORE UPDATE ON ${trigger.tbl_name} BEGIN SELECT 1; END;`);
  const malformed = findMissingSchemaObjects(db);
  assert.ok(malformed.includes(`invalid index ${index.name}`));
  assert.ok(malformed.includes(`invalid trigger ${trigger.name}`));
  db.exec(`DROP INDEX ${index.name}; ${index.sql} WHERE 0;`);
  assert.ok(findMissingSchemaObjects(db).includes(`invalid index ${index.name}`));
  db.close();
});
