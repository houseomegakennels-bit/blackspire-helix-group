import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDirectory = path.join(rootDirectory, 'tests');

function collectTestFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectTestFiles(file);
      return entry.isFile() && entry.name.endsWith('.test.js') ? [file] : [];
    });
}

export function expectedTestFiles() {
  return collectTestFiles(testDirectory)
    .map((file) => path.relative(rootDirectory, file).split(path.sep).join('/'))
    .sort((left, right) => left.localeCompare(right));
}

export function verifyTestInventory(expected, executed) {
  const expectedSet = new Set(expected);
  const executedSet = new Set(executed);
  const missing = expected.filter((file) => !executedSet.has(file));
  const unexpected = executed.filter((file) => !expectedSet.has(file));
  const duplicate = executed.filter((file, index) => executed.indexOf(file) !== index);

  if (missing.length || unexpected.length || duplicate.length) {
    throw new Error([
      missing.length ? `missing executed test files: ${missing.join(', ')}` : '',
      unexpected.length ? `unexpected executed test files: ${unexpected.join(', ')}` : '',
      duplicate.length ? `duplicate executed test files: ${[...new Set(duplicate)].join(', ')}` : '',
    ].filter(Boolean).join('; '));
  }
}

export function inventoryRecordFromLog(log) {
  const marker = '# BLACKSPIRE_TEST_INVENTORY ';
  const line = log.split(/\r?\n/).find((candidate) => candidate.startsWith(marker));
  if (!line) throw new Error('test output does not contain a BLACKSPIRE_TEST_INVENTORY record');
  return JSON.parse(line.slice(marker.length));
}
