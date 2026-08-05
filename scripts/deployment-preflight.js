#!/usr/bin/env node
// Read-only, audited staging deployment decision. It never locks, switches, migrates or deploys.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { findMissingSchemaObjects } from '../packages/shared/schema-validation.js';

const args = process.argv.slice(2);
const value = (name) => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
const target = value('--target'); const commit = value('--commit'); const rollback = value('--rollback');
const releaseRoot = value('--release-root'); const backup = value('--backup');
const sourceRoot = path.resolve(value('--source-root') || process.cwd());
const environment = value('--environment'); const stateOwner = value('--state-owner');
const providerMode = value('--provider-mode'); const database = value('--database');
const checks = []; const check = (id, ok, detail) => checks.push({ id, ok, detail });
const git = (...gitArgs) => spawnSync('/usr/bin/git', ['-C', sourceRoot, ...gitArgs], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
const fullSha = /^[0-9a-f]{40}$/;
const safeAbsolute = (candidate) => Boolean(candidate) && path.isAbsolute(candidate) && path.resolve(candidate) !== path.parse(path.resolve(candidate)).root;

check('target-staging', target === 'staging', 'only the isolated staging target is accepted');
check('explicit-environment', environment === 'staging', 'environment identity must be exactly staging');
check('state-owner', stateOwner === 'vps-staging', 'state owner must be exactly vps-staging');
check('providers-disabled', ['manual', 'mock'].includes(providerMode), 'provider mode must be manual or mock');
check('release-root-safe', safeAbsolute(releaseRoot), 'release root must be an explicit safe absolute path');
check('database-safe', safeAbsolute(database) && !path.resolve(database || '/').startsWith('/opt/blackspire-command/shared/database/'), 'database must be explicit and outside the production database namespace');
check('commit-format', fullSha.test(commit || ''), 'deployment commit must be a full lowercase SHA');
check('rollback-format', fullSha.test(rollback || '') && rollback !== commit, 'rollback must be a distinct full lowercase SHA');
const head = git('rev-parse', 'HEAD');
check('source-git-repository', head.status === 0, 'source root must be a Git repository');
check('head-match', head.status === 0 && head.stdout.trim() === commit, 'source HEAD must equal the requested deployment commit');
const dirty = git('status', '--porcelain=v1', '--untracked-files=all');
check('clean-tree', dirty.status === 0 && dirty.stdout === '', 'tracked and untracked source changes are refused');
check('commit-present', git('cat-file', '-e', `${commit}^{commit}`).status === 0, 'deployment commit must exist locally');

function releaseCheck(id, sha) {
  if (!safeAbsolute(releaseRoot) || !fullSha.test(sha || '')) return check(id, false, 'release inputs are invalid');
  const result = spawnSync('/bin/bash', [path.join(sourceRoot, 'scripts', 'release-preflight.sh'), sha], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', BLACKSPIRE_RELEASE_ROOT: path.resolve(releaseRoot) } });
  check(id, result.status === 0, result.status === 0 ? `completed immutable release ${sha}` : `release ${sha} failed immutable-tree validation`);
}
releaseCheck('candidate-release', commit); releaseCheck('rollback-release', rollback);

let backupDigest = null;
try {
  if (!safeAbsolute(backup) || !fs.existsSync(backup) || fs.lstatSync(backup).isSymbolicLink() || !fs.statSync(backup).isFile()) throw new Error('backup path is not a regular non-symlink file');
  const sidecar = `${backup}.sha256`;
  if (!fs.existsSync(sidecar) || fs.lstatSync(sidecar).isSymbolicLink()) throw new Error('checksum sidecar is absent or unsafe');
  const ageSeconds = Math.floor((Date.now() - fs.statSync(backup).mtimeMs) / 1000);
  if (ageSeconds < 0 || ageSeconds > 86400) throw new Error('backup is older than 24 hours');
  const expected = fs.readFileSync(sidecar, 'utf8').trim().split(/\s+/)[0];
  backupDigest = crypto.createHash('sha256').update(fs.readFileSync(backup)).digest('hex');
  if (!/^[a-f0-9]{64}$/.test(expected) || expected !== backupDigest) throw new Error('backup checksum does not match');
  const db = new DatabaseSync(backup, { readOnly: true });
  try { if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') throw new Error('backup integrity check failed'); const missing = findMissingSchemaObjects(db); if (missing.length) throw new Error('backup is missing required schema objects'); } finally { db.close(); }
  check('verified-recent-backup', true, 'backup checksum, age, integrity, and schema verified');
} catch (error) { check('verified-recent-backup', false, error.message); }
const lockPath = safeAbsolute(releaseRoot) ? path.join(path.resolve(releaseRoot), 'shared', 'deploy', 'staging.lock') : null;
check('deployment-unlocked', lockPath !== null && !fs.existsSync(lockPath), 'preflight requires no existing staging deployment lock');
const fingerprintInput = { version: 1, target, environment, stateOwner, providerMode, commit, rollback, releaseRoot: safeAbsolute(releaseRoot) ? path.resolve(releaseRoot) : null, database: safeAbsolute(database) ? path.resolve(database) : null, backupSha256: backupDigest };
const fingerprint = crypto.createHash('sha256').update(JSON.stringify(fingerprintInput)).digest('hex');
const ok = checks.every((item) => item.ok);
console.log(JSON.stringify({ schemaVersion: 1, kind: 'blackspire-deployment-preflight', ok, readOnly: true, fingerprint, fingerprintInput, checks, recommendation: ok ? 'SAFE_TO_REQUEST_OPERATOR_STAGING_DEPLOYMENT' : 'REFUSE_DEPLOYMENT' }, null, 2));
process.exit(ok ? 0 : 1);
