import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH } from '../packages/shared/config.js';
import { realResolve, within, assertNotSymlink, safeUnlink } from '../packages/shared/path-safety.js';

const usage = 'Usage: node scripts/backup.js [backup-directory]';
const source = path.resolve(DB_PATH);
const protectedCredentialPath = '/root/.config/blackspire/github.env';
const releaseRoot = process.env.BLACKSPIRE_RELEASE_ROOT ? path.resolve(process.env.BLACKSPIRE_RELEASE_ROOT) : '/opt/blackspire-command';
const immutableReleases = path.join(releaseRoot, 'releases');

function fail(message) { throw new Error(`backup refused: ${message}`); }

function safeDatabasePath(value, label) {
  const resolved = path.resolve(value);
  if (!resolved.endsWith('.sqlite') && !resolved.endsWith('.db')) fail(`${label} must be a SQLite database file`);
  if (resolved === protectedCredentialPath || resolved.includes(`${path.sep}.env`)) fail(`${label} is not a database path`);
  if (resolved === path.parse(resolved).root) fail(`${label} is unsafe`);
  return resolved;
}

// Default destination resolves beneath the canonical persistent shared backup directory, never a
// user-controlled arbitrary location and never inside an immutable release. An explicit safe override
// (positional argument or BLACKSPIRE_BACKUP_DIR) is always honored.
function defaultBackupDir(dbFile) {
  const dbDir = path.dirname(dbFile);
  const parent = path.dirname(dbDir);
  if (path.basename(dbDir) === 'database' && path.basename(parent) === 'shared') return path.join(parent, 'backups');
  if (process.env.BLACKSPIRE_RELEASE_ROOT) return path.join(releaseRoot, 'shared', 'backups');
  return path.join(dbDir, 'backups');
}

const dbPath = safeDatabasePath(source, 'configured database path');
if (!fs.existsSync(dbPath)) fail('database does not exist at configured path');
if (fs.lstatSync(dbPath).isSymbolicLink()) fail('configured database path must not be a symlink');
if (!fs.statSync(dbPath).isFile()) fail('configured database path is not a regular file');
const realDb = realResolve(dbPath);
const realDbDir = path.dirname(realDb);

const requested = process.argv[2] || process.env.BLACKSPIRE_BACKUP_DIR;
const destinationRoot = path.resolve(requested || defaultBackupDir(dbPath));
if (destinationRoot === path.parse(destinationRoot).root) fail('backup directory is unsafe');
if (destinationRoot === realDbDir || destinationRoot.startsWith(`${realDbDir}${path.sep}`)) fail('backup directory must be outside the database directory');

fs.mkdirSync(destinationRoot, { recursive: true, mode: 0o700 });
// Re-validate after creation so a symlinked ancestor cannot escape the approved layout.
const realDestRoot = realResolve(destinationRoot);
if (fs.lstatSync(destinationRoot).isSymbolicLink()) fail('backup directory must not be a symlink');
if (realDestRoot === realDbDir || realDestRoot.startsWith(`${realDbDir}${path.sep}`)) fail('backup directory must be outside the database directory');
if (fs.existsSync(immutableReleases) && within(realDestRoot, immutableReleases)) fail('backup directory must not be inside an immutable release');

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const target = path.join(realDestRoot, `command-${stamp}.sqlite`);
const checksumPath = `${target}.sha256`;
if (fs.existsSync(target)) fail('timestamp collision; choose another backup directory');
assertNotSymlink(target, fail);
assertNotSymlink(checksumPath, fail);
if (realResolve(target) === realDb) fail('backup target cannot resolve to the source database');

try {
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
} catch (error) {
  // A failed backup must leave no partial artifact that could later be mistaken for a valid snapshot.
  // The source database is never touched; only the incomplete target and its sidecar are removed.
  safeUnlink(checksumPath);
  safeUnlink(target);
  throw new Error(`backup refused: ${error.message.replace(/^backup refused: /, '')}`);
}
