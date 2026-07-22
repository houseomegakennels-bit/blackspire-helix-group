import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  canonicalPathComparator,
  expectedTestFiles,
  testFilesUnder,
  verifyTestInventory,
} from '../scripts/test-inventory.js';

test('test inventory includes every root and nested Node test file exactly once', () => {
  const inventory = expectedTestFiles();

  assert.deepEqual(inventory, [...inventory].sort(canonicalPathComparator));
  assert.equal(new Set(inventory).size, inventory.length);
  assert.ok(inventory.includes('tests/test-inventory.test.js'));
  assert.ok(inventory.includes('tests/test-inventory-contract.test.js'));
  assert.ok(inventory.every((file) => file.startsWith('tests/') && file.endsWith('.test.js')));
});

test('test discovery uses locale-independent byte ordering for special filenames', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-inventory-order-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const testRoot = path.join(root, 'tests');
  const names = [
    'space name.test.js',
    'punctuation-_.test.js',
    'Z.test.js',
    'a.test.js',
    '10.test.js',
    '2.test.js',
    'é.test.js',
    'Ω.test.js',
    'nested/ß!.test.js',
    'nested/helper.js',
    'nested/fixture.json',
  ];
  for (const name of names) {
    const file = path.join(testRoot, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '');
  }

  const originalLocaleCompare = String.prototype.localeCompare;
  String.prototype.localeCompare = () => { throw new Error('localeCompare must not be used'); };
  try {
    assert.deepEqual(testFilesUnder(root, testRoot), [
      'tests/10.test.js',
      'tests/2.test.js',
      'tests/Z.test.js',
      'tests/a.test.js',
      'tests/nested/ß!.test.js',
      'tests/punctuation-_.test.js',
      'tests/space name.test.js',
      'tests/é.test.js',
      'tests/Ω.test.js',
    ]);
  } finally {
    String.prototype.localeCompare = originalLocaleCompare;
  }
});

test('inventory equality rejects omitted, duplicate, and unexpected execution', () => {
  const intended = ['tests/a.test.js', 'tests/b.test.js'];

  assert.throws(() => verifyTestInventory(intended, ['tests/b.test.js']), /missing.*tests\/a\.test\.js/i);
  assert.throws(() => verifyTestInventory(intended, [...intended, intended[0]]), /duplicate.*tests\/a\.test\.js/i);
  assert.throws(() => verifyTestInventory(intended, [...intended, 'tests/c.test.js']), /unexpected.*tests\/c\.test\.js/i);
});
