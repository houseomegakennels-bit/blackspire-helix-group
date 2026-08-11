import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createIphoneTestCleanup, waitForServerListening } from '../scripts/lib/iphone-test-cleanup.js';

function fixture(stopImpl) {
  const events = [];
  const cleanup = createIphoneTestCleanup({
    worker: { stop: stopImpl },
    server: {
      close(callback) { events.push('server-close'); callback(); },
      closeAllConnections() { events.push('connections-close'); },
    },
    closeDb() { events.push('db-close'); },
    removeData() { events.push('data-remove'); },
    log() { events.push('success'); },
    deadlineMs: 17,
  });
  return { cleanup, events };
}

test('harness awaits bounded worker drain before closing owned state', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { cleanup, events } = fixture(async ({ deadlineMs }) => {
    assert.equal(deadlineMs, 17);
    events.push('stop-start');
    await gate;
    events.push('stop-complete');
    return { drained: true };
  });
  const pending = cleanup('test');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['stop-start']);
  release();
  await pending;
  assert.deepEqual(events, ['stop-start', 'stop-complete', 'server-close', 'connections-close', 'db-close', 'data-remove', 'success']);
});

test('cleanup failure is visible after owned resources are released', async () => {
  const { cleanup, events } = fixture(async () => { throw new Error('stop failed'); });
  await assert.rejects(cleanup('failure'), /stop failed/);
  assert.deepEqual(events, ['server-close', 'connections-close', 'db-close', 'data-remove']);
});

test('drain timeout fails cleanup closed instead of reporting success', async () => {
  const { cleanup, events } = fixture(async () => ({ drained: false }));
  await assert.rejects(cleanup('timeout'), /did not drain/);
  assert.equal(events.includes('success'), false);
  assert.deepEqual(events, ['server-close', 'connections-close', 'db-close', 'data-remove']);
});

test('repeated cleanup shares one completion and does not corrupt state', async () => {
  let stops = 0;
  const { cleanup, events } = fixture(async () => { stops += 1; return { drained: true }; });
  const first = cleanup('first');
  const second = cleanup('second');
  assert.strictEqual(first, second);
  await Promise.all([first, second]);
  assert.equal(stops, 1);
  assert.equal(events.filter((event) => event === 'data-remove').length, 1);
});

test('early harness failure can still run bounded cleanup', async () => {
  const { cleanup, events } = fixture(async () => ({ drained: true }));
  await assert.rejects(async () => {
    try { throw new Error('startup check failed'); }
    finally { await cleanup('startup-failure'); }
  }, /startup check failed/);
  assert.equal(events.at(-1), 'success');
});

test('startup waits for a confirmed listener and exposes bind failure', async () => {
  const server = new EventEmitter();
  server.listening = false;
  const listening = waitForServerListening(server);
  const bindError = Object.assign(new Error('occupied'), { code: 'EADDRINUSE' });
  server.emit('error', bindError);
  await assert.rejects(listening, bindError);
});

test('startup failure cleanup supports a server before worker creation', async () => {
  const events = [];
  const cleanup = createIphoneTestCleanup({
    worker: undefined,
    server: {
      close(callback) { events.push('server-close'); callback(Object.assign(new Error('not running'), { code: 'ERR_SERVER_NOT_RUNNING' })); },
      closeAllConnections() { events.push('connections-close'); },
    },
    closeDb() { events.push('db-close'); },
    removeData() { events.push('data-remove'); },
    log() { events.push('success'); },
  });
  await cleanup('startup-failure');
  assert.deepEqual(events, ['server-close', 'connections-close', 'db-close', 'data-remove', 'success']);
});

test('server close failure cannot skip database and disposable-data cleanup', async () => {
  const events = [];
  const cleanup = createIphoneTestCleanup({
    worker: undefined,
    server: {
      close(callback) { events.push('server-close'); callback(new Error('close failed')); },
      closeAllConnections() { events.push('connections-close'); },
    },
    closeDb() { events.push('db-close'); },
    removeData() { events.push('data-remove'); },
  });
  await assert.rejects(cleanup('startup-failure'), /close failed/);
  assert.deepEqual(events, ['server-close', 'connections-close', 'db-close', 'data-remove']);
});

test('real launcher exits nonzero and removes disposable state when its loopback port is occupied', async (t) => {
  const blocker = http.createServer((_request, response) => response.end('occupied'));
  await new Promise((resolve, reject) => {
    blocker.once('error', reject);
    blocker.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => blocker.close());
  const port = blocker.address().port;
  const prefix = 'blackspire-iphone-build-';
  const before = new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(prefix)));
  const child = spawn(process.execPath, ['scripts/start-iphone-test-build.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: {
      ...process.env,
      PORT: String(port),
      UNIFIED_TEST_ACCESS_CODE: 'focused-startup-failure-test',
      UNIFIED_TEST_TTL_MS: '60000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  let timeout;
  const result = await Promise.race([
    new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal }))),
    new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('launcher did not fail within 10 seconds')), 10_000); }),
  ]);
  clearTimeout(timeout);
  assert.deepEqual(result, { code: 1, signal: null }, output);
  assert.match(output, /"status":"startup_failed"/);
  assert.match(output, /EADDRINUSE|already in use/);
  const created = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(prefix) && !before.has(name));
  assert.deepEqual(created, [], `leaked disposable directories: ${created.join(', ')}`);
});
