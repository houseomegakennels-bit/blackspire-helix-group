#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { assertNoSymlinkTraversal } from '../packages/shared/deployment-lock-safety.js';

const args = process.argv.slice(2);
const value = (name) => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
const action = args.find((arg) => ['status', 'acquire', 'release', 'recover'].includes(arg)) || 'status';
const target = value('--target');
const root = value('--release-root');
const apply = args.includes('--apply');
const acknowledgement = value('--ack');
const owner = value('--owner');
const ownerPid = Number(value('--owner-pid'));
const maxAgeSeconds = Number(value('--max-age-seconds') || '1800');

function refuse(message, code = 1) { console.error(`deployment lock refused: ${message}`); process.exit(code); }
if (!['staging', 'production'].includes(target)) refuse('--target must be staging or production', 2);
if (!root || !path.isAbsolute(root) || root === path.parse(root).root) refuse('--release-root must be an explicit safe absolute path', 2);
if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 60 || maxAgeSeconds > 86400) refuse('--max-age-seconds must be between 60 and 86400', 2);

const lockDirectory = path.join(path.resolve(root), 'shared', 'deploy');
const lockPath = path.join(lockDirectory, `${target}.lock`);
const now = Date.now();
let directoryFd = null;
let directoryIdentity = null;
function openLockDirectory() {
  if (!fs.existsSync(lockDirectory)) return false;
  assertNoSymlinkTraversal(lockDirectory);
  directoryFd = fs.openSync(lockDirectory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  directoryIdentity = fs.fstatSync(directoryFd);
  const current = fs.statSync(lockDirectory);
  if (current.dev !== directoryIdentity.dev || current.ino !== directoryIdentity.ino) refuse('lock directory changed while it was opened');
  return true;
}
function boundPath(name = `${target}.lock`) { return `/proc/self/fd/${directoryFd}/${name}`; }
function assertDirectoryStillBound() {
  const current = fs.statSync(lockDirectory);
  if (current.dev !== directoryIdentity.dev || current.ino !== directoryIdentity.ino) throw new Error('lock directory was substituted during the operation');
}
function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  try {
    process.kill(pid, 0);
    const statRecord = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').trim();
    const fieldsAfterCommand = statRecord.slice(statRecord.lastIndexOf(') ') + 2).split(' ');
    const startTicks = fieldsAfterCommand[19]; // field 22; this array begins at proc stat field 3.
    const bootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    if (!/^[0-9]+$/.test(startTicks || '') || !/^[a-f0-9-]{36}$/.test(bootId)) return null;
    return { pid, startTicks, bootId };
  } catch { return null; }
}
function snapshotBoundLock() {
  const file = boundPath();
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('lock path is not a regular non-symlink file');
  return { raw: fs.readFileSync(file, 'utf8'), dev: stat.dev, ino: stat.ino };
}
function removeBoundLock(expected) {
  assertDirectoryStillBound();
  const immediate = snapshotBoundLock();
  if (immediate.dev !== expected.dev || immediate.ino !== expected.ino || immediate.raw !== expected.raw) throw new Error('lock changed after authorization');
  const quarantineName = `${target}.lock.remove-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
  fs.renameSync(boundPath(), boundPath(quarantineName));
  const moved = (() => { const stat = fs.lstatSync(boundPath(quarantineName)); return { raw: fs.readFileSync(boundPath(quarantineName), 'utf8'), dev: stat.dev, ino: stat.ino }; })();
  if (moved.dev !== expected.dev || moved.ino !== expected.ino || moved.raw !== expected.raw) throw new Error('lock was substituted before removal');
  fs.unlinkSync(boundPath(quarantineName));
  assertDirectoryStillBound();
}
function readLock() {
  if (directoryFd === null || !fs.existsSync(boundPath())) return null;
  let snapshot;
  try { snapshot = snapshotBoundLock(); } catch (error) { refuse(error.message); }
  let lock;
  try { lock = JSON.parse(snapshot.raw); } catch { refuse('lock record is malformed; manual inspection is required'); }
  if (lock.version !== 2 || lock.target !== target || !Number.isInteger(lock.ownerProcess?.pid) || !/^[0-9]+$/.test(lock.ownerProcess?.startTicks || '') || !/^[a-f0-9-]{36}$/.test(lock.ownerProcess?.bootId || '') || !Number.isFinite(Date.parse(lock.createdAt)) || !/^[a-f0-9]{32}$/.test(lock.nonce || '')) refuse('lock record is invalid; manual inspection is required');
  const observed = processIdentity(lock.ownerProcess.pid);
  const processAlive = observed !== null && observed.startTicks === lock.ownerProcess.startTicks && observed.bootId === lock.ownerProcess.bootId;
  const ageSeconds = Math.max(0, Math.floor((now - Date.parse(lock.createdAt)) / 1000));
  const result = { ...lock, ageSeconds, processAlive, stale: !processAlive && ageSeconds >= maxAgeSeconds };
  Object.defineProperty(result, '_identity', { value: snapshot, enumerable: false });
  return result;
}
function output(status, lock = null) { console.log(JSON.stringify({ ok: true, action, target, lockPath, status, lock }, null, 2)); }

try { assertNoSymlinkTraversal(lockDirectory); openLockDirectory(); } catch (error) { refuse(error.message); }
const current = readLock();
if (action === 'status') output(current ? (current.stale ? 'stale' : 'held') : 'unlocked', current);
else {
  if (!apply) refuse(`${action} is plan-only without --apply`);
  if (target !== 'staging') refuse('production lock mutation requires a separately authorized deployment runner');
  if (!owner || !/^[A-Za-z0-9._-]{3,64}$/.test(owner)) refuse('--owner must be a bounded audit identifier');
  if (action === 'acquire') {
    if (current) refuse(current.stale ? 'a stale lock exists; inspect and use explicit recover' : 'deployment lock is already held');
    const durableOwner = processIdentity(ownerPid);
    if (!durableOwner) refuse('acquire requires --owner-pid for a live durable deployment runner');
    try { assertNoSymlinkTraversal(lockDirectory); fs.mkdirSync(lockDirectory, { recursive: true, mode: 0o700 }); assertNoSymlinkTraversal(lockDirectory); if (directoryFd === null) openLockDirectory(); } catch (error) { refuse(error.message); }
    const record = { version: 2, target, owner, ownerProcess: durableOwner, createdAt: new Date(now).toISOString(), nonce: crypto.randomBytes(16).toString('hex') };
    try { fs.writeFileSync(boundPath(), `${JSON.stringify(record)}\n`, { flag: 'wx', mode: 0o600 }); assertDirectoryStillBound(); } catch (error) { try { if (directoryFd !== null && fs.existsSync(boundPath())) fs.unlinkSync(boundPath()); } catch {} refuse(error.code === 'EEXIST' ? 'deployment lock was acquired concurrently' : error.message); }
    output('acquired', record);
  } else {
    if (!current) refuse('deployment lock does not exist');
    if (action === 'release') {
      if (current.owner !== owner || acknowledgement !== current.nonce) refuse('release requires the matching owner and nonce acknowledgement');
    } else if (action === 'recover') {
      if (!current.stale) refuse('lock is not provably stale');
      if (acknowledgement !== `RECOVER-${target.toUpperCase()}-LOCK`) refuse(`recover requires --ack RECOVER-${target.toUpperCase()}-LOCK`);
    }
    try { removeBoundLock(current._identity); } catch (error) { refuse(error.message); }
    output(action === 'release' ? 'released' : 'recovered', { owner: current.owner, ageSeconds: current.ageSeconds, stale: current.stale });
  }
}
