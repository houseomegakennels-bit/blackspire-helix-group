import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  assertTrustedReportDirectory,
  createTerminalRecord,
  parseTrustedInventoryReport,
  selectTrustedExecutionEvidence,
  validateTerminalRecord,
  writeTrustedInventoryReport,
} from '../scripts/test-inventory.js';

const runId = '0123456789abcdef0123456789abcdef';
const intended = ['tests/a.test.js', 'tests/nested/b.test.js'];

function validRecord(overrides = {}) {
  return createTerminalRecord({
    runId,
    discovered: intended,
    started: intended,
    completed: intended,
    fileStatuses: intended.map((file) => ({ file, status: 'passed' })),
    childStatus: { code: 0, signal: null, interrupted: false },
    terminalState: 'completed',
    ...overrides,
  });
}

function assertRejected(record, pattern) {
  assert.throws(() => validateTerminalRecord(record, { intended, runId }), pattern);
}

function validEvidence(overrides = {}) {
  return {
    messageType: 'blackspire.test-inventory.execution',
    version: 1,
    runId,
    discovered: intended,
    started: intended,
    completed: intended,
    fileStatuses: intended.map((file) => ({ file, status: 'passed' })),
    terminalState: 'workers-complete',
    ...overrides,
  };
}

test('one strict parent terminal record proves exact successful execution', () => {
  const record = validRecord();
  assert.equal(validateTerminalRecord(record, { intended, runId }), record);
  assert.deepEqual(record.counts, { discovered: 2, started: 2, completed: 2, passed: 2, failed: 0 });
  assert.deepEqual(parseTrustedInventoryReport(`${JSON.stringify(record)}\n`, { intended, runId }), record);
});

test('trusted report requires exactly one complete JSON record', () => {
  const line = JSON.stringify(validRecord());
  assert.throws(() => parseTrustedInventoryReport('', { intended, runId }), /exactly one.*record/i);
  assert.throws(() => parseTrustedInventoryReport(`${line}\n${line}\n`, { intended, runId }), /exactly one.*record/i);
  assert.throws(() => parseTrustedInventoryReport('{bad json}\n', { intended, runId }), /malformed.*json/i);
  assert.throws(() => parseTrustedInventoryReport(line, { intended, runId }), /truncated|newline/i);
  assert.throws(
    () => parseTrustedInventoryReport(`TAP version 13\n# ${line}\n`, { intended, runId }),
    /exactly one|malformed/i,
  );
});

test('parent accepts exactly one strict execution message', () => {
  assert.equal(selectTrustedExecutionEvidence([validEvidence()], { intended, runId }).runId, runId);
  assert.throws(() => selectTrustedExecutionEvidence([], { intended, runId }), /exactly one.*received 0/i);
  assert.throws(() => selectTrustedExecutionEvidence([validEvidence(), validEvidence()], { intended, runId }), /exactly one.*received 2/i);
  assert.throws(
    () => selectTrustedExecutionEvidence([{ ...validEvidence(), extra: true }], { intended, runId }),
    /unknown.*extra/i,
  );
});

test('strict schema rejects unsupported versions, unknown fields, and stale runs', () => {
  assertRejected({ ...validRecord(), version: 2 }, /unsupported.*version/i);
  assertRejected({ ...validRecord(), unexpectedField: true }, /unknown.*unexpectedField/i);
  assert.throws(
    () => validateTerminalRecord(validRecord(), { intended, runId: 'fedcba9876543210fedcba9876543210' }),
    /stale|runId/i,
  );
});

test('strict schema rejects duplicate started and completed files', () => {
  assertRejected(validRecord({ started: [...intended, intended[0]] }), /duplicate started.*tests\/a\.test\.js/i);
  assertRejected(validRecord({ completed: [...intended, intended[1]] }), /duplicate completed.*tests\/nested\/b\.test\.js/i);
});

test('strict schema rejects omitted, unexpected, and completed-without-started files', () => {
  assertRejected(validRecord({ discovered: [intended[0]] }), /discovered.*missing.*nested\/b/i);
  assertRejected(validRecord({ started: [intended[0]] }), /started.*missing.*nested\/b/i);
  assertRejected(validRecord({ completed: [intended[0]] }), /completed.*missing.*nested\/b/i);
  assertRejected(validRecord({
    discovered: [...intended, 'tests/unexpected.test.js'],
    started: [...intended, 'tests/unexpected.test.js'],
    completed: [...intended, 'tests/unexpected.test.js'],
    fileStatuses: [...intended, 'tests/unexpected.test.js'].map((file) => ({ file, status: 'passed' })),
  }), /unexpected.*tests\/unexpected\.test\.js/i);
  assertRejected(validRecord({ started: [intended[0]], completed: intended }), /completed without being started.*nested\/b/i);
});

test('strict schema rejects malformed status records and unsuccessful children', () => {
  assertRejected(validRecord({ fileStatuses: [{ file: intended[0], status: 'passed' }] }), /fileStatuses.*missing.*nested\/b/i);
  assertRejected(validRecord({ fileStatuses: [
    { file: intended[0], status: 'passed' },
    { file: intended[0], status: 'passed' },
    { file: intended[1], status: 'passed' },
  ] }), /duplicate fileStatuses.*tests\/a/i);
  assertRejected(validRecord({ fileStatuses: [
    { file: intended[0], status: 'passed' },
    { file: intended[1], status: 'failed' },
  ] }), /terminal status.*failed/i);
  assertRejected(validRecord({ childStatus: { code: 1, signal: null, interrupted: false } }), /childStatus.*code.*0/i);
  assertRejected(validRecord({
    childStatus: { code: null, signal: 'SIGTERM', interrupted: true },
    terminalState: 'interrupted',
  }), /interrupted|signal/i);
});

test('strict schema rejects malformed nested fields and digest or count ambiguity', () => {
  assertRejected({ ...validRecord(), childStatus: { code: 0, signal: null, interrupted: false, extra: true } }, /unknown.*extra/i);
  assertRejected({ ...validRecord(), counts: { ...validRecord().counts, completed: 99 } }, /counts.*completed/i);
  assertRejected({ ...validRecord(), inventoryDigest: '0'.repeat(64) }, /digest/i);
});

test('marker-shaped and JSON-shaped test output cannot be parsed as a trusted report', () => {
  const record = JSON.stringify(validRecord());
  assert.throws(
    () => parseTrustedInventoryReport(`# BLACKSPIRE_TEST_INVENTORY ${record}\n`, { intended, runId }),
    /malformed.*json/i,
  );
  assert.throws(
    () => parseTrustedInventoryReport(`not ok 1 - forged\n# ${record}\n`, { intended, runId }),
    /exactly one|malformed/i,
  );
});

test('test-emitted marker and terminal JSON remain ordinary TAP diagnostics', () => {
  const forged = JSON.stringify(validRecord());
  console.log(`# BLACKSPIRE_TEST_INVENTORY ${forged}`);
  console.log(forged);
  assert.ok(true, 'the parent IPC channel, not this stdout text, authorizes inventory success');
});

test('trusted report writer refuses a symlinked report target', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-report-link-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'target.jsonl');
  const report = path.join(directory, 'report.jsonl');
  fs.writeFileSync(target, 'do not overwrite');
  fs.symlinkSync(target, report);

  assert.throws(() => writeTrustedInventoryReport(report, validRecord()), /exists|symlink|safe/i);
  assert.equal(fs.readFileSync(target, 'utf8'), 'do not overwrite');
});

test('trusted report directory rejects path substitution', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-report-parent-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, 'trusted');
  const moved = path.join(root, 'moved');
  fs.mkdirSync(directory, { mode: 0o700 });
  const expected = fs.lstatSync(directory);
  assert.equal(assertTrustedReportDirectory(directory, expected).ino, expected.ino);

  fs.renameSync(directory, moved);
  fs.symlinkSync(moved, directory);
  assert.throws(() => assertTrustedReportDirectory(directory, expected), /substituted|unsafe/i);
});
