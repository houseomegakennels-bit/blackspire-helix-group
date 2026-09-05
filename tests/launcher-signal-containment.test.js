import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import http from 'node:http';
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

test('API second signal accelerates shutdown and exits nonzero without leaving its listener', async (t) => {
  const port = await freePort();
  const dbPath = path.join(root, 'api-second-signal.sqlite');
  prepareDisposableDatabase(dbPath);
  const child = spawn(process.execPath, ['apps/api/server.js'], { env: baseEnv(dbPath, port), stdio: ['ignore', 'pipe', 'pipe'] });
  const resultPromise = childResult(child);
  let request;
  t.after(async () => {
    request?.destroy();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await resultPromise;
  });
  await waitForOutput(child, /"service":"api"/);

  // An idle API can finish its first graceful shutdown before the second signal arrives.
  // Hold a real request body open instead: 100 Continue proves the server accepted the
  // request, and login must await its body while server.close() drains connections.
  request = http.request({
    host: '127.0.0.1', port, path: '/api/auth/login', method: 'POST',
    headers: { Expect: '100-continue', 'Content-Length': '64', 'Content-Type': 'application/json' },
  });
  let requestError;
  const requestClosed = new Promise((resolve) => {
    request.on('error', (error) => { requestError = error; });
    request.once('close', resolve);
  });
  const accepted = new Promise((resolve, reject) => {
    request.once('continue', resolve);
    request.once('error', reject);
    request.once('close', () => reject(new Error('request closed before 100 Continue')));
    request.once('response', (response) => {
      response.resume();
      reject(new Error(`request completed before shutdown: HTTP ${response.statusCode}`));
    });
  });
  request.flushHeaders();
  await accepted;
  const draining = waitForOutput(child, /"lifecycle":"draining"/);
  child.kill('SIGTERM');
  await draining;
  child.kill('SIGINT');
  const result = await resultPromise;
  await requestClosed;
  assert.equal(result.code, 1, result.stderr);
  assert.equal(requestError?.code, 'ECONNRESET', 'forced shutdown must close the active request');
  assert.match(result.stdout, /"lifecycle":"draining"/);
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

// Regression: migrate.js runs the schema writer as a GRANDCHILD via spawnSync. Signalling only the
// direct child killed migrate.js while it sat in spawnSync, leaving the writer running against the
// disposable database. It then re-created the data directory after removeData() had already checked
// it was gone, so the launcher printed "cleaned":true and exited 0 over surviving disposable state.
//
// Reaching that window is the whole difficulty: the disposable root is created at module load, long
// before migration spawns, so waiting for the directory signals far too early and exercises nothing.
// The pause seam holds startup BEFORE migration, which is when the exclusive lock has to be in place,
// and the test then waits for the writer to actually appear before signalling.
test('a signal blocked inside migration leaves no orphan writer and no surviving disposable state', async (t) => {
  const prefix = 'blackspire-iphone-build-';
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-launcher-orphan-'));
  t.after(() => fs.rmSync(tmpdir, { recursive: true, force: true }));
  const port = await freePort();
  const child = spawn(process.execPath, ['scripts/start-iphone-test-build.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      TMPDIR: tmpdir,
      PORT: String(port),
      UNIFIED_TEST_ACCESS_CODE: 'orphan-writer-regression',
      UNIFIED_TEST_TTL_MS: '60000',
      UNIFIED_TEST_STARTUP_PAUSE_MS: '3000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const resultPromise = childResult(child, 40_000);
  // Take the lock during the pre-migration pause, so the writer is guaranteed to block on it.
  await waitForOutput(child, /"status":"startup_paused"/, 20_000);
  const created = fs.readdirSync(tmpdir).filter((name) => name.startsWith(prefix));
  assert.equal(created.length, 1, `expected exactly one disposable root, got: ${created.join(', ')}`);
  const startupDb = path.join(tmpdir, created[0], 'iphone-test.sqlite');
  const lock = new DatabaseSync(startupDb);
  lock.exec('BEGIN EXCLUSIVE;');

  // Only signal once the writer is genuinely alive and blocked — otherwise this test would repeat
  // the earlier mistake of interrupting before the grandchild ever existed.
  const writerAlive = async () => {
    const ps = spawn('ps', ['-eo', 'pid,args'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let table = '';
    ps.stdout.on('data', (chunk) => { table += chunk; });
    await new Promise((resolve) => ps.once('close', resolve));
    // Match only a real node process whose command ENDS with the writer script. A substring test
    // also matches any unrelated shell command line that merely mentions the path, which produced a
    // false positive during mutation testing.
    // Anchored on the argv0 field: the previous pattern only required the token "node" to appear
    // somewhere earlier on the line, so `tail -f node scripts/migration-writer.js` matched it.
    return table.split('\n').filter((line) => /^\s*\d+\s+\S*\/?node(?:js)?(?:-\S+)?\s+\S*scripts\/migration-writer\.js\s*$/.test(line));
  };
  let appeared = [];
  for (let attempt = 0; attempt < 400 && appeared.length === 0; attempt += 1) {
    appeared = await writerAlive();
    if (!appeared.length) await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(appeared.length > 0, 'the migration writer must be running and blocked before the signal');

  child.kill('SIGTERM');
  const result = await resultPromise;
  const output = `${result.stdout}\n${result.stderr}`;

  // The process check runs while the lock is still held, which is the only window in which a
  // surviving writer stays observable. Measured honestly: this assertion is NOT what catches a
  // reverted group kill — by this point the writer has already lost its race and exited. The
  // surviving-directory assertion below is the one that fails. This is kept as a secondary guard
  // for a longer-lived orphan, not as the pin for the bug.
  await new Promise((resolve) => setTimeout(resolve, 300));
  const orphans = await writerAlive();
  lock.exec('ROLLBACK;');
  lock.close();
  assert.deepEqual(orphans, [], `an interrupted startup left an orphan writer process:\n${orphans.join('\n')}\n${output}`);

  // THIS is the load-bearing assertion. The orphaned writer re-creates the disposable root after
  // removeData() has already checked it was gone, so the launcher reports "cleaned":true and exits 0
  // over state that is still on disk. Reverting the process-group kill fails exactly here.
  const survivors = fs.readdirSync(tmpdir).filter((name) => name.startsWith(prefix));
  assert.deepEqual(survivors, [], `interrupted startup left disposable state behind: ${survivors.join(', ')}\n${output}`);
  assert.doesNotMatch(result.stdout, /"status":"ready"/, output);
});
