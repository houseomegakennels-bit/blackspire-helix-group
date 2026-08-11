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
  const child = spawn(process.execPath, ['apps/worker/worker.js'], { env: baseEnv(dbPath, 0), stdio: ['ignore', 'pipe', 'pipe'] });
  const resultPromise = childResult(child);
  await waitForOutput(child, /"service":"worker"/);
  child.kill('SIGTERM');
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
