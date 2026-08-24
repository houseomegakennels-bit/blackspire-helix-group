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
  assert.deepEqual(ready.checks, { lifecycle: true, database: true, productionConfig: true, worker: true, scheduler: true, deploymentIdentity: true });
  assert.equal(ready.deploymentIdentity.state, 'UNKNOWN');
  const spoofed = await fetch(`http://127.0.0.1:${address.port}/health?environment=production&buildSha=${'b'.repeat(40)}`);
  assert.equal(spoofed.status, 401);
  const headerSpoofed = await fetch(`http://127.0.0.1:${address.port}/health`, { headers: { 'x-environment': 'production', 'x-build-sha': 'b'.repeat(40) } });
  assert.deepEqual((await headerSpoofed.json()).deploymentIdentity, ready.deploymentIdentity);
});

test('required worker heartbeat makes readiness fail closed when missing or stale', async (t) => {
  // Restore on the failure path too: a bare delete on the last line leaks the flag out of a
  // failed assertion and cascades into the later tests in this same process.
  t.after(() => { delete process.env.BLACKSPIRE_REQUIRE_WORKER_HEARTBEAT; });
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

test('readiness safely exposes the worker systemd generation without accepting malformed identity', async (t) => {
  t.after(() => { delete process.env.BLACKSPIRE_REQUIRE_WORKER_HEARTBEAT; });
  process.env.BLACKSPIRE_REQUIRE_WORKER_HEARTBEAT = 'true';
  const { recordWorkerHeartbeat } = await import('../packages/task-engine/runtime-status.js');
  const generationId = 'a'.repeat(32);
  recordWorkerHeartbeat({ workerId: 'worker-local', phase: 'idle', generationId });
  assert.equal(readinessSnapshot().dependencies.worker.generationId, generationId);
  recordWorkerHeartbeat({ workerId: 'worker-local', phase: 'idle', generationId: 'not-systemd-identity' });
  assert.equal(readinessSnapshot().dependencies.worker.generationId, null);
});

test('liveness ok reflects dependency state instead of asserting itself', async (t) => {
  t.after(() => { delete process.env.BLACKSPIRE_REQUIRE_WORKER_HEARTBEAT; });
  // Baseline: with no dependency required, a healthy process still reports ok.
  assert.equal(healthSnapshot().ok, true);

  // A required-but-stale worker must drag `ok` down. This is the assertion a hardcoded `ok: true`
  // cannot satisfy -- deleting the dependency terms from healthSnapshot fails here.
  process.env.BLACKSPIRE_REQUIRE_WORKER_HEARTBEAT = 'true';
  const { recordWorkerHeartbeat } = await import('../packages/task-engine/runtime-status.js');
  recordWorkerHeartbeat({ workerId: 'worker-local', phase: 'idle', now: new Date(Date.now() - 60_000) });
  const degraded = healthSnapshot();
  assert.equal(degraded.ok, false);
  assert.equal(degraded.dependencies.worker.state, 'stale');
  // Still served with 200: /health is liveness, and the body -- not the status -- carries the verdict.
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, false);

  recordWorkerHeartbeat({ workerId: 'worker-local', phase: 'idle' });
  assert.equal(healthSnapshot().ok, true);
});

test('readiness fails closed over HTTP without disclosing dependency errors', async () => {
  const readiness = readinessSnapshot({ schemaCheck: () => { throw new Error('sensitive path'); } });
  assert.equal(readiness.ok, false);
  assert.equal(readiness.database, 'unavailable_or_incompatible');
  assert.equal(JSON.stringify(readiness).includes('sensitive path'), false);

  // Break only the disposable schema after startup. The snapshot must independently revalidate the
  // database and remove this instance from traffic without exposing object names.
  getDb().exec('DROP TABLE audit_events');
  const body = readinessSnapshot();
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
  server.close = close;
  const closed = once(server, 'close');
  close(finishClose);
  await draining;
  await closed;
  assert.equal(readinessSnapshot().lifecycle, 'stopped');
  assert.throws(() => openConnection.prepare('SELECT 1'), /database is not open/);
});

test('an unverified deployment identity is reported unready', () => {
  // Hard-coding this readiness check to `true` previously left the whole suite green. The owner
  // is read at call time, so switching to one where identity is REQUIRED exercises it without
  // touching any real host path or release tree. The startup-refusal half is pinned in
  // tests/production-startup.test.js instead: by this point in this file an earlier graceful
  // shutdown has closed the schema, so start() fails the schema check before reaching identity.
  const original = process.env.BLACKSPIRE_STATE_OWNER;
  process.env.BLACKSPIRE_STATE_OWNER = 'vps-production';
  try {
    // The checkout carries no COMMIT_SHA manifest, so identity cannot verify.
    assert.equal(readinessSnapshot().checks.deploymentIdentity, false,
      'an unverified identity must make the service report unready');
    assert.equal(readinessSnapshot().ok, false);
  } finally {
    if (original === undefined) delete process.env.BLACKSPIRE_STATE_OWNER;
    else process.env.BLACKSPIRE_STATE_OWNER = original;
  }
  // The gate is scoped: with the original (non-required) owner the service is ready again.
  assert.equal(readinessSnapshot().checks.deploymentIdentity, true);
});
