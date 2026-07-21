import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-migration-safety-'));
const node = process.execPath;

function run(script, args = [], env = {}) {
  return spawnSync(node, [script, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
}

function runUntilExit(script, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(node, [script], { cwd: process.cwd(), env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ exited: false, code: null, stderr });
    }, 1000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ exited: true, code, stderr });
    });
  });
}

function emptyDatabase(name) {
  const dbPath = path.join(root, `${name}.sqlite`);
  new DatabaseSync(dbPath).close();
  return dbPath;
}

function tableCount(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { return db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table'").get().count; } finally { db.close(); }
}

function integrity(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { return db.prepare('PRAGMA integrity_check').get().integrity_check; } finally { db.close(); }
}

const safeEnv = (dbPath) => ({
  BLACKSPIRE_DB_PATH: dbPath,
  BLACKSPIRE_DATA_DIR: path.dirname(dbPath),
  COMMAND_ADMIN_TOKEN: 'migration-safety-test-token',
  PORT: '0',
  TELEGRAM_MODE: 'dry-run',
  BLACKSPIRE_PROVIDER_MODE: 'manual',
  UNIFIED_IPHONE_TEST_MODE: 'false',
});

test('ordinary API and worker startup refuse an unmigrated database without changing its schema', async () => {
  for (const [name, script] of [['api', 'apps/api/server.js'], ['worker', 'apps/worker/worker.js']]) {
    const dbPath = emptyDatabase(name);
    const result = await runUntilExit(script, safeEnv(dbPath));
    assert.equal(result.exited, true, `${name} must fail before serving or polling`);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /migration required/i);
    assert.equal(tableCount(dbPath), 0, `${name} startup must not create schema`);
  }
});

test('dedicated migration command denies every value except exact true without changing a disposable database', () => {
  for (const [name, value] of [['absent', undefined], ['empty', ''], ['false', 'false'], ['zero', '0'], ['malformed', 'yes']]) {
    const dbPath = emptyDatabase(`denied-${name}`);
    const env = safeEnv(dbPath);
    if (value !== undefined) env.BLACKSPIRE_RUN_MIGRATIONS = value;
    const result = run('scripts/migrate.js', [], env);
    assert.notEqual(result.status, 0, `${name} must be denied`);
    assert.match(result.stderr, /BLACKSPIRE_RUN_MIGRATIONS=true/);
    assert.equal(tableCount(dbPath), 0, `${name} must not mutate schema`);
  }
});

test('exact true migrates only a disposable database, is idempotent, and enables compatible startup', async () => {
  const dbPath = path.join(root, 'explicit.sqlite');
  const first = run('scripts/migrate.js', [], { ...safeEnv(dbPath), BLACKSPIRE_RUN_MIGRATIONS: 'true' });
  assert.equal(first.status, 0, first.stderr);
  const schemaCount = tableCount(dbPath);
  assert.ok(schemaCount > 0);
  assert.equal(integrity(dbPath), 'ok');
  const second = run('scripts/migrate.js', [], { ...safeEnv(dbPath), BLACKSPIRE_RUN_MIGRATIONS: 'true' });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(tableCount(dbPath), schemaCount);

  const api = await runUntilExit('apps/api/server.js', { ...safeEnv(dbPath), PORT: '0' });
  assert.equal(api.exited, false, api.stderr);
  const worker = await runUntilExit('apps/worker/worker.js', safeEnv(dbPath));
  assert.equal(worker.exited, false, worker.stderr);
});

test('production wrapper never runs or fabricates a migration permission', () => {
  const text = fs.readFileSync('scripts/start-production.sh', 'utf8');
  assert.doesNotMatch(text, /scripts\/migrate\.js/);
  assert.doesNotMatch(text, /BLACKSPIRE_RUN_MIGRATIONS/);
});
