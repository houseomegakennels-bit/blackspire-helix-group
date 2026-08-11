import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { findMissingSchemaObjects } from '../packages/shared/schema-validation.js';

function fail(message) { throw new Error(`backup verification failed: ${message}`); }
function parseArgs(argv) {
  const directory = argv[2];
  if (!directory) fail('usage: node scripts/verify-latest-backup.js <backup-directory> [--max-age-hours <hours>]');
  let maxAgeHours = null;
  if (argv.length > 3) {
    if (argv.length !== 5 || argv[3] !== '--max-age-hours' || !/^[1-9][0-9]{0,4}$/.test(argv[4])) fail('max age must be a positive integer number of hours');
    maxAgeHours = Number(argv[4]);
  }
  return { directory, maxAgeHours };
}
function timestampFromName(file) {
  const match = /^command-(\d{8}T\d{6}Z)\.sqlite$/.exec(file);
  if (!match) return null;
  const stamp = match[1];
  const iso = `${stamp.slice(0,4)}-${stamp.slice(4,6)}-${stamp.slice(6,8)}T${stamp.slice(9,11)}:${stamp.slice(11,13)}:${stamp.slice(13,15)}Z`;
  const time = Date.parse(iso);
  return Number.isFinite(time) && new Date(time).toISOString() === iso.replace('Z', '.000Z') ? { iso, time } : null;
}
function hashFileDescriptor(fd) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(null, { fd, autoClose: false, start: 0 });
    input.on('error', reject);
    input.on('data', (chunk) => hash.update(chunk));
    input.on('end', () => resolve(hash.digest('hex')));
  });
}
const sameFile = (left, right) => left.dev === right.dev && left.ino === right.ino;
const unchangedFile = (left, right) => sameFile(left, right) && left.size === right.size &&
  left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
function descriptorStat(fd) { return fs.fstatSync(fd, { bigint: true }); }
function pathStillNamesDescriptor(file, descriptor) {
  const current = fs.lstatSync(file, { bigint: true });
  return !current.isSymbolicLink() && current.isFile() && sameFile(current, descriptor);
}
function refuseSQLiteSidecars(backup) {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    if (fs.existsSync(`${backup}${suffix}`)) fail('backup snapshot must be a standalone SQLite file without journal sidecars');
  }
}
async function main() {
  const { directory, maxAgeHours } = parseArgs(process.argv);
  const root = path.resolve(directory);
  if (root === path.parse(root).root) fail('backup directory is unsafe');
  if (!fs.existsSync(root)) fail('backup directory does not exist');
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) fail('backup directory must be a non-symlinked directory');
  const candidates = fs.readdirSync(root).map((file) => ({ file, timestamp: timestampFromName(file) }))
    .filter((entry) => entry.timestamp).sort((a, b) => b.timestamp.time - a.timestamp.time || b.file.localeCompare(a.file));
  if (!candidates.length) fail('no canonical backup snapshot exists');
  const latest = candidates[0];
  const backup = path.join(root, latest.file);
  const checksum = `${backup}.sha256`;
  refuseSQLiteSidecars(backup);
  for (const [file, label] of [[backup, 'backup snapshot'], [checksum, 'checksum sidecar']]) {
    if (!fs.existsSync(file)) fail(`${label} is missing`);
    const stat = fs.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) fail(`${label} must be a non-symlinked regular file`);
  }
  const noFollow = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  let backupFd;
  let database;
  try {
    backupFd = fs.openSync(backup, noFollow);
    const backupStat = descriptorStat(backupFd);
    if (!backupStat.isFile()) fail('backup snapshot must be a non-symlinked regular file');
    if (backupStat.size === 0n) fail('backup snapshot is empty');
    if (!pathStillNamesDescriptor(backup, backupStat)) fail('backup snapshot changed during verification');
    const sidecar = fs.readFileSync(checksum, 'utf8');
    const match = /^([a-f0-9]{64})  ([A-Za-z0-9._-]+)\n$/.exec(sidecar);
    if (!match || match[2] !== latest.file) fail('checksum sidecar is not canonical or names another file');
    const actual = await hashFileDescriptor(backupFd);
    if (!crypto.timingSafeEqual(Buffer.from(match[1]), Buffer.from(actual))) fail('backup checksum mismatch');
    if (!unchangedFile(backupStat, descriptorStat(backupFd)) || !pathStillNamesDescriptor(backup, backupStat))
      fail('backup snapshot changed during verification');
    database = new DatabaseSync(`/proc/self/fd/${backupFd}`, { readOnly: true });
    if (database.prepare('PRAGMA integrity_check').get()?.integrity_check !== 'ok') fail('backup integrity check failed');
    if (findMissingSchemaObjects(database).length) fail('backup is missing required Blackspire schema');
    database.close(); database = null;
    if (!unchangedFile(backupStat, descriptorStat(backupFd)) || !pathStillNamesDescriptor(backup, backupStat))
      fail('backup snapshot changed during verification');
    refuseSQLiteSidecars(backup);
    const sizeBytes = Number(backupStat.size);
    const now = Date.now();
    if (latest.timestamp.time > now + 300_000) fail('latest backup timestamp is implausibly in the future');
    const ageHours = Math.max(0, (now - latest.timestamp.time) / 3_600_000);
    if (maxAgeHours !== null && ageHours > maxAgeHours) fail('latest backup exceeds the required maximum age');
    console.log(JSON.stringify({ ok: true, backup: { file: latest.file, createdAt: latest.timestamp.iso,
      ageHours: Number(ageHours.toFixed(3)), sizeBytes, checksum: 'match', integrity: 'ok', schemaCompatible: true } }));
  } catch (error) {
    if (/^backup verification failed:/.test(String(error?.message || ''))) throw error;
    fail('backup could not be validated');
  } finally { database?.close(); if (backupFd !== undefined) fs.closeSync(backupFd); }
}
try { await main(); } catch (error) {
  const message = String(error?.message || '');
  console.error(message.startsWith('backup verification failed:') ? message : 'backup verification failed: filesystem operation failed');
  process.exit(1);
}
