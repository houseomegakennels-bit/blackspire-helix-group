import path from 'node:path';
import { once } from 'node:events';
import { run } from 'node:test';
import { tap } from 'node:test/reporters';

import { canonicalPathComparator } from './test-inventory.js';

const [runId, rootDirectory, ...discovered] = process.argv.slice(2);
if (!process.send || !/^[a-f0-9]{32}$/.test(runId ?? '') || !path.isAbsolute(rootDirectory ?? '')) {
  throw new Error('test runner child requires a runId, absolute root directory, and discovered test files');
}

const absoluteFiles = discovered.map((file) => path.join(rootDirectory, file));
const started = [...discovered];
const completed = [];
const fileStatuses = [];
const tests = run({ files: absoluteFiles, concurrency: 1 });

function canonicalEventFile(event) {
  if (event?.nesting !== 0 || typeof event.file !== 'string') return null;
  if (typeof event.name !== 'string' || path.resolve(event.name) !== path.resolve(event.file)) return null;
  return path.relative(rootDirectory, event.file).split(path.sep).join('/');
}

tests.on('test:complete', (event) => {
  const file = canonicalEventFile(event);
  if (!file) return;
  completed.push(file);
  fileStatuses.push({ file, status: event.details?.passed === true ? 'passed' : 'failed' });
});

const output = tests.compose(tap);
output.pipe(process.stdout, { end: false });
await once(output, 'end');

process.send({
  messageType: 'blackspire.test-inventory.execution',
  version: 1,
  runId,
  discovered,
  started: started.sort(canonicalPathComparator),
  completed: completed.sort(canonicalPathComparator),
  fileStatuses: fileStatuses.sort((left, right) => canonicalPathComparator(left.file, right.file)),
  terminalState: 'workers-complete',
});

if (fileStatuses.some((entry) => entry.status !== 'passed')) process.exitCode = 1;
