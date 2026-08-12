import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.BLACKSPIRE_DB_PATH = '.blackspire-command/worker-graceful-drain.sqlite';
fs.rmSync(process.env.BLACKSPIRE_DB_PATH, { force: true });
fs.rmSync(`${process.env.BLACKSPIRE_DB_PATH}-wal`, { force: true });
fs.rmSync(`${process.env.BLACKSPIRE_DB_PATH}-shm`, { force: true });
const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { sanitizeWorkerError, startWorker } = await import('../apps/worker/worker.js');

test('worker launcher failure text is sanitized before reporting', () => {
  const message = sanitizeWorkerError(new Error('delivery failed token=private-value'));
  assert.match(message, /delivery failed/);
  assert.doesNotMatch(message, /private-value/);
  assert.match(message, /\[redacted\]/);
});

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

test('task rejection is returned by drain and delivery still runs', async () => {
  let delivered = false;
  const worker = startWorker({
    intervalMs: 60_000,
    claimNextImpl: () => ({ id: 'task-reject' }),
    processTaskImpl: async () => { throw new Error('task failed token=private-value'); },
    deliverEventsImpl: async () => { delivered = true; },
  });
  void worker.tick();
  const result = await worker.stop({ deadlineMs: 1_000 });
  assert.equal(result.drained, true);
  assert.match(result.error.message, /task failed/);
  assert.equal(delivered, true);
});

test('delivery rejection is returned by drain without becoming unhandled', async () => {
  const worker = startWorker({
    intervalMs: 60_000,
    claimNextImpl: () => ({ id: 'delivery-reject' }),
    processTaskImpl: async () => {},
    deliverEventsImpl: async () => { throw new Error('delivery failed secret=private-value'); },
  });
  void worker.tick();
  const result = await worker.stop({ deadlineMs: 1_000 });
  assert.equal(result.drained, true);
  assert.match(result.error.message, /delivery failed/);
});

test('scheduled tick rejection is routed to the bounded failure handler', async () => {
  let failure;
  let resolveFailure;
  const failed = new Promise((resolve) => { resolveFailure = resolve; });
  const worker = startWorker({
    intervalMs: 1,
    claimNextImpl: () => ({ id: 'scheduled-reject' }),
    processTaskImpl: async () => { throw new Error('scheduled failure key=private-value'); },
    deliverEventsImpl: async () => {},
    scheduledFailureImpl: (error) => { failure = error; resolveFailure(); },
  });
  await failed;
  await worker.stop();
  assert.match(failure.message, /scheduled failure/);
});

test('worker persists lifecycle heartbeat and refuses a cancellation racing claim', async () => {
  const records = [];
  let processed = false;
  const worker = startWorker({
    once: true,
    claimNextImpl: () => ({ id: 'cancelled-after-claim' }),
    getTaskImpl: () => ({ status: 'cancelled' }),
    processTaskImpl: async () => { processed = true; },
    deliverEventsImpl: async () => {},
    recordHeartbeatImpl: (record) => { records.push(record); return record; },
  });
  await worker;
  assert.equal(processed, false);
  assert.deepEqual(records.map((record) => record.phase), ['starting', 'idle', 'working', 'idle', 'stopped']);
  assert.equal(records.some((record) => record.taskId === 'cancelled-after-claim'), true);
});

test('a failing heartbeat write cannot abort the graceful drain', async () => {
  // recordWorkerHeartbeat reaches execSql, which throws synchronously on SQLITE_BUSY, a full
  // disk, or a closed handle. The shutdown path has no enclosing catch, so an unguarded write
  // there would reject stop() before the in-flight tick is awaited and abandon the task.
  let released;
  const running = new Promise((resolve) => { released = resolve; });
  let finished = false;
  const worker = startWorker({
    intervalMs: 1,
    claimNextImpl: () => ({ id: 'drain-during-heartbeat-fault' }),
    getTaskImpl: () => ({ status: 'queued' }),
    processTaskImpl: async () => { await running; finished = true; },
    deliverEventsImpl: async () => {},
    recordHeartbeatImpl: ({ phase }) => { if (phase === 'draining' || phase === 'stopped') throw new Error('database is locked'); },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const stopped = worker.stop({ deadlineMs: 5_000 });
  released();
  assert.deepEqual(await stopped, { drained: true });
  assert.equal(finished, true);
});

test('a failing heartbeat write after the claim still runs the task and drains the outbox', async () => {
  // The 'working' write sits between the atomic claim and the try block. Unguarded, a transient
  // SQLITE_BUSY there skips the finally: the outbox goes undrained and activeTaskId stays pinned,
  // so the timer keeps publishing 'working' for a task that is not running, and the claimed task
  // is stranded until claimNext's 300s stale reclaim.
  const phases = [];
  let processed = false;
  let delivered = 0;
  const worker = startWorker({
    once: true,
    claimNextImpl: () => ({ id: 'busy-write-after-claim' }),
    getTaskImpl: () => ({ status: 'queued' }),
    processTaskImpl: async () => { processed = true; },
    deliverEventsImpl: async () => { delivered += 1; },
    recordHeartbeatImpl: ({ phase, taskId }) => {
      phases.push(phase);
      if (phase === 'working') throw new Error('database is locked');
      return { phase, taskId };
    },
  });
  await worker;
  assert.equal(processed, true, 'the claimed task must still be dispatched');
  assert.equal(delivered, 1, 'the finally block must still drain the outbox');
  // activeTaskId is cleared in the finally, so the terminal write reports no active task.
  assert.deepEqual(phases, ['starting', 'idle', 'working', 'idle', 'stopped']);
});
