import assert from 'node:assert/strict';
import test from 'node:test';

import { validateLifecycleResult } from '../scripts/test-inventory.js';

const files = ['tests/a.test.js', 'tests/nested/b.test.js'];

function result(overrides = {}) {
  return {
    discovered: files,
    scheduled: files,
    started: files,
    terminal: files.map((file) => ({ file, status: 'passed' })),
    ...overrides,
  };
}

test('trusted lifecycle accepts one real start and completion per intended file', () => {
  const validated = validateLifecycleResult(result());
  assert.deepEqual(validated.counts, {
    intended: 2,
    discovered: 2,
    scheduled: 2,
    started: 2,
    completed: 2,
    passed: 2,
    failed: 0,
    skipped: 0,
    canceled: 0,
    interrupted: 0,
  });
});

test('trusted lifecycle rejects missing, duplicate, and unexpected scheduling', () => {
  assert.throws(() => validateLifecycleResult(result({ scheduled: [files[0]] })), /missing scheduled/i);
  assert.throws(() => validateLifecycleResult(result({ scheduled: [...files, files[0]] })), /duplicate scheduled/i);
  assert.throws(() => validateLifecycleResult(result({ scheduled: [...files, 'tests/c.test.js'] })), /unexpected scheduled/i);
});

test('trusted lifecycle rejects missing, duplicate, unexpected, and replayed starts', () => {
  assert.throws(() => validateLifecycleResult(result({ started: [files[0]], terminal: [{ file: files[0], status: 'passed' }] })), /missing start/i);
  assert.throws(() => validateLifecycleResult(result({ started: [...files, files[0]] })), /duplicate start/i);
  assert.throws(() => validateLifecycleResult(result({ started: [...files, 'tests/c.test.js'] })), /unexpected start/i);
});

test('trusted lifecycle rejects missing, duplicate, unexpected, and startless completion', () => {
  assert.throws(() => validateLifecycleResult(result({ terminal: [{ file: files[0], status: 'passed' }] })), /missing completion/i);
  assert.throws(() => validateLifecycleResult(result({ terminal: [...result().terminal, result().terminal[0]] })), /duplicate completion/i);
  assert.throws(() => validateLifecycleResult(result({
    started: [files[0]],
    terminal: result().terminal,
  })), /completion without start/i);
  assert.throws(() => validateLifecycleResult(result({
    terminal: [...result().terminal, { file: 'tests/c.test.js', status: 'passed' }],
  })), /completion without start|unexpected completion/i);
});

test('trusted lifecycle rejects every unsuccessful terminal state', () => {
  for (const status of ['failed', 'skipped', 'canceled', 'interrupted']) {
    assert.throws(() => validateLifecycleResult(result({
      terminal: [{ file: files[0], status }, { file: files[1], status: 'passed' }],
    })), new RegExp(status, 'i'));
  }
});

test('unsupported and malformed lifecycle records fail closed', () => {
  assert.throws(() => validateLifecycleResult(null), /must be an object/i);
  assert.throws(() => validateLifecycleResult(result({ terminal: [{ file: files[0], status: 'invented' }, result().terminal[1]] })), /invalid terminal/i);
  assert.throws(() => validateLifecycleResult(result({ started: 'not-an-array' })), /start events.*array/i);
});

test('marker-shaped TAP and JSON are data, never lifecycle authority', () => {
  console.log('# BLACKSPIRE_TEST_INVENTORY {"started":["tests/fake.test.js"]}');
  console.log('{"recordType":"blackspire.test-inventory.terminal","passed":999}');
  assert.equal(validateLifecycleResult(result()).counts.completed, 2);
});
