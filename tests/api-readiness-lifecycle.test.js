import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { once } from 'node:events';

process.env.BLACKSPIRE_DB_PATH = '.blackspire-command/api-readiness-lifecycle.sqlite';
process.env.COMMAND_ADMIN_TOKEN = 'readiness-test-token';
fs.rmSync(process.env.BLACKSPIRE_DB_PATH, { force: true });
fs.rmSync(`${process.env.BLACKSPIRE_DB_PATH}-wal`, { force: true });
fs.rmSync(`${process.env.BLACKSPIRE_DB_PATH}-shm`, { force: true });

const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { start, healthSnapshot, readinessSnapshot, beginGracefulShutdown } = await import('../apps/api/server.js');
const { getDb } = await import('../packages/task-engine/db.js');

let server;
let baseUrl;

test('liveness remains explicit while readiness verifies lifecycle, schema, and configuration', async () => {
  server = start(0, '127.0.0.1', { exitOnListenError: false });
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  const healthResponse = await fetch(`${baseUrl}/health`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), healthSnapshot());
  const readyResponse = await fetch(`${baseUrl}/ready`);
  assert.equal(readyResponse.status, 200);
  const ready = await readyResponse.json();
  assert.equal(ready.ok, true);
  assert.deepEqual(ready.checks, { lifecycle: true, database: true, productionConfig: true, worker: true, scheduler: true });
});

test('required worker heartbeat makes readiness fail closed when missing or stale', async () => {
  process.env.BLACKSPIRE_REQUIRE_WORKER_HEARTBEAT = 'true';
  const missing = readinessSnapshot();
  assert.equal(missing.ok, false);
  assert.equal(missing.dependencies.worker.state, 'missing');
  const { recordWorkerHeartbeat } = await import('../packages/task-engine/runtime-status.js');
  recordWorkerHeartbeat({ workerId: 'worker-local', phase: 'idle', now: new Date(Date.now() - 60_000) });
  const stale = readinessSnapshot();
  assert.equal(stale.ok, false);
  assert.equal(stale.dependencies.worker.state, 'stale');
  assert.equal(stale.dependencies.worker.restartDetected, true);
  recordWorkerHeartbeat({ workerId: 'worker-local', phase: 'idle' });
  assert.equal(readinessSnapshot().ok, true);
  delete process.env.BLACKSPIRE_REQUIRE_WORKER_HEARTBEAT;
});

test('readiness fails closed over HTTP without disclosing dependency errors', async () => {
  const readiness = readinessSnapshot({ schemaCheck: () => { throw new Error('sensitive path'); } });
  assert.equal(readiness.ok, false);
  assert.equal(readiness.database, 'unavailable_or_incompatible');
  assert.equal(JSON.stringify(readiness).includes('sensitive path'), false);

  // Break only the disposable schema after startup. The route must independently revalidate the
  // database and remove this instance from traffic with HTTP 503, without exposing object names.
  getDb().exec('DROP TABLE audit_events');
  const response = await fetch(`${baseUrl}/ready`);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.equal(body.database, 'unavailable_or_incompatible');
  assert.equal(JSON.stringify(body).includes('audit_events'), false);
});

test('graceful shutdown marks the API unready and closes the database', async () => {
  const openConnection = getDb();
  // Hold the listener open just long enough to observe the route after the drain transition. This
  // does not change production behavior: the real close function is restored and invoked below.
  const close = server.close.bind(server);
  let finishClose;
  server.close = (callback) => { finishClose = callback; return server; };
  const draining = beginGracefulShutdown(server, { deadlineMs: 1_000 });
  const readiness = readinessSnapshot();
  assert.equal(readiness.ok, false);
  assert.equal(readiness.lifecycle, 'draining');
  const response = await fetch(`${baseUrl}/ready`);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).lifecycle, 'draining');
  server.close = close;
  const closed = once(server, 'close');
  close(finishClose);
  await draining;
  await closed;
  assert.equal(readinessSnapshot().lifecycle, 'stopped');
  assert.throws(() => openConnection.prepare('SELECT 1'), /database is not open/);
});
