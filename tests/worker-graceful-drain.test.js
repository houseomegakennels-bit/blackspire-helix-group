import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.BLACKSPIRE_DB_PATH = '.blackspire-command/worker-graceful-drain.sqlite';
fs.rmSync(process.env.BLACKSPIRE_DB_PATH, { force: true });
fs.rmSync(`${process.env.BLACKSPIRE_DB_PATH}-wal`, { force: true });
fs.rmSync(`${process.env.BLACKSPIRE_DB_PATH}-shm`, { force: true });
const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { startWorker } = await import('../apps/worker/worker.js');

test('worker stop refuses new claims and waits for the active task and delivery', async () => {
  let claims = 0;
  let releaseTask;
  const taskGate = new Promise((resolve) => { releaseTask = resolve; });
  let delivered = false;
  const worker = startWorker({
    intervalMs: 60_000,
    claimNextImpl: () => (++claims === 1 ? { id: 'task-drain' } : null),
    processTaskImpl: () => taskGate,
    deliverEventsImpl: async () => { delivered = true; },
  });
  const active = worker.tick();
  await new Promise((resolve) => setImmediate(resolve));
  const stopping = worker.stop({ deadlineMs: 1_000 });
  await worker.tick();
  assert.equal(claims, 1);
  releaseTask();
  assert.deepEqual(await stopping, { drained: true });
  await active;
  assert.equal(delivered, true);
});

test('worker drain timeout is explicit and later completion remains safe', async () => {
  let releaseTask;
  const taskGate = new Promise((resolve) => { releaseTask = resolve; });
  const worker = startWorker({
    intervalMs: 60_000,
    claimNextImpl: () => ({ id: 'task-timeout' }),
    processTaskImpl: () => taskGate,
    deliverEventsImpl: async () => {},
  });
  const active = worker.tick();
  assert.deepEqual(await worker.stop({ deadlineMs: 5 }), { drained: false });
  releaseTask();
  await active;
});
