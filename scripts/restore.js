import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from '../packages/shared/config.js';
import { realResolve, assertNotSymlink, safeUnlink } from '../packages/shared/path-safety.js';

function fail(message) { throw new Error(`restore refused: ${message}`); }
const source = process.argv[2];
const targetArg = process.argv[3];
if (!source || !targetArg) fail('usage: node scripts/restore.js <backup.sqlite> <disposable-target.sqlite>');
const backup = path.resolve(source);
const target = path.resolve(targetArg);
const live = path.resolve(DB_PATH);

if (!fs.existsSync(backup)) fail('backup does not exist');
if (fs.lstatSync(backup).isSymbolicLink()) fail('backup path must not be a symlink');
if (!fs.statSync(backup).isFile()) fail('backup path is not a regular file');
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

fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
assertNotSymlink(target, fail);

try {
  fs.copyFileSync(backup, target, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(target, 0o600);
  const db = new DatabaseSync(target, { readOnly: true });
  try {
    const result = db.prepare('PRAGMA integrity_check').get();
    if (result.integrity_check !== 'ok') fail('restored database integrity check failed');
  } finally { db.close(); }
  console.log(JSON.stringify({ ok: true, restored: target }));
} catch (error) {
  // A failed or unverified restore must not leave a corrupted disposable database that could be mistaken
  // for a valid restoration. The backup and any production data are never touched. A pre-existing target
  // (EEXIST from COPYFILE_EXCL) is left untouched because this run did not create it.
  if (error.code !== 'EEXIST') safeUnlink(target);
  throw new Error(`restore refused: ${error.message.replace(/^restore refused: /, '')}`);
}
