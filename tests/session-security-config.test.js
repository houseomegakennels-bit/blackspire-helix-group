import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { credentialMatches } from '../packages/shared/credential-compare.js';
import { configuredSessionTtl } from '../packages/shared/sessions.js';

test('credential comparison accepts only the exact non-empty configured string', () => {
  assert.equal(credentialMatches('correct horse', 'correct horse'), true);
  assert.equal(credentialMatches('correct Horse', 'correct horse'), false);
  assert.equal(credentialMatches('', ''), false);
  assert.equal(credentialMatches(null, 'correct horse'), false);
  assert.equal(credentialMatches({ toString: () => 'correct horse' }, 'correct horse'), false);
});

test('session TTL uses the reviewed default and accepts only bounded integer milliseconds', () => {
  assert.equal(configuredSessionTtl({}), 28_800_000);
  assert.equal(configuredSessionTtl({ SESSION_TTL_MS: '' }), 28_800_000);
  assert.equal(configuredSessionTtl({ SESSION_TTL_MS: '60000' }), 60_000);
  assert.equal(configuredSessionTtl({ SESSION_TTL_MS: '86400000' }), 86_400_000);
  for (const value of ['0', '-1', '59999', '1.5', 'NaN', 'Infinity', '86400001']) {
    assert.throws(() => configuredSessionTtl({ SESSION_TTL_MS: value }), /SESSION_TTL_MS/);
  }
});

test('credential-bearing HTTP boundaries use the fixed-digest comparator', () => {
  const comparator = fs.readFileSync(new URL('../packages/shared/credential-compare.js', import.meta.url), 'utf8');
  const server = fs.readFileSync(new URL('../apps/api/server.js', import.meta.url), 'utf8');
  const sessions = fs.readFileSync(new URL('../packages/shared/sessions.js', import.meta.url), 'utf8');
  const security = fs.readFileSync(new URL('../packages/shared/security.js', import.meta.url), 'utf8');
  assert.match(server, /credentialMatches\(req\.headers\.authorization/);
  assert.match(server, /credentialMatches\(req\.headers\['x-telegram-bot-api-secret-token'\]/);
  assert.match(server, /credentialMatches\(req\.headers\['x-confirmation-token'\]/);
  assert.match(sessions, /credentialMatches\(adminToken, ADMIN_TOKEN\)/);
  assert.match(sessions, /NODE_ENV === 'production'.*UNIFIED_IPHONE_TEST_MODE !== 'true'/s);
  assert.match(security, /credentialMatches\(token, session\.csrfToken\)/);
  assert.match(comparator, /crypto\.timingSafeEqual\(candidateDigest, expectedDigest\)/);
  assert.doesNotMatch(comparator, /candidate\s*={2,3}\s*expected/);
});
