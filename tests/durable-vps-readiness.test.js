import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-vps-readiness-'));
const node = process.execPath;

function run(script, args, env = {}) {
  const command = script.endsWith('.sh') ? 'bash' : node;
  return spawnSync(command, [script, ...args], { cwd: process.cwd(), env: { ...process.env, ...env }, encoding: 'utf8' });
}

test('WAL-safe backup and disposable restore preserve committed state and checksum', () => {
  const dbDir = path.join(root, 'state');
  const backupDir = path.join(root, 'backups');
  const dbPath = path.join(dbDir, 'command.sqlite');
  fs.mkdirSync(dbDir, { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE evidence(id TEXT PRIMARY KEY, value TEXT); INSERT INTO evidence VALUES (\'one\', \'redacted\');');
  db.close();
  const backed = run('scripts/backup.js', [backupDir], { BLACKSPIRE_DB_PATH: dbPath });
  assert.equal(backed.status, 0, backed.stderr);
  const record = JSON.parse(backed.stdout);
  assert.equal(fs.statSync(record.backup).mode & 0o777, 0o600);
  const restored = path.join(root, 'disposable', 'command.sqlite');
  const restoredResult = run('scripts/restore.js', [record.backup, restored], { BLACKSPIRE_DB_PATH: dbPath, NODE_ENV: 'test' });
  assert.equal(restoredResult.status, 0, restoredResult.stderr);
  const check = new DatabaseSync(restored, { readOnly: true });
  assert.equal(check.prepare('SELECT value FROM evidence WHERE id=?').get('one').value, 'redacted');
  check.close();
  assert.match(fs.readFileSync(record.checksum, 'utf8'), /^[a-f0-9]{64}/);
});

test('release creation is exact, idempotent, and switching is atomic', () => {
  const releaseRoot = path.join(root, 'releases');
  const sha = '405a4166a5ce4d350573bce35dfa9f424a309596';
  const env = { BLACKSPIRE_RELEASE_ROOT: releaseRoot, BLACKSPIRE_SOURCE_ROOT: process.cwd() };
  const created = run('scripts/release-create.sh', [sha], env);
  assert.equal(created.status, 0, created.stderr);
  const release = created.stdout.trim();
  assert.equal(fs.readFileSync(path.join(release, 'COMMIT_SHA'), 'utf8').trim(), sha);
  assert.ok(fs.existsSync(path.join(release, '.release-complete')));
  assert.equal(run('scripts/release-create.sh', [sha], env).stdout.trim(), release);
  assert.equal(run('scripts/release-switch.sh', [sha], env).status, 0);
  assert.equal(fs.realpathSync(path.join(releaseRoot, 'current')), release);
});

test('production verifier fails closed for provider credentials and test mode', () => {
  const env = { NODE_ENV: 'production', BLACKSPIRE_RUNTIME_MODE: 'production', BLACKSPIRE_STATE_OWNER: 'vps-production', BLACKSPIRE_DB_PATH: '/opt/blackspire-vps-readiness/command.sqlite', BLACKSPIRE_PROVIDER_MODE: 'manual', BLACKSPIRE_HERMES_MODE: 'restricted', COMMAND_ADMIN_TOKEN: 'x'.repeat(32), SESSION_SECRET: 'y'.repeat(40), OPENAI_API_KEY: 'forbidden' };
  const result = run('scripts/verify-environment.sh', ['vps-production'], env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /OPENAI_API_KEY/);
});
