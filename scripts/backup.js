import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from '../packages/shared/config.js';

const usage = 'Usage: node scripts/backup.js [backup-directory]';
const source = path.resolve(DB_PATH);
const destinationRoot = path.resolve(process.argv[2] || process.env.BLACKSPIRE_BACKUP_DIR || path.join(path.dirname(source), 'backups'));
const protectedCredentialPath = '/root/.config/blackspire/github.env';

function fail(message) { throw new Error(`backup refused: ${message}`); }
function safeDatabasePath(value, label) {
  const resolved = path.resolve(value);
  if (!resolved.endsWith('.sqlite') && !resolved.endsWith('.db')) fail(`${label} must be a SQLite database file`);
  if (resolved === protectedCredentialPath || resolved.includes(`${path.sep}.env`)) fail(`${label} is not a database path`);
  if (resolved === path.parse(resolved).root) fail(`${label} is unsafe`);
  return resolved;
}

const dbPath = safeDatabasePath(source, 'configured database path');
if (!fs.existsSync(dbPath)) fail(`database does not exist at configured path`);
if (path.resolve(destinationRoot) === path.dirname(dbPath) || path.resolve(destinationRoot).startsWith(`${path.dirname(dbPath)}${path.sep}`)) fail('backup directory must be outside the database directory');
fs.mkdirSync(destinationRoot, { recursive: true, mode: 0o700 });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const target = path.join(destinationRoot, `command-${stamp}.sqlite`);
const checksumPath = `${target}.sha256`;
if (fs.existsSync(target)) fail('timestamp collision; choose another backup directory');

const db = new DatabaseSync(dbPath, { readOnly: true });
try {
  db.exec(`VACUUM INTO '${target.replaceAll("'", "''")}'`);
} finally { db.close(); }
const verify = new DatabaseSync(target, { readOnly: true });
try {
  const result = verify.prepare('PRAGMA integrity_check').get();
  if (result.integrity_check !== 'ok') fail('backup integrity check failed');
} finally { verify.close(); }
fs.chmodSync(target, 0o600);
const digest = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
fs.writeFileSync(checksumPath, `${digest}  ${path.basename(target)}\n`, { mode: 0o600 });
fs.chmodSync(checksumPath, 0o600);
console.log(JSON.stringify({ ok: true, backup: target, checksum: checksumPath, sha256: digest }));
