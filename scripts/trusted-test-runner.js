import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { Transform } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { run } from 'node:test';
import { tap } from 'node:test/reporters';

import {
  captureTestTree,
  createLifecycleTracker,
  validateLifecycleResult,
  verifyTestTreeUnchanged,
} from './test-inventory.js';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testsDirectory = path.join(rootDirectory, 'tests');

// Bounded execution. Without this, one hung test file stalls the trusted runner forever: the
// stream never ends, the lifecycle result is never validated, and CI blocks until an external
// timeout kills it with no trusted verdict. Node 22 enforces this per test and fails the test
// rather than hanging, for both an unresolved promise and a test that blocks the event loop.
//
// The bound is deliberately generous: the slowest file in this suite finishes in seconds, so it
// can only fire for a genuine hang, and a slow CI runner cannot trip it. It is a constant on
// purpose - no environment variable may relax it, because ordinary CI callers could then silently
// restore the unbounded behavior this exists to prevent. scripts/run-tests.js applies a second,
// outer bound around the whole contained run for the case where this in-process timer cannot fire.
const TRUSTED_TEST_TIMEOUT_MS = 120_000;

function canonicalEventFile(event) {
  if (event?.data?.nesting !== 0 || typeof event.data.file !== 'string') return null;
  if (typeof event.data.name !== 'string' || path.resolve(event.data.name) !== path.resolve(event.data.file)) return null;
  const relative = path.relative(rootDirectory, event.data.file).split(path.sep).join('/');
  return relative.startsWith('tests/') ? relative : null;
}

function terminalStatus(event) {
  if (event.data?.details?.passed === true) return 'passed';
  const failureType = String(event.data?.details?.error?.failureType ?? '');
  if (/cancel/i.test(failureType)) return 'canceled';
  if (/interrupt|signal/i.test(failureType)) return 'interrupted';
  if (event.data?.details?.skipped === true) return 'skipped';
  return 'failed';
}

function watchTestTree(snapshot, mutations) {
  const directories = snapshot.entries
    .filter((entry) => entry.type === 'directory')
    .map((entry) => entry.path === '.' ? snapshot.tests : path.join(snapshot.root, entry.path));
  return directories.map((directory) => fs.watch(directory, { persistent: false }, (eventType, filename) => {
    mutations.push({ eventType, filename: filename?.toString() ?? '' });
  }));
}

let trustedTerminalResult = null;
let exitCode = 1;
const initial = captureTestTree(rootDirectory, testsDirectory);
const mutations = [];
const watchers = watchTestTree(initial, mutations);
const discovered = [...initial.testFiles];
const lifecycleTracker = createLifecycleTracker(discovered);

try {
  verifyTestTreeUnchanged(initial);
  const absoluteFiles = discovered.map((file) => path.join(rootDirectory, file));
  const testStream = run({ files: absoluteFiles, concurrency: 1, timeout: TRUSTED_TEST_TIMEOUT_MS });
  const lifecycle = new Transform({
    objectMode: true,
    transform(event, _encoding, callback) {
      const file = canonicalEventFile(event);
      if (file && event.type === 'test:enqueue') lifecycleTracker.record('scheduled', file);
      if (file && event.type === 'test:dequeue') lifecycleTracker.record('started', file);
      if (file && event.type === 'test:complete') lifecycleTracker.record('completed', file, terminalStatus(event));
      callback(null, event);
    },
  });
  const output = testStream.compose(lifecycle).compose(tap);
  output.pipe(process.stdout, { end: false });
  await once(output, 'end');
  for (const watcher of watchers) watcher.close();

  verifyTestTreeUnchanged(initial);
  if (mutations.length !== 0) throw new Error(`test tree emitted ${mutations.length} mutation event(s) during execution`);
  trustedTerminalResult = validateLifecycleResult(lifecycleTracker.result());
  exitCode = 0;
} catch (error) {
  for (const watcher of watchers) watcher.close();
  console.error(`Trusted in-memory test result rejected: ${error.message}`);
}

if (trustedTerminalResult) {
  const counts = trustedTerminalResult.counts;
  console.log([
    'Trusted in-memory test inventory:',
    `intended=${counts.intended}`,
    `discovered=${counts.discovered}`,
    `scheduled=${counts.scheduled}`,
    `started=${counts.started}`,
    `completed=${counts.completed}`,
    `passed=${counts.passed}`,
    `failed=${counts.failed}`,
    `skipped=${counts.skipped}`,
    `canceled=${counts.canceled}`,
    `interrupted=${counts.interrupted}`,
    'mutated=0',
  ].join(' '));
}

process.exitCode = exitCode;
