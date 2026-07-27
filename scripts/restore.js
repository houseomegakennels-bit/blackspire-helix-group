import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from '../packages/shared/config.js';
import { realResolve, assertNotSymlink, safeUnlink } from '../packages/shared/path-safety.js';
import { findMissingSchemaObjects } from '../packages/shared/schema-validation.js';

class RestoreRefused extends Error {}
function fail(message) { throw new RestoreRefused(message); }

// Never trust that SQLite opening a file is evidence of a valid Blackspire backup: an empty or
// truncated file is a legitimate-but-empty SQLite database as far as `PRAGMA integrity_check` is
// concerned, so schema completeness must be proven independently of integrity. Any raw SQLite error
// (malformed file, wrong header, etc.) is also translated into the same named, sanitized failure.
function validateDatabase(dbPath, label) {
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const result = db.prepare('PRAGMA integrity_check').get();
    if (result.integrity_check !== 'ok') fail(`${label} failed integrity check: ${result.integrity_check}`);
    const missing = findMissingSchemaObjects(db);
    if (missing.length) fail(`${label} is missing required Blackspire schema: ${missing.join('; ')}`);
  } catch (error) {
    if (error instanceof RestoreRefused) throw error;
    fail(`${label} could not be validated: ${error.message}`);
  } finally {
    db?.close();
  }
}

function main() {
  const source = process.argv[2];
  const targetArg = process.argv[3];
  if (!source || !targetArg) fail('usage: node scripts/restore.js <backup.sqlite> <disposable-target.sqlite>');
  const backup = path.resolve(source);
  const target = path.resolve(targetArg);
  const live = path.resolve(DB_PATH);

  if (!fs.existsSync(backup)) fail('backup does not exist');
  if (fs.lstatSync(backup).isSymbolicLink()) fail('backup path must not be a symlink');
  if (!fs.statSync(backup).isFile()) fail('backup path is not a regular file');
  if (fs.statSync(backup).size === 0) fail('backup is empty (0 bytes)');
  if ((process.env.NODE_ENV === 'production' && process.env.BLACKSPIRE_DISPOSABLE_RESTORE !== 'true') || target === live) {
    fail('restore target must be disposable and never the configured production database');
  }
  if (!target.endsWith('.sqlite') && !target.endsWith('.db')) fail('restore target must be a SQLite database file');

  const realBackup = realResolve(backup);
  const realLive = realResolve(live);
  const realTarget = realResolve(target);
  if (realBackup === realLive) fail('source cannot be the live database');
  if (realTarget === realLive) fail('restore target cannot resolve to the live database');
  if (realBackup === realTarget) fail('source and destination cannot be the same file');

  const checksumPath = `${backup}.sha256`;
  if (!fs.existsSync(checksumPath)) fail('backup checksum sidecar is required');
  const expected = fs.readFileSync(checksumPath, 'utf8').trim().split(/\s+/)[0];
  const actual = crypto.createHash('sha256').update(fs.readFileSync(backup)).digest('hex');
  if (!expected || expected !== actual) fail('backup checksum mismatch');

  // Validate the backup itself, read-only, before any write to the destination: a corrupted or
  // schema-less backup must be refused before a target file is ever created.
  validateDatabase(backup, 'backup');

  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  assertNotSymlink(target, fail);

  const tempTarget = `${target}.restore-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`;
  safeUnlink(tempTarget);

  try {
    fs.copyFileSync(backup, tempTarget, fs.constants.COPYFILE_EXCL);
    const fd = fs.openSync(tempTarget, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.chmodSync(tempTarget, 0o600);
    // Post-copy validation independently re-proves the copy is intact and schema-complete rather
    // than trusting that the copy operation reported success.
    validateDatabase(tempTarget, 'restored database');
    assertNotSymlink(target, fail);
    try {
      // A hard link is atomic and refuses (EEXIST) to silently replace an existing destination -
      // COPYFILE_EXCL cannot be used here because the destination is only ever the validated temp file.
      fs.linkSync(tempTarget, target);
    } catch (linkError) {
      if (linkError.code === 'EEXIST') fail('restore target already exists');
      fail(`could not publish restored database: ${linkError.message}`);
    }
    console.log(JSON.stringify({ ok: true, restored: target }));
  } catch (error) {
    if (error instanceof RestoreRefused) throw error;
    fail(`could not complete restore: ${error.message}`);
  } finally {
    // The temp file is redundant once linked (or was never valid); the backup and any pre-existing
    // target are never touched by this cleanup.
    safeUnlink(tempTarget);
  }
}

try {
  main();
} catch (error) {
  console.error(`restore refused: ${error.message}`);
  process.exit(1);
}
