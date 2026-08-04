import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredBoolean, validateProductionBooleanConfig } from '../packages/shared/runtime-boolean-config.js';

test('boolean configuration accepts only canonical true and false strings', () => {
  assert.equal(configuredBoolean('FLAG', { FLAG: 'true' }), true);
  assert.equal(configuredBoolean('FLAG', { FLAG: 'false' }), false);
  assert.equal(configuredBoolean('FLAG', {}), undefined);
  for (const value of ['', 'TRUE', 'False', '1', '0', ' yes', 'false ']) {
    assert.throws(() => configuredBoolean('FLAG', { FLAG: value }), /FLAG/);
  }
  assert.throws(() => configuredBoolean('FLAG', {}, { required: true }), /FLAG/);
});

test('approved production booleans are explicit and safety-preserving', () => {
  const valid = {
    SECURE_COOKIES: 'true', DEBUG: 'false', RATE_LIMIT_DISABLED: 'false', TRUST_PROXY: 'true',
    GIT_WORKFLOW_ENABLED: 'false', UNIFIED_IPHONE_TEST_MODE: 'false', ALLOW_BEARER_AUTH: 'false',
    BLACKSPIRE_RUN_MIGRATIONS: 'false',
  };
  assert.deepEqual(validateProductionBooleanConfig(valid), []);
  for (const [name, value] of Object.entries(valid)) {
    assert.match(validateProductionBooleanConfig({ ...valid, [name]: `${value} ` }).join('\n'), new RegExp(name));
  }
  for (const name of ['SECURE_COOKIES', 'DEBUG', 'RATE_LIMIT_DISABLED', 'TRUST_PROXY', 'GIT_WORKFLOW_ENABLED']) {
    const missing = { ...valid };
    delete missing[name];
    assert.match(validateProductionBooleanConfig(missing).join('\n'), new RegExp(name));
  }
  for (const [name, unsafe] of [['SECURE_COOKIES', 'false'], ['DEBUG', 'true'], ['RATE_LIMIT_DISABLED', 'true'], ['UNIFIED_IPHONE_TEST_MODE', 'true']]) {
    assert.match(validateProductionBooleanConfig({ ...valid, [name]: unsafe }).join('\n'), new RegExp(name));
  }
  assert.deepEqual(validateProductionBooleanConfig({ ...valid, ALLOW_BEARER_AUTH: 'true', GIT_WORKFLOW_ENABLED: 'true' }), []);
});
