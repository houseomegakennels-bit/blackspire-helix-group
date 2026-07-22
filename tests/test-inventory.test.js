import assert from 'node:assert/strict';
import test from 'node:test';

import { expectedTestFiles, inventoryRecordFromLog, verifyTestInventory } from '../scripts/test-inventory.js';

test('test inventory includes every root and nested Node test file exactly once', () => {
  const inventory = expectedTestFiles();

  assert.deepEqual(inventory, [...inventory].sort());
  assert.equal(new Set(inventory).size, inventory.length);
  assert.ok(inventory.includes('tests/test-inventory.test.js'));
  assert.ok(inventory.every((file) => file.startsWith('tests/') && file.endsWith('.test.js')));
});

test('test inventory verification rejects a silently omitted test file', () => {
  const inventory = expectedTestFiles();

  assert.throws(
    () => verifyTestInventory(inventory, inventory.slice(1)),
    /missing executed test files/i,
  );
});

test('test inventory verification reads the executed-file record from TAP output', () => {
  const expected = expectedTestFiles();
  const record = inventoryRecordFromLog([
    'TAP version 13',
    `# BLACKSPIRE_TEST_INVENTORY ${JSON.stringify({ expected, executed: expected })}`,
  ].join('\n'));

  assert.deepEqual(record.executed, expected);
  verifyTestInventory(expected, record.executed);
});
