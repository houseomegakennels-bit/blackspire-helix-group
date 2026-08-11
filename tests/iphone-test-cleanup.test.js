import test from 'node:test';
import assert from 'node:assert/strict';
import { createIphoneTestCleanup } from '../scripts/lib/iphone-test-cleanup.js';

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
