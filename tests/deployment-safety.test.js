import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { removeIdenticalFile, snapshotRegularFile } from '../packages/shared/deployment-lock-safety.js';

const repository = path.resolve(import.meta.dirname, '..');
const run = (script, args) => spawnSync(process.execPath, [path.join(repository, 'scripts', script), ...args], { cwd: repository, encoding: 'utf8', env: process.env });
const runAsync = (script, args, env = {}) => new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(repository, 'scripts', script), ...args], { cwd: repository, env: { ...process.env, ...env } });
  let stdout = ''; let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', (status) => resolve({ status, stdout, stderr }));
});
const git = (cwd, args) => spawnSync('/usr/bin/git', ['-C', cwd, ...args], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-deploy-safety-'));
  const source = path.join(root, 'source'); fs.mkdirSync(source); fs.mkdirSync(path.join(source, 'scripts'));
  // This fixture validator mirrors the externally visible completed-release boundary without
  // requiring root:blackspire ownership, which the trusted runner intentionally cannot grant.
  // The production validator is unchanged and has its ownership contract tested separately.
  fs.writeFileSync(path.join(source, 'scripts', 'release-preflight.sh'), `#!/usr/bin/env bash
set -euo pipefail
sha="\${1:-}"
root="\${BLACKSPIRE_RELEASE_ROOT:?}"
release="$root/releases/$sha"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]]
[[ -d "$release" && ! -L "$release" ]]
[[ -f "$release/.release-complete" && ! -L "$release/.release-complete" ]]
[[ -f "$release/COMMIT_SHA" && ! -L "$release/COMMIT_SHA" ]]
[[ "$(<"$release/COMMIT_SHA")" == "$sha" ]]
`);
  git(source, ['init', '-q']); git(source, ['config', 'user.email', 'fixture@example.invalid']); git(source, ['config', 'user.name', 'Fixture']);
  git(source, ['add', '.']); git(source, ['commit', '-qm', 'rollback']); const rollback = git(source, ['rev-parse', 'HEAD']).stdout.trim();
  fs.writeFileSync(path.join(source, 'candidate.txt'), 'candidate\n'); git(source, ['add', '.']); git(source, ['commit', '-qm', 'candidate']); const commit = git(source, ['rev-parse', 'HEAD']).stdout.trim();
  const releaseRoot = path.join(root, 'release-root');
  for (const sha of [rollback, commit]) { const directory = path.join(releaseRoot, 'releases', sha); fs.mkdirSync(directory, { recursive: true, mode: 0o755 }); fs.writeFileSync(path.join(directory, '.release-complete'), ''); fs.writeFileSync(path.join(directory, 'COMMIT_SHA'), `${sha}\n`); }
  const database = path.join(root, 'staging.sqlite');
  const migration = spawnSync(process.execPath, [path.join(repository, 'scripts', 'migrate.js')], { cwd: repository, encoding: 'utf8', env: { ...process.env, BLACKSPIRE_RUN_MIGRATIONS: 'true', BLACKSPIRE_DB_PATH: database } });
  assert.equal(migration.status, 0, migration.stderr);
  const backup = path.join(root, 'backup.sqlite'); fs.copyFileSync(database, backup); const digest = crypto.createHash('sha256').update(fs.readFileSync(backup)).digest('hex'); fs.writeFileSync(`${backup}.sha256`, `${digest}  backup.sqlite\n`);
  return { source, releaseRoot, database, backup, commit, rollback };
}

test('deployment lock is plan-only, exclusive, ownership-bound, and reports stale locks', async (t) => {
  const durableOwner = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
  t.after(() => { try { durableOwner.kill('SIGKILL'); } catch {} });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-lock-')); const base = ['--target', 'staging', '--release-root', root, '--owner', 'test-operator', '--owner-pid', String(durableOwner.pid)];
  assert.match(run('deployment-lock.js', ['acquire', ...base]).stderr, /plan-only/);
  const acquired = run('deployment-lock.js', ['acquire', ...base, '--apply']); assert.equal(acquired.status, 0, acquired.stderr); const record = JSON.parse(acquired.stdout).lock;
  const held = JSON.parse(run('deployment-lock.js', ['status', ...base, '--max-age-seconds', '60']).stdout); assert.equal(held.status, 'held'); assert.equal(held.lock.processAlive, true);
  assert.match(run('deployment-lock.js', ['recover', ...base, '--max-age-seconds', '60', '--ack', 'RECOVER-STAGING-LOCK', '--apply']).stderr, /not provably stale/);
  assert.match(run('deployment-lock.js', ['acquire', ...base, '--apply']).stderr, /already held/);
  const lockPath = path.join(root, 'shared', 'deploy', 'staging.lock');
  const winner = fs.readFileSync(lockPath, 'utf8');
  assert.match(run('deployment-lock.js', ['acquire', ...base, '--apply']).stderr, /already held/);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), winner, 'a losing acquisition must preserve the winner lock byte-for-byte');
  assert.match(run('deployment-lock.js', ['release', ...base, '--ack', 'wrong', '--apply']).stderr, /matching owner and nonce/);
  assert.equal(run('deployment-lock.js', ['release', ...base, '--ack', record.nonce, '--apply']).status, 0);
  assert.match(run('deployment-lock.js', ['acquire', '--target', 'production', '--release-root', root, '--owner', 'test-operator', '--apply']).stderr, /separately authorized/);
  const lockDirectory = path.join(root, 'shared', 'deploy'); fs.mkdirSync(lockDirectory, { recursive: true }); fs.writeFileSync(path.join(lockDirectory, 'staging.lock'), JSON.stringify({ version: 2, target: 'staging', owner: 'old-operator', ownerProcess: { pid: 2147483647, startTicks: '1', bootId: '00000000-0000-0000-0000-000000000000' }, createdAt: '2000-01-01T00:00:00.000Z', nonce: 'a'.repeat(32) }));
  assert.equal(JSON.parse(run('deployment-lock.js', ['status', ...base, '--max-age-seconds', '60']).stdout).status, 'stale');
  assert.match(run('deployment-lock.js', ['recover', ...base, '--max-age-seconds', '60', '--apply']).stderr, /RECOVER-STAGING-LOCK/);
  assert.equal(run('deployment-lock.js', ['recover', ...base, '--max-age-seconds', '60', '--ack', 'RECOVER-STAGING-LOCK', '--apply']).status, 0);
});

test('lock mutation refuses symlink traversal and replacement before removal', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-lock-adversary-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-lock-outside-'));
  fs.symlinkSync(outside, path.join(root, 'shared'));
  const symlinked = run('deployment-lock.js', ['acquire', '--target', 'staging', '--release-root', root, '--owner', 'test-operator', '--owner-pid', String(process.pid), '--apply']);
  assert.equal(symlinked.status, 1); assert.match(symlinked.stderr, /path contains a symlink/); assert.equal(fs.readdirSync(outside).length, 0);

  const lockDirectory = path.join(root, 'real', 'shared', 'deploy'); fs.mkdirSync(lockDirectory, { recursive: true });
  const lockPath = path.join(lockDirectory, 'staging.lock'); fs.writeFileSync(lockPath, 'authorized');
  const expected = snapshotRegularFile(lockPath);
  assert.throws(() => removeIdenticalFile(lockPath, expected, { beforeRename() { fs.renameSync(lockPath, `${lockPath}.original`); fs.writeFileSync(lockPath, 'substitute'); } }), /substituted before removal/);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), 'substitute');
  assert.equal(fs.readFileSync(`${lockPath}.original`, 'utf8'), 'authorized');
});

test('a concurrent acquisition loser preserves the winner lock', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-lock-race-'));
  const args = ['acquire', '--target', 'staging', '--release-root', root, '--owner', 'race-operator', '--owner-pid', String(process.pid), '--apply'];
  const env = { NODE_ENV: 'test', BLACKSPIRE_TEST_LOCK_WRITE_DELAY_MS: '300' };
  const results = await Promise.all([runAsync('deployment-lock.js', args, env), runAsync('deployment-lock.js', args, env)]);
  assert.deepEqual(results.map(({ status }) => status).sort(), [0, 1]);
  assert.match(results.find(({ status }) => status === 1).stderr, /acquired concurrently/);
  const lockPath = path.join(root, 'shared', 'deploy', 'staging.lock');
  assert.equal(fs.existsSync(lockPath), true, 'the winner lock must survive the losing EEXIST path');
  const record = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  assert.equal(record.owner, 'race-operator'); assert.equal(record.ownerProcess.pid, process.pid);
});

test('disposable staging preflight verifies fingerprint, backup, rollback and clean source', () => {
  const f = fixture(); const args = ['--target', 'staging', '--environment', 'staging', '--state-owner', 'vps-staging', '--provider-mode', 'manual', '--source-root', f.source, '--release-root', f.releaseRoot, '--database', f.database, '--backup', f.backup, '--commit', f.commit, '--rollback', f.rollback];
  const good = run('deployment-preflight.js', args); assert.equal(good.status, 0, good.stderr || good.stdout); const report = JSON.parse(good.stdout); assert.equal(report.ok, true); assert.equal(report.readOnly, true); assert.match(report.fingerprint, /^[a-f0-9]{64}$/);
  fs.writeFileSync(path.join(f.source, 'dirty.txt'), 'dirty\n'); const dirty = JSON.parse(run('deployment-preflight.js', args).stdout); assert.equal(dirty.checks.find((item) => item.id === 'clean-tree').ok, false); fs.rmSync(path.join(f.source, 'dirty.txt'));
  fs.appendFileSync(f.backup, 'tamper'); const tampered = JSON.parse(run('deployment-preflight.js', args).stdout); assert.equal(tampered.checks.find((item) => item.id === 'verified-recent-backup').ok, false);
});

test('preflight refuses a valid but superseded backup', () => {
  const f = fixture(); const newer = path.join(path.dirname(f.backup), 'newer.sqlite'); fs.copyFileSync(f.database, newer); const newerDigest = crypto.createHash('sha256').update(fs.readFileSync(newer)).digest('hex'); fs.writeFileSync(`${newer}.sha256`, `${newerDigest}  newer.sqlite\n`);
  const future = new Date(Date.now() + 1000); fs.utimesSync(newer, future, future);
  const args = ['--target', 'staging', '--environment', 'staging', '--state-owner', 'vps-staging', '--provider-mode', 'manual', '--source-root', f.source, '--release-root', f.releaseRoot, '--database', f.database, '--backup', f.backup, '--commit', f.commit, '--rollback', f.rollback];
  const report = JSON.parse(run('deployment-preflight.js', args).stdout); assert.equal(report.checks.find((item) => item.id === 'verified-recent-backup').ok, false); assert.match(report.checks.find((item) => item.id === 'verified-recent-backup').detail, /not the latest/);
});

test('preflight refuses production identity and production database namespace', () => {
  const f = fixture(); const args = ['--target', 'production', '--environment', 'production', '--state-owner', 'vps-production', '--provider-mode', 'openai', '--source-root', f.source, '--release-root', f.releaseRoot, '--database', '/opt/blackspire-command/shared/database/command.sqlite', '--backup', f.backup, '--commit', f.commit, '--rollback', f.rollback];
  const refused = run('deployment-preflight.js', args); assert.equal(refused.status, 1); const report = JSON.parse(refused.stdout); assert.equal(report.recommendation, 'REFUSE_DEPLOYMENT');
  for (const id of ['target-staging', 'explicit-environment', 'state-owner', 'providers-disabled', 'database-safe']) assert.equal(report.checks.find((item) => item.id === id).ok, false);
});

test('preflight refuses symlinked backup ancestors instead of following them', () => {
  const f = fixture(); const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-backup-outside-')); const linked = path.join(path.dirname(f.backup), 'linked-backups'); fs.symlinkSync(outside, linked);
  const backup = path.join(linked, 'backup.sqlite'); fs.copyFileSync(f.backup, path.join(outside, 'backup.sqlite')); fs.copyFileSync(`${f.backup}.sha256`, path.join(outside, 'backup.sqlite.sha256'));
  const args = ['--target', 'staging', '--environment', 'staging', '--state-owner', 'vps-staging', '--provider-mode', 'manual', '--source-root', f.source, '--release-root', f.releaseRoot, '--database', f.database, '--backup', backup, '--commit', f.commit, '--rollback', f.rollback];
  const report = JSON.parse(run('deployment-preflight.js', args).stdout); const check = report.checks.find((item) => item.id === 'verified-recent-backup'); assert.equal(check.ok, false); assert.match(check.detail, /path contains a symlink/);
});
