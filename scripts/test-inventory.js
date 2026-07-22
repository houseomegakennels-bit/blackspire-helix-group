import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDirectory = path.join(rootDirectory, 'tests');
const recordFields = [
  'recordType',
  'version',
  'runId',
  'inventoryDigest',
  'counts',
  'discovered',
  'started',
  'completed',
  'fileStatuses',
  'childStatus',
  'terminalState',
];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function unknownFields(value, allowed, label) {
  if (!isPlainObject(value)) return [`${label} must be an object`];
  return Object.keys(value)
    .filter((field) => !allowed.includes(field))
    .map((field) => `${label} contains unknown field ${field}`);
}

function inventoryDigest(files) {
  return crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex');
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates].sort(canonicalPathComparator);
}

function listErrors(label, intended, actual) {
  if (!Array.isArray(actual)) return [`${label} must be an array`];
  const errors = [];
  if (actual.some((file) => typeof file !== 'string' || file.length === 0)) {
    errors.push(`${label} must contain only non-empty file paths`);
    return errors;
  }
  const duplicates = duplicateValues(actual);
  const intendedSet = new Set(intended);
  const actualSet = new Set(actual);
  const missing = intended.filter((file) => !actualSet.has(file));
  const unexpected = actual.filter((file) => !intendedSet.has(file));
  if (duplicates.length) errors.push(`duplicate ${label} test files: ${duplicates.join(', ')}`);
  if (missing.length) errors.push(`${label} inventory missing test files: ${missing.join(', ')}`);
  if (unexpected.length) errors.push(`${label} inventory has unexpected test files: ${unexpected.join(', ')}`);
  const canonical = [...actual].sort(canonicalPathComparator);
  if (actual.length === canonical.length && actual.some((file, index) => file !== canonical[index])) {
    errors.push(`${label} inventory is not in canonical byte order`);
  }
  return errors;
}

export function canonicalPathComparator(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function collectTestFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => canonicalPathComparator(left.name, right.name))
    .flatMap((entry) => {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectTestFiles(file);
      return entry.isFile() && entry.name.endsWith('.test.js') ? [file] : [];
    });
}

export function testFilesUnder(root, tests) {
  return collectTestFiles(tests)
    .map((file) => path.relative(root, file).split(path.sep).join('/'))
    .sort(canonicalPathComparator);
}

export function expectedTestFiles() {
  return testFilesUnder(rootDirectory, testDirectory);
}

export function verifyTestInventory(expected, executed) {
  const errors = listErrors('executed', expected, executed);
  if (errors.length) throw new Error(errors.join('; '));
  return executed;
}

export function createTerminalRecord({
  runId,
  discovered,
  started,
  completed,
  fileStatuses,
  childStatus,
  terminalState,
}) {
  const passed = Array.isArray(fileStatuses)
    ? fileStatuses.filter((entry) => entry?.status === 'passed').length
    : 0;
  const failed = Array.isArray(fileStatuses) ? fileStatuses.length - passed : 0;
  return {
    recordType: 'blackspire.test-inventory.terminal',
    version: 1,
    runId,
    inventoryDigest: inventoryDigest(discovered),
    counts: {
      discovered: discovered.length,
      started: started.length,
      completed: completed.length,
      passed,
      failed,
    },
    discovered,
    started,
    completed,
    fileStatuses,
    childStatus,
    terminalState,
  };
}

export function validateExecutionEvidence(evidence, { intended, runId }) {
  const allowed = [
    'messageType', 'version', 'runId', 'discovered', 'started', 'completed', 'fileStatuses', 'terminalState',
  ];
  const errors = unknownFields(evidence, allowed, 'execution evidence');
  if (!isPlainObject(evidence)) throw new Error(errors.join('; '));
  if (evidence.messageType !== 'blackspire.test-inventory.execution') {
    errors.push('execution evidence has an unsupported message type');
  }
  if (evidence.version !== 1) errors.push(`execution evidence has unsupported version ${String(evidence.version)}`);
  if (evidence.runId !== runId) errors.push('execution evidence has a stale or foreign runId');
  errors.push(...listErrors('discovered', intended, evidence.discovered));
  errors.push(...listErrors('started', intended, evidence.started));
  errors.push(...listErrors('completed', intended, evidence.completed));
  if (Array.isArray(evidence.started) && Array.isArray(evidence.completed)) {
    const startedSet = new Set(evidence.started);
    const withoutStart = evidence.completed.filter((file) => !startedSet.has(file));
    if (withoutStart.length) errors.push(`test files completed without being started: ${withoutStart.join(', ')}`);
  }
  if (!Array.isArray(evidence.fileStatuses)) {
    errors.push('execution evidence fileStatuses must be an array');
  } else {
    const statusFiles = [];
    for (const [index, entry] of evidence.fileStatuses.entries()) {
      errors.push(...unknownFields(entry, ['file', 'status'], `execution evidence fileStatuses[${index}]`));
      if (!isPlainObject(entry) || typeof entry.file !== 'string') {
        errors.push(`execution evidence fileStatuses[${index}] must identify a file`);
        continue;
      }
      statusFiles.push(entry.file);
      if (!['passed', 'failed', 'cancelled'].includes(entry.status)) {
        errors.push(`execution evidence fileStatuses[${index}] has invalid status ${String(entry.status)}`);
      }
    }
    errors.push(...listErrors('fileStatuses', intended, statusFiles));
  }
  if (evidence.terminalState !== 'workers-complete') {
    errors.push(`execution evidence terminalState must be workers-complete, got ${String(evidence.terminalState)}`);
  }
  if (errors.length) throw new Error(errors.join('; '));
  return evidence;
}

export function selectTrustedExecutionEvidence(messages, options) {
  if (!Array.isArray(messages) || messages.length !== 1) {
    throw new Error(`expected exactly one trusted execution message, received ${Array.isArray(messages) ? messages.length : 0}`);
  }
  return validateExecutionEvidence(messages[0], options);
}

export function validateTerminalRecord(record, { intended, runId }) {
  const errors = unknownFields(record, recordFields, 'terminal record');
  if (!isPlainObject(record)) throw new Error(errors.join('; '));
  if (record.recordType !== 'blackspire.test-inventory.terminal') {
    errors.push('terminal record has an unsupported record type');
  }
  if (record.version !== 1) errors.push(`terminal record has unsupported version ${String(record.version)}`);
  if (typeof record.runId !== 'string' || !/^[a-f0-9]{32}$/.test(record.runId)) {
    errors.push('terminal record runId must be 32 lowercase hexadecimal characters');
  } else if (record.runId !== runId) {
    errors.push(`terminal record is stale or foreign: runId ${record.runId} does not match this run`);
  }

  errors.push(...listErrors('discovered', intended, record.discovered));
  errors.push(...listErrors('started', intended, record.started));
  errors.push(...listErrors('completed', intended, record.completed));

  if (Array.isArray(record.started) && Array.isArray(record.completed)) {
    const startedSet = new Set(record.started);
    const withoutStart = record.completed.filter((file) => !startedSet.has(file));
    if (withoutStart.length) {
      errors.push(`test files completed without being started: ${[...new Set(withoutStart)].join(', ')}`);
    }
  }

  if (!Array.isArray(record.fileStatuses)) {
    errors.push('fileStatuses must be an array');
  } else {
    const statusFiles = [];
    for (const [index, entry] of record.fileStatuses.entries()) {
      errors.push(...unknownFields(entry, ['file', 'status'], `fileStatuses[${index}]`));
      if (!isPlainObject(entry) || typeof entry.file !== 'string') {
        errors.push(`fileStatuses[${index}] must identify a file`);
        continue;
      }
      statusFiles.push(entry.file);
      if (!['passed', 'failed', 'cancelled'].includes(entry.status)) {
        errors.push(`fileStatuses[${index}] has invalid terminal status ${String(entry.status)}`);
      } else if (entry.status !== 'passed') {
        errors.push(`test file ${entry.file} has unsuccessful terminal status ${entry.status}`);
      }
    }
    errors.push(...listErrors('fileStatuses', intended, statusFiles));
  }

  errors.push(...unknownFields(record.counts, ['discovered', 'started', 'completed', 'passed', 'failed'], 'counts'));
  if (isPlainObject(record.counts)) {
    const expectedCounts = {
      discovered: Array.isArray(record.discovered) ? record.discovered.length : -1,
      started: Array.isArray(record.started) ? record.started.length : -1,
      completed: Array.isArray(record.completed) ? record.completed.length : -1,
      passed: Array.isArray(record.fileStatuses)
        ? record.fileStatuses.filter((entry) => entry?.status === 'passed').length
        : -1,
      failed: Array.isArray(record.fileStatuses)
        ? record.fileStatuses.filter((entry) => entry?.status !== 'passed').length
        : -1,
    };
    for (const [field, expected] of Object.entries(expectedCounts)) {
      if (record.counts[field] !== expected) errors.push(`counts.${field} must equal ${expected}`);
    }
  }

  if (Array.isArray(record.discovered) && record.inventoryDigest !== inventoryDigest(record.discovered)) {
    errors.push('terminal record inventory digest does not match discovered files');
  }

  errors.push(...unknownFields(record.childStatus, ['code', 'signal', 'interrupted'], 'childStatus'));
  if (isPlainObject(record.childStatus)) {
    if (record.childStatus.code !== 0) errors.push('childStatus.code must be 0');
    if (record.childStatus.signal !== null) errors.push(`childStatus signal must be null, got ${String(record.childStatus.signal)}`);
    if (record.childStatus.interrupted !== false) errors.push('childStatus reports an interrupted child process');
  }
  if (record.terminalState !== 'completed') {
    errors.push(`overall parent terminal state must be completed, got ${String(record.terminalState)}`);
  }

  if (errors.length) throw new Error(errors.join('; '));
  return record;
}

export function parseTrustedInventoryReport(content, options) {
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('trusted report must contain exactly one terminal record');
  }
  if (!content.endsWith('\n')) throw new Error('trusted report is truncated or lacks its terminal newline');
  const lines = content.slice(0, -1).split('\n');
  if (lines.length !== 1 || lines[0].length === 0) {
    throw new Error('trusted report must contain exactly one terminal record');
  }
  let record;
  try {
    record = JSON.parse(lines[0]);
  } catch (error) {
    throw new Error(`trusted report contains malformed JSON: ${error.message}`);
  }
  return validateTerminalRecord(record, options);
}

export function writeTrustedInventoryReport(reportPath, record) {
  const flags = fs.constants.O_WRONLY
    | fs.constants.O_CREAT
    | fs.constants.O_EXCL
    | (fs.constants.O_NOFOLLOW ?? 0);
  let descriptor;
  try {
    descriptor = fs.openSync(reportPath, flags, 0o600);
    fs.writeFileSync(descriptor, `${JSON.stringify(record)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
  } catch (error) {
    throw new Error(`trusted report target is not safe or already exists: ${error.message}`);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function assertTrustedReportDirectory(directory, expected) {
  const current = fs.lstatSync(directory);
  if (!current.isDirectory()
    || current.isSymbolicLink()
    || current.dev !== expected.dev
    || current.ino !== expected.ino
    || current.uid !== expected.uid
    || (current.mode & 0o777) !== 0o700) {
    throw new Error('trusted report directory was substituted or has unsafe ownership or permissions');
  }
  return current;
}

export function readTrustedInventoryReport(reportPath, options) {
  const stat = fs.lstatSync(reportPath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('trusted report path must be a regular non-symlink file');
  if ((stat.mode & 0o777) !== 0o600) throw new Error('trusted report permissions must be 0600');
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
    throw new Error('trusted report must be owned by the current parent user');
  }
  if (stat.size > 1024 * 1024) throw new Error('trusted report exceeds the maximum safe size');
  return parseTrustedInventoryReport(fs.readFileSync(reportPath, 'utf8'), options);
}
