import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from '../packages/shared/config.js';

function fail(message) { throw new Error(`restore refused: ${message}`); }
const source = process.argv[2];
const target = path.resolve(process.argv[3] || '');
if (!source || !target) fail('usage: node scripts/restore.js <backup.sqlite> <disposable-target.sqlite>');
const backup = path.resolve(source);
const live = path.resolve(DB_PATH);
if (!fs.existsSync(backup)) fail('backup does not exist');
if (process.env.NODE_ENV === 'production' || target === live) fail('restore target must be disposable and never the configured production database');
if (!target.endsWith('.sqlite') && !target.endsWith('.db')) fail('restore target must be a SQLite database file');
if (backup === live) fail('source cannot be the live database');
fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
const checksumPath = `${backup}.sha256`;
if (fs.existsSync(checksumPath)) {
  const expected = fs.readFileSync(checksumPath, 'utf8').trim().split(/\s+/)[0];
  const actual = crypto.createHash('sha256').update(fs.readFileSync(backup)).digest('hex');
  if (!expected || expected !== actual) fail('backup checksum mismatch');
}
fs.copyFileSync(backup, target, fs.constants.COPYFILE_EXCL);
fs.chmodSync(target, 0o600);
const db = new DatabaseSync(target, { readOnly: true });
try {
  const result = db.prepare('PRAGMA integrity_check').get();
  if (result.integrity_check !== 'ok') fail('restored database integrity check failed');
} finally { db.close(); }
console.log(JSON.stringify({ ok: true, restored: target }));
