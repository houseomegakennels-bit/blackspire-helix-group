import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.BLACKSPIRE_DB_PATH = '.blackspire-command/api-readiness-lifecycle.sqlite';
process.env.COMMAND_ADMIN_TOKEN = 'readiness-test-token';
fs.rmSync(process.env.BLACKSPIRE_DB_PATH, { force: true });
fs.rmSync(`${process.env.BLACKSPIRE_DB_PATH}-wal`, { force: true });
fs.rmSync(`${process.env.BLACKSPIRE_DB_PATH}-shm`, { force: true });

const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { start, healthSnapshot, readinessSnapshot, beginGracefulShutdown } = await import('../apps/api/server.js');

let server;

test('liveness remains explicit while readiness verifies lifecycle, schema, and configuration', async () => {
  server = start(0, '127.0.0.1', { exitOnListenError: false });
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  const healthResponse = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(healthResponse.status, 200);
  assert.deepEqual(await healthResponse.json(), healthSnapshot());
  const readyResponse = await fetch(`http://127.0.0.1:${address.port}/ready`);
  assert.equal(readyResponse.status, 200);
  const ready = await readyResponse.json();
  assert.equal(ready.ok, true);
  assert.deepEqual(ready.checks, { lifecycle: true, database: true, productionConfig: true, worker: true, scheduler: true, deploymentIdentity: true });
  assert.equal(ready.deploymentIdentity.state, 'UNKNOWN');
  const spoofed = await fetch(`http://127.0.0.1:${address.port}/health?environment=production&buildSha=${'b'.repeat(40)}`);
  assert.equal(spoofed.status, 401);
  const headerSpoofed = await fetch(`http://127.0.0.1:${address.port}/health`, { headers: { 'x-environment': 'production', 'x-build-sha': 'b'.repeat(40) } });
  assert.deepEqual((await headerSpoofed.json()).deploymentIdentity, ready.deploymentIdentity);
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

test('readiness fails closed without disclosing dependency errors', () => {
  const readiness = readinessSnapshot({ schemaCheck: () => { throw new Error('sensitive path'); } });
  assert.equal(readiness.ok, false);
  assert.equal(readiness.database, 'unavailable_or_incompatible');
  assert.equal(JSON.stringify(readiness).includes('sensitive path'), false);
});

test('graceful shutdown marks the API unready and closes the database', async () => {
  const draining = beginGracefulShutdown(server, { deadlineMs: 1_000 });
  const readiness = readinessSnapshot();
  assert.equal(readiness.ok, false);
  assert.equal(readiness.lifecycle, 'draining');
  await draining;
  assert.equal(readinessSnapshot().lifecycle, 'stopped');
});
