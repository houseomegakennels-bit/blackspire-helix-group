#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const value = (name) => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
const action = args.find((arg) => ['status', 'acquire', 'release', 'recover'].includes(arg)) || 'status';
const target = value('--target');
const root = value('--release-root');
const apply = args.includes('--apply');
const acknowledgement = value('--ack');
const owner = value('--owner');
const maxAgeSeconds = Number(value('--max-age-seconds') || '1800');

function refuse(message, code = 1) { console.error(`deployment lock refused: ${message}`); process.exit(code); }
if (!['staging', 'production'].includes(target)) refuse('--target must be staging or production', 2);
if (!root || !path.isAbsolute(root) || root === path.parse(root).root) refuse('--release-root must be an explicit safe absolute path', 2);
if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 60 || maxAgeSeconds > 86400) refuse('--max-age-seconds must be between 60 and 86400', 2);

const lockDirectory = path.join(path.resolve(root), 'shared', 'deploy');
const lockPath = path.join(lockDirectory, `${target}.lock`);
const now = Date.now();
function readLock() {
  if (!fs.existsSync(lockPath)) return null;
  const stat = fs.lstatSync(lockPath);
  if (!stat.isFile() || stat.isSymbolicLink()) refuse('lock path is not a regular non-symlink file');
  let lock;
  try { lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch { refuse('lock record is malformed; manual inspection is required'); }
  if (lock.version !== 1 || lock.target !== target || !Number.isInteger(lock.pid) || !Number.isFinite(Date.parse(lock.createdAt)) || !/^[a-f0-9]{32}$/.test(lock.nonce || '')) refuse('lock record is invalid; manual inspection is required');
  let processAlive = false;
  try { process.kill(lock.pid, 0); processAlive = true; } catch (error) { if (error.code === 'EPERM') processAlive = true; }
  const ageSeconds = Math.max(0, Math.floor((now - Date.parse(lock.createdAt)) / 1000));
  return { ...lock, ageSeconds, processAlive, stale: !processAlive && ageSeconds >= maxAgeSeconds };
}
function output(status, lock = null) { console.log(JSON.stringify({ ok: true, action, target, lockPath, status, lock }, null, 2)); }

const current = readLock();
if (action === 'status') output(current ? (current.stale ? 'stale' : 'held') : 'unlocked', current);
else {
  if (!apply) refuse(`${action} is plan-only without --apply`);
  if (target !== 'staging') refuse('production lock mutation requires a separately authorized deployment runner');
  if (!owner || !/^[A-Za-z0-9._-]{3,64}$/.test(owner)) refuse('--owner must be a bounded audit identifier');
  if (action === 'acquire') {
    if (current) refuse(current.stale ? 'a stale lock exists; inspect and use explicit recover' : 'deployment lock is already held');
    fs.mkdirSync(lockDirectory, { recursive: true, mode: 0o700 });
    const record = { version: 1, target, owner, pid: process.pid, createdAt: new Date(now).toISOString(), nonce: crypto.randomBytes(16).toString('hex') };
    try { fs.writeFileSync(lockPath, `${JSON.stringify(record)}\n`, { flag: 'wx', mode: 0o600 }); } catch (error) { refuse(error.code === 'EEXIST' ? 'deployment lock was acquired concurrently' : 'could not create deployment lock'); }
    output('acquired', record);
  } else {
    if (!current) refuse('deployment lock does not exist');
    if (action === 'release') {
      if (current.owner !== owner || acknowledgement !== current.nonce) refuse('release requires the matching owner and nonce acknowledgement');
    } else if (action === 'recover') {
      if (!current.stale) refuse('lock is not provably stale');
      if (acknowledgement !== `RECOVER-${target.toUpperCase()}-LOCK`) refuse(`recover requires --ack RECOVER-${target.toUpperCase()}-LOCK`);
    }
    fs.unlinkSync(lockPath);
    output(action === 'release' ? 'released' : 'recovered', { owner: current.owner, ageSeconds: current.ageSeconds, stale: current.stale });
  }
}
