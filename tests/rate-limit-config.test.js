import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredRateLimit, rateLimit } from '../packages/shared/rateLimits.js';

test('configured rate limits use reviewed defaults and accept bounded integers', () => {
  assert.equal(configuredRateLimit('LOGIN_RATE_LIMIT', {}), 5);
  assert.equal(configuredRateLimit('TASK_RATE_LIMIT', { TASK_RATE_LIMIT: '99' }), 99);
  assert.equal(configuredRateLimit('TELEGRAM_RATE_LIMIT', { TELEGRAM_RATE_LIMIT: '' }), 30);
});

test('configured rate limits fail closed for invalid values and unknown keys', () => {
  for (const value of ['0', '-1', '1.5', 'NaN', 'Infinity', '101']) {
    assert.throws(() => configuredRateLimit('LOGIN_RATE_LIMIT', { LOGIN_RATE_LIMIT: value }), /LOGIN_RATE_LIMIT/);
  }
  assert.throws(() => configuredRateLimit('UNKNOWN', {}), /Unknown/);
});

test('rate limiter rejects invalid programmer inputs before touching persistence', () => {
  assert.throws(() => rateLimit('', { limit: 1, windowMs: 1000 }), /key/);
  assert.throws(() => rateLimit('bucket', { limit: 0, windowMs: 1000 }), /limit/);
  assert.throws(() => rateLimit('bucket', { limit: 1.5, windowMs: 1000 }), /limit/);
  assert.throws(() => rateLimit('bucket', { limit: 1, windowMs: 0 }), /window/);
  assert.throws(() => rateLimit('bucket', { limit: 1, windowMs: 86_400_001 }), /window/);
});
