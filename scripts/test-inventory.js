import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repositoryTests = path.join(repositoryRoot, 'tests');
const TERMINAL_STATUSES = new Set(['passed', 'failed', 'skipped', 'canceled', 'interrupted']);

export function canonicalPathComparator(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function assertContained(root, candidate, label) {
  const relative = path.relative(root, candidate);
  if (relative === '' || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes the approved test root`);
  }
}

function descriptorIdentity(root, file) {
  const before = fs.lstatSync(file);
  if (before.isSymbolicLink()) throw new Error(`test tree contains a symlink: ${file}`);
  if (!before.isFile()) throw new Error(`test tree entry is not a regular file: ${file}`);
  if (before.nlink !== 1) throw new Error(`test tree file has ambiguous hard-link count ${before.nlink}: ${file}`);

  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
  const descriptor = fs.openSync(file, flags);
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new Error(`test tree file identity changed while opening: ${file}`);
    }
    const openedRealpath = fs.realpathSync(`/proc/self/fd/${descriptor}`);
    assertContained(root, openedRealpath, 'opened test file');
    const content = fs.readFileSync(descriptor);
    const afterRead = fs.fstatSync(descriptor);
    const afterPath = fs.lstatSync(file);
    if (afterRead.dev !== opened.dev || afterRead.ino !== opened.ino
      || afterPath.dev !== opened.dev || afterPath.ino !== opened.ino
      || afterRead.size !== opened.size || afterPath.size !== opened.size) {
      throw new Error(`test tree file changed while hashing: ${file}`);
    }
    return {
      type: 'file',
      dev: opened.dev,
      ino: opened.ino,
      mode: opened.mode,
      nlink: opened.nlink,
      size: opened.size,
      mtimeMs: opened.mtimeMs,
      ctimeMs: opened.ctimeMs,
      sha256: crypto.createHash('sha256').update(content).digest('hex'),
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

function scanDirectory(root, directory, entries, testFiles) {
  const directoryLstat = fs.lstatSync(directory);
  if (!directoryLstat.isDirectory() || directoryLstat.isSymbolicLink()) {
    throw new Error(`test root contains a substituted directory: ${directory}`);
  }
  const directoryRealpath = fs.realpathSync(directory);
  if (directory !== root) assertContained(root, directoryRealpath, 'test directory');
  const relativeDirectory = path.relative(root, directory).split(path.sep).join('/') || '.';
  entries.push({
    path: relativeDirectory,
    type: 'directory',
    dev: directoryLstat.dev,
    ino: directoryLstat.ino,
    mode: directoryLstat.mode,
  });

  const children = fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => canonicalPathComparator(left.name, right.name));
  for (const child of children) {
    const absolute = path.join(directory, child.name);
    const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (child.isSymbolicLink()) throw new Error(`test tree contains a symlink: ${relative}`);
    if (child.isDirectory()) {
      scanDirectory(root, absolute, entries, testFiles);
      continue;
    }
    if (!child.isFile()) throw new Error(`test tree contains an unsupported entry: ${relative}`);
    entries.push({ path: relative, ...descriptorIdentity(root, absolute) });
    if (child.name.endsWith('.test.js')) testFiles.push(relative);
  }
}

export function captureTestTree(root, tests) {
  const canonicalRoot = fs.realpathSync(root);
  const canonicalTests = fs.realpathSync(tests);
  assertContained(canonicalRoot, canonicalTests, 'approved tests directory');
  const entries = [];
  const testFiles = [];
  scanDirectory(canonicalRoot, canonicalTests, entries, testFiles);
  entries.sort((left, right) => canonicalPathComparator(left.path, right.path));
  testFiles.sort(canonicalPathComparator);
  if (testFiles.length === 0) throw new Error('test discovery found no test files');
  return { root: canonicalRoot, tests: canonicalTests, entries, testFiles };
}

export function verifyTestTreeUnchanged(snapshot) {
  let current;
  try {
    current = captureTestTree(snapshot.root, snapshot.tests);
  } catch (error) {
    throw new Error(`test tree changed or was replaced: ${error.message}`);
  }
  if (JSON.stringify(current.entries) !== JSON.stringify(snapshot.entries)
    || JSON.stringify(current.testFiles) !== JSON.stringify(snapshot.testFiles)) {
    throw new Error('test tree changed, mutated, or had an identity replaced');
  }
  return current;
}

export function expectedTestFiles() {
  return captureTestTree(repositoryRoot, repositoryTests).testFiles;
}

export function testFilesUnder(root, tests) {
  return captureTestTree(root, tests).testFiles;
}

function listValues(label, values, expected) {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string' || value.length === 0)) {
    throw new Error(`${label} must be an array of non-empty paths`);
  }
  const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
  if (duplicates.length) throw new Error(`duplicate ${label}: ${[...new Set(duplicates)].join(', ')}`);
  const actualSet = new Set(values);
  const missing = expected.filter((value) => !actualSet.has(value));
  const unexpected = values.filter((value) => !expected.includes(value));
  if (missing.length) throw new Error(`missing ${label}: ${missing.join(', ')}`);
  if (unexpected.length) throw new Error(`unexpected ${label}: ${unexpected.join(', ')}`);
  const ordered = [...values].sort(canonicalPathComparator);
  if (values.some((value, index) => value !== ordered[index])) throw new Error(`${label} is not in canonical byte order`);
}

export function createLifecycleTracker(discovered) {
  listValues('discovered file', discovered, discovered);
  const state = new Map(discovered.map((file) => [file, 'discovered']));
  const scheduled = [];
  const started = [];
  const terminal = [];

  function knownState(file, event) {
    const current = state.get(file);
    if (!current) throw new Error(`unexpected ${event}: ${file}`);
    return current;
  }

  return {
    record(event, file, status) {
      const current = knownState(file, event);
      if (event === 'scheduled') {
        if (current !== 'discovered') throw new Error(`duplicate scheduling: ${file}`);
        state.set(file, 'scheduled');
        scheduled.push(file);
        return;
      }
      if (event === 'started') {
        if (current === 'discovered') throw new Error(`start before scheduling: ${file}`);
        if (current === 'started') throw new Error(`duplicate start: ${file}`);
        if (current === 'completed') throw new Error(`start after completion: ${file}`);
        state.set(file, 'started');
        started.push(file);
        return;
      }
      if (event === 'completed') {
        if (current === 'discovered' || current === 'scheduled') throw new Error(`completion before start: ${file}`);
        if (current === 'completed') throw new Error(`duplicate completion: ${file}`);
        if (!TERMINAL_STATUSES.has(status)) throw new Error(`invalid terminal lifecycle event for ${file}`);
        state.set(file, 'completed');
        terminal.push({ file, status });
        return;
      }
      throw new Error(`unsupported lifecycle event: ${event}`);
    },
    result() {
      return {
        discovered: [...discovered],
        scheduled: [...scheduled].sort(canonicalPathComparator),
        started: [...started].sort(canonicalPathComparator),
        terminal: [...terminal].sort((left, right) => canonicalPathComparator(left.file, right.file)),
      };
    },
  };
}

export function validateLifecycleResult(result, { requireSuccess = true } = {}) {
  if (!result || typeof result !== 'object') throw new Error('lifecycle result must be an object');
  const discovered = result.discovered ?? [];
  listValues('discovered file', discovered, discovered);
  listValues('scheduled file', result.scheduled, discovered);
  if (!Array.isArray(result.started)) throw new Error('start events must be an array');
  const duplicateStarts = result.started.filter((file, index) => result.started.indexOf(file) !== index);
  if (duplicateStarts.length) throw new Error(`duplicate start: ${[...new Set(duplicateStarts)].join(', ')}`);
  if (!Array.isArray(result.terminal)) throw new Error('terminal events must be an array');
  const terminalFiles = result.terminal.map((entry) => entry?.file);
  const terminalDuplicates = terminalFiles.filter((file, index) => terminalFiles.indexOf(file) !== index);
  if (terminalDuplicates.length) throw new Error(`duplicate completion: ${[...new Set(terminalDuplicates)].join(', ')}`);
  const started = new Set(result.started);
  const withoutStart = terminalFiles.filter((file) => !started.has(file));
  if (withoutStart.length) throw new Error(`completion without start: ${withoutStart.join(', ')}`);
  try {
    listValues('start event', result.started, result.scheduled);
  } catch (error) {
    if (/missing/.test(error.message)) throw new Error(error.message.replace('missing start event', 'missing start'));
    throw error;
  }
  listValues('completion', terminalFiles, result.scheduled);

  const counts = { passed: 0, failed: 0, skipped: 0, canceled: 0, interrupted: 0 };
  for (const entry of result.terminal) {
    if (!entry || typeof entry.file !== 'string' || !TERMINAL_STATUSES.has(entry.status)) {
      throw new Error(`invalid terminal lifecycle event for ${String(entry?.file)}`);
    }
    counts[entry.status] += 1;
    if (requireSuccess && entry.status !== 'passed') {
      throw new Error(`test file ${entry.file} ended ${entry.status}`);
    }
  }
  return {
    ...result,
    counts: {
      intended: discovered.length,
      discovered: discovered.length,
      scheduled: result.scheduled.length,
      started: result.started.length,
      completed: result.terminal.length,
      ...counts,
    },
  };
}

export function verifyTestInventory(expected, executed) {
  listValues('executed test file', executed, expected);
  return executed;
}
