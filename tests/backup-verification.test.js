import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-backup-verify-'));
const database = path.join(root, 'database', 'command.sqlite');
const backups = path.join(root, 'backups');
const node = process.execPath;
const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
const { requireVerificationPlatform } = await import('../scripts/verify-latest-backup.js');
prepareDisposableDatabase(database);
test.after(() => fs.rmSync(root, { recursive: true, force: true }));
function run(args = []) { return spawnSync(node, ['scripts/verify-latest-backup.js', backups, ...args], { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, BLACKSPIRE_DB_PATH: database } }); }
function runWithImport(preload, env = {}) {
  return spawnSync(node, ['--import', preload, 'scripts/verify-latest-backup.js', backups],
    { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, ...env, BLACKSPIRE_DB_PATH: database } });
}
function createBackup() {
  const result = spawnSync(node, ['scripts/backup.js', backups], { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, BLACKSPIRE_DB_PATH: database } });
  assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
}
test('latest backup verifier proves recency, checksum, integrity, and schema with sanitized output', () => {
  const created = createBackup(); const result = run(['--max-age-hours', '1']);
  assert.equal(result.status, 0, result.stderr); const report = JSON.parse(result.stdout);
  assert.equal(report.ok, true); assert.equal(report.backup.file, path.basename(created.backup));
  assert.equal(report.backup.checksum, 'match'); assert.equal(report.backup.integrity, 'ok'); assert.equal(report.backup.schemaCompatible, true);
  assert.equal(result.stdout.includes(root), false); assert.equal(Object.hasOwn(report.backup, 'sha256'), false);
});
test('latest backup verifier refuses a mismatched checksum and a symlinked sidecar', () => {
  const latest = fs.readdirSync(backups).find((file) => file.endsWith('.sqlite')); const sidecar = path.join(backups, `${latest}.sha256`);
  const original = fs.readFileSync(sidecar, 'utf8'); fs.writeFileSync(sidecar, `${'0'.repeat(64)}  ${latest}\n`);
  assert.match(run().stderr, /checksum mismatch/); fs.rmSync(sidecar);
  fs.writeFileSync(path.join(root, 'sidecar-target'), original); fs.symlinkSync(path.join(root, 'sidecar-target'), sidecar);
  assert.match(run().stderr, /non-symlinked regular file/); fs.rmSync(sidecar); fs.writeFileSync(sidecar, original, { mode: 0o600 });
});
test('latest backup verifier refuses WAL and rollback-journal sidecars', () => {
  const latest = fs.readdirSync(backups).find((file) => file.endsWith('.sqlite'));
  for (const suffix of ['-wal', '-journal', '-shm']) {
    const sidecar = path.join(backups, `${latest}${suffix}`);
    fs.writeFileSync(sidecar, 'uncheckpointed-state');
    const result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /standalone SQLite file without journal sidecars/);
    assert.equal(result.stderr.includes(root), false, 'sidecar refusal never exposes the absolute backup path');
    fs.rmSync(sidecar);
  }
});
test('unsupported no-follow capability fails before opening any descriptor', () => {
  let opens = 0;
  assert.throws(() => requireVerificationPlatform({
    constants: { O_RDONLY: 0, O_NOFOLLOW: 0 },
    openSync() { opens += 1; throw new Error('must not open'); },
  }), /required no-follow and descriptor filesystem support is unavailable/);
  assert.equal(opens, 0);
});
test('latest backup verifier refuses a journal sidecar introduced after the initial check', () => {
  const latest = fs.readdirSync(backups).find((file) => file.endsWith('.sqlite'));
  const backup = path.join(backups, latest);
  const injected = `${backup}-wal`;
  const preload = path.join(root, 'inject-sidecar-after-open.mjs');
  fs.writeFileSync(preload, `import fs from 'node:fs';\nconst original = fs.fstatSync;\nlet targetStats = 0;\nfs.fstatSync = function(fd, ...args) {\n  const result = original.call(this, fd, ...args);\n  const link = fs.readlinkSync('/proc/self/fd/' + fd);\n  if (link === process.env.INJECT_TARGET && ++targetStats === 2) fs.writeFileSync(process.env.INJECT_SIDECAR, 'late journal state');\n  return result;\n};\n`);
  const result = runWithImport(preload, { INJECT_TARGET: backup, INJECT_SIDECAR: injected });
  try {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /standalone SQLite file without journal sidecars/);
    assert.equal(result.stderr.includes(root), false);
  } finally {
    for (const suffix of ['-wal', '-shm', '-journal']) fs.rmSync(`${backup}${suffix}`, { force: true });
  }
});
test('latest backup verifier refuses pathname replacement after opening the snapshot inode', () => {
  const latest = fs.readdirSync(backups).find((file) => file.endsWith('.sqlite'));
  const backup = path.join(backups, latest);
  const replacement = path.join(root, 'byte-identical-replacement.sqlite');
  const displaced = `${backup}.opened-original`;
  fs.copyFileSync(backup, replacement);
  const preload = path.join(root, 'replace-after-open.mjs');
  fs.writeFileSync(preload, `import fs from 'node:fs';\nconst original = fs.openSync;\nfs.openSync = function(file, ...args) {\n  const fd = original.call(this, file, ...args);\n  if (String(file) === process.env.REPLACE_TARGET) {\n    fs.renameSync(file, process.env.DISPLACED_TARGET);\n    fs.renameSync(process.env.REPLACEMENT_SOURCE, file);\n  }\n  return fd;\n};\n`);
  const result = runWithImport(preload, { REPLACE_TARGET: backup, DISPLACED_TARGET: displaced, REPLACEMENT_SOURCE: replacement });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /backup snapshot changed during verification/);
  assert.equal(result.stderr.includes(root), false, 'replacement refusal never exposes an absolute path');
  fs.rmSync(backup); fs.renameSync(displaced, backup);
});
test('unexpected filesystem failures are sanitized', () => {
  const preload = path.join(root, 'fail-directory-read.mjs');
  fs.writeFileSync(preload, `import fs from 'node:fs';\nconst original = fs.readdirSync;\nfs.readdirSync = function(directory, ...args) {\n  if (String(directory) === process.env.FAIL_DIRECTORY) throw new Error('private path: ' + directory);\n  return original.call(this, directory, ...args);\n};\n`);
  const result = runWithImport(preload, { FAIL_DIRECTORY: path.resolve(backups) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /^backup verification failed: filesystem operation failed\n$/);
  assert.equal(result.stderr.includes(root), false);
});
test('latest backup verifier refuses future/stale snapshots and malformed age bounds', () => {
  const latest = fs.readdirSync(backups).find((file) => file.endsWith('.sqlite')); const futureName = 'command-29990101T000000Z.sqlite';
  fs.renameSync(path.join(backups, latest), path.join(backups, futureName)); const futureSidecar = path.join(backups, `${latest}.sha256`);
  const digest = fs.readFileSync(futureSidecar, 'utf8').split(/\s+/)[0]; fs.renameSync(futureSidecar, path.join(backups, `${futureName}.sha256`));
  fs.writeFileSync(path.join(backups, `${futureName}.sha256`), `${digest}  ${futureName}\n`, { mode: 0o600 });
  assert.match(run(['--max-age-hours', '24']).stderr, /implausibly in the future/);
  const oldName = 'command-20000101T000000Z.sqlite';
  fs.renameSync(path.join(backups, futureName), path.join(backups, oldName));
  fs.renameSync(path.join(backups, `${futureName}.sha256`), path.join(backups, `${oldName}.sha256`));
  fs.writeFileSync(path.join(backups, `${oldName}.sha256`), `${digest}  ${oldName}\n`, { mode: 0o600 });
  assert.match(run(['--max-age-hours', '24']).stderr, /exceeds the required maximum age/);
  assert.match(run(['--max-age-hours', '0']).stderr, /positive integer/);
});
