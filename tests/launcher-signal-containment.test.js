import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { prepareDisposableDatabase } from './helpers/prepare-disposable-database.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-launcher-signals-'));

// A suite about disposable hygiene must not leak its own scratch root on every run.
test.after(() => { fs.rmSync(root, { recursive: true, force: true }); });

function childResult(child, timeoutMs = 8_000) {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`child timeout: ${stdout}\n${stderr}`)); }, timeoutMs);
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
  });
}

function waitForOutput(child, pattern, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`startup output timeout: ${output}`)), timeoutMs);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (pattern.test(output)) { clearTimeout(timer); resolve(); }
    });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`child exited before startup: ${output}`)); });
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function baseEnv(dbPath, port) {
  return {
    ...process.env,
    NODE_ENV: 'test',
    BLACKSPIRE_DB_PATH: dbPath,
    BLACKSPIRE_DATA_DIR: path.dirname(dbPath),
    PORT: String(port),
    BIND_HOST: '127.0.0.1',
    TELEGRAM_MODE: 'dry-run',
    BLACKSPIRE_PROVIDER_MODE: 'manual',
    COMMAND_ADMIN_TOKEN: 'a'.repeat(32),
    SESSION_SECRET: 'b'.repeat(40),
  };
}

test('API second signal accelerates shutdown and exits nonzero without leaving its listener', async () => {
  const port = await freePort();
  const dbPath = path.join(root, 'api-second-signal.sqlite');
  prepareDisposableDatabase(dbPath);
  const child = spawn(process.execPath, ['apps/api/server.js'], { env: baseEnv(dbPath, port), stdio: ['ignore', 'pipe', 'pipe'] });
  const resultPromise = childResult(child);
  await waitForOutput(child, /"service":"api"/);
  child.kill('SIGTERM');
  child.kill('SIGINT');
  const result = await resultPromise;
  assert.equal(result.code, 1, result.stderr);
  assert.doesNotMatch(result.stdout, /"service":"api".*"ready"/);
  const rebound = net.createServer();
  await new Promise((resolve, reject) => rebound.once('error', reject).listen(port, '127.0.0.1', resolve));
  await new Promise((resolve) => rebound.close(resolve));
});

test('worker second signal forces sanitized nonzero termination', async () => {
  const dbPath = path.join(root, 'worker-second-signal.sqlite');
  prepareDisposableDatabase(dbPath);
  // An idle worker drains instantly. Without the pause seam and the draining-line wait below, the
  // first shutdown could complete and exit 0 before the second signal was ever delivered, so this
  // regression would pass while exercising nothing.
  const child = spawn(process.execPath, ['apps/worker/worker.js'], { env: { ...baseEnv(dbPath, 0), UNIFIED_TEST_DRAIN_PAUSE_MS: '2000' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const resultPromise = childResult(child);
  await waitForOutput(child, /"service":"worker"/);
  child.kill('SIGTERM');
  await waitForOutput(child, /"lifecycle":"draining"/);
  child.kill('SIGINT');
  const result = await resultPromise;
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stderr, /second shutdown signal forced immediate termination/);
  assert.doesNotMatch(result.stderr, /token=|secret=|password=/i);
});

test('signal during disposable startup removes partial state and never reports ready', async () => {
  const prefix = 'blackspire-iphone-build-';
  const before = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(prefix)));
  const port = await freePort();
  const child = spawn(process.execPath, ['scripts/start-iphone-test-build.js'], {
    env: { ...process.env, PORT: String(port), UNIFIED_TEST_ACCESS_CODE: 'disposable-test-code' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const resultPromise = childResult(child);
  let created = [];
  for (let attempt = 0; attempt < 1_000 && created.length === 0; attempt += 1) {
    created = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(prefix) && !before.has(name));
    if (!created.length) await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.ok(created.length > 0, 'launcher must create disposable state before interruption');
  const startupDb = path.join(os.tmpdir(), created[0], 'iphone-test.sqlite');
  const lock = new DatabaseSync(startupDb);
  lock.exec('BEGIN EXCLUSIVE;');
  child.kill('SIGTERM');
  const result = await resultPromise;
  lock.exec('ROLLBACK;');
  lock.close();
  assert.notEqual(result.code, null, `unexpected signal termination: ${result.signal}`);
  assert.doesNotMatch(result.stdout, /"status":"ready"/);
  for (const name of created) assert.equal(fs.existsSync(path.join(os.tmpdir(), name)), false, `${name} must be removed`);

  // migrate.js runs the schema writer as a GRANDCHILD via spawnSync, and the exclusive lock above
  // keeps it blocked. Signalling only the direct child killed migrate.js while it sat in spawnSync,
  // leaving the writer alive and reparented to init, still holding the disposable database — while
  // the directory check above still passed, because Linux unlinks happily with open descriptors.
  await new Promise((resolve) => setTimeout(resolve, 500));
  const ps = spawn('ps', ['-eo', 'pid,ppid,args'], { stdio: ['ignore', 'pipe', 'ignore'] });
  let table = '';
  ps.stdout.on('data', (chunk) => { table += chunk; });
  await new Promise((resolve) => ps.once('close', resolve));
  const orphans = table.split('\n').filter((line) => line.includes('migration-writer.js'));
  assert.deepEqual(orphans, [], `an interrupted startup left an orphan writer process:\n${orphans.join('\n')}`);
  const rebound = net.createServer();
  await new Promise((resolve, reject) => rebound.once('error', reject).listen(port, '127.0.0.1', resolve));
  await new Promise((resolve) => rebound.close(resolve));
});

// Regression: a signal landing mid-startup used to run cleanup to completion CONCURRENTLY with a
// still-advancing startup, which then re-created the disposable root cleanup had just removed. The
// launcher printed "cleaned":true and exited 0 while the directory and its SQLite file survived.
// The pause seam lands the signal deterministically inside that window instead of racing wall-clock.
test('signal inside the startup window leaves nothing behind and never reports a false clean exit', async (t) => {
  const prefix = 'blackspire-iphone-build-';
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-launcher-window-'));
  t.after(() => fs.rmSync(tmpdir, { recursive: true, force: true }));
  const port = await freePort();
  const child = spawn(process.execPath, ['scripts/start-iphone-test-build.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      TMPDIR: tmpdir,
      PORT: String(port),
      UNIFIED_TEST_ACCESS_CODE: 'startup-window-regression',
      UNIFIED_TEST_TTL_MS: '60000',
      UNIFIED_TEST_STARTUP_PAUSE_MS: '750',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const resultPromise = childResult(child, 30_000);
  await waitForOutput(child, /"status":"startup_paused"/, 20_000);
  child.kill('SIGTERM');
  const result = await resultPromise;
  const output = `${result.stdout}\n${result.stderr}`;

  // (a) nothing survives in the launcher's private TMPDIR.
  const survivors = fs.readdirSync(tmpdir).filter((name) => name.startsWith(prefix));
  assert.deepEqual(survivors, [], `interrupted startup leaked disposable state: ${survivors.join(', ')}\n${output}`);
  // (b) the reported status is honest: never ready, and never a clean exit alongside a leak.
  assert.notEqual(result.code, null, `unexpected signal termination: ${result.signal}\n${output}`);
  assert.doesNotMatch(result.stdout, /"status":"ready"/, output);
  if (result.code !== 0) assert.doesNotMatch(result.stdout, /"cleaned":true/, output);
  assert.equal(result.code, 0, `interrupted-but-clean shutdown must exit 0: ${output}`);
  assert.match(result.stdout, /"status":"stopped".*"cleaned":true/, output);
});

test('occupied disposable port reports the bind failure, never a launcher reference error or readiness', async () => {
  const prefix = 'blackspire-iphone-build-';
  const before = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(prefix)));
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = listener.address();
  const child = spawn(process.execPath, ['scripts/start-iphone-test-build.js'], {
    env: { ...process.env, PORT: String(port), UNIFIED_TEST_ACCESS_CODE: 'disposable-test-code' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const result = await childResult(child);
  await new Promise((resolve) => listener.close(resolve));
  assert.equal(result.code, 1, result.stderr);
  assert.match(result.stderr, new RegExp(`port ${port} is already in use; refusing to start without a fallback`));
  assert.match(result.stderr, /"status":"startup_failed"/);
  assert.doesNotMatch(result.stderr, /ReferenceError|createIphoneTestCleanup is not defined/);
  assert.doesNotMatch(result.stdout, /"status":"ready"/);
  const remaining = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(prefix) && !before.has(name));
  assert.deepEqual(remaining, [], `startup cleanup left disposable directories: ${remaining.join(', ')}`);
});
