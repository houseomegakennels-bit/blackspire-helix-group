import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { configuredInteger, RUNTIME_INTEGER_CONFIG, validateProductionIntegerConfig } from '../packages/shared/runtime-numeric-config.js';

test('runtime integer controls use reviewed defaults', () => {
  for (const [name, config] of Object.entries(RUNTIME_INTEGER_CONFIG)) {
    assert.equal(configuredInteger(name, {}), config.defaultValue, name);
  }
});

test('runtime integer controls reject empty, fractional, nonnumeric, negative, and above-ceiling values', () => {
  for (const [name, config] of Object.entries(RUNTIME_INTEGER_CONFIG)) {
    for (const value of ['', '-1', '+1', '01', ' 1', '1 ', '1.5', '1e2', '0x10', 'NaN', 'Infinity', String(config.max + 1)]) {
      assert.throws(() => configuredInteger(name, { [name]: value }), new RegExp(name));
    }
  }
  assert.throws(() => configuredInteger('UNKNOWN', {}), /Unknown/);
});

test('controlled tests retain zero-delay and tiny fixture bounds while production refuses them', () => {
  assert.equal(configuredInteger('TELEGRAM_OUTBOX_RETRY_SECONDS', { TELEGRAM_OUTBOX_RETRY_SECONDS: '0' }), 0);
  assert.equal(configuredInteger('EVIDENCE_BUNDLE_MAX_BYTES', { EVIDENCE_BUNDLE_MAX_BYTES: '10' }), 10);
  assert.equal(configuredInteger('TELEGRAM_FILE_MAX_BYTES', { TELEGRAM_FILE_MAX_BYTES: '100' }), 100);
  const errors = validateProductionIntegerConfig({
    TELEGRAM_OUTBOX_RETRY_SECONDS: '0',
    EVIDENCE_BUNDLE_MAX_BYTES: '10',
    TELEGRAM_FILE_MAX_BYTES: '100',
    WORKER_POLL_MS: '1',
  });
  assert.match(errors.join('\n'), /TELEGRAM_OUTBOX_RETRY_SECONDS/);
  assert.match(errors.join('\n'), /EVIDENCE_BUNDLE_MAX_BYTES/);
  assert.match(errors.join('\n'), /TELEGRAM_FILE_MAX_BYTES/);
  assert.match(errors.join('\n'), /WORKER_POLL_MS/);
});

test('disposable iPhone build refuses malformed port and TTL before creating runtime state', () => {
  for (const overrides of [{ PORT: 'not-a-port' }, { PORT: '8790', UNIFIED_TEST_TTL_MS: '0' }]) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-runtime-config-'));
    const result = spawnSync(process.execPath, ['scripts/start-iphone-test-build.js'], {
      cwd: process.cwd(), env: { ...process.env, TMPDIR: temp, ...overrides }, encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.deepEqual(fs.readdirSync(temp), []);
  }
});
