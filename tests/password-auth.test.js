import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { hashAdminPassword, parseAdminPasswordHash, validPasswordInput, verifyAdminPassword, verifyAdminPasswordAsync } from '../packages/shared/password-auth.js';
test('password policy accepts exact boundaries without trimming', () => { assert.equal(validPasswordInput('a'.repeat(12)), false); assert.equal(validPasswordInput('a'.repeat(13)), true); assert.equal(validPasswordInput('a'.repeat(128)), true); assert.equal(validPasswordInput('a'.repeat(129)), false); const spaced = '  exact spaces '; const encoded = hashAdminPassword(spaced); assert.equal(verifyAdminPassword(spaced, encoded), true); assert.equal(verifyAdminPassword(spaced.trim(), encoded), false); });
test('scrypt hashes are salted, versioned, and fail closed', () => { const password = 'thirteen-char'; const first = hashAdminPassword(password); const second = hashAdminPassword(password); assert.notEqual(first, second); assert.ok(parseAdminPasswordHash(first)); assert.equal(verifyAdminPassword(password, first), true); assert.equal(verifyAdminPassword('incorrect-password', first), false); for (const malformed of ['', 'v2$scrypt$16384$8$1$x$x$p13-128', first.replace('$16384$', '$1$')]) { assert.equal(parseAdminPasswordHash(malformed), null); assert.equal(verifyAdminPassword(password, malformed), false); } assert.equal(verifyAdminPassword('x'.repeat(129), first), false); });

test('asynchronous password verification authenticates valid input and fails closed', async () => {
  const encoded = hashAdminPassword('thirteen-char');
  assert.equal(await verifyAdminPasswordAsync('thirteen-char', encoded), true);
  assert.equal(await verifyAdminPasswordAsync('incorrect-password', encoded), false);
  assert.equal(await verifyAdminPasswordAsync('thirteen-char', 'v1$scrypt$broken'), false);
  assert.equal(await verifyAdminPasswordAsync('x'.repeat(129), encoded), false);
});

test('asynchronous password verification yields while derivation is in flight', async () => {
  const password = 'thirteen-char';
  const encoded = hashAdminPassword(password);
  let derivationStarted = false;
  let releaseDerivation;
  const derivationReleased = new Promise((resolve) => { releaseDerivation = resolve; });
  const controlledScrypt = (submitted, salt, length, options, callback) => {
    derivationStarted = true;
    derivationReleased.then(() => crypto.scrypt(submitted, salt, length, options, callback));
  };
  const verification = verifyAdminPasswordAsync(password, encoded, controlledScrypt);
  assert.equal(derivationStarted, true);
  let eventLoopProgressed = false;
  await new Promise((resolve) => setImmediate(() => { eventLoopProgressed = true; resolve(); }));
  assert.equal(eventLoopProgressed, true, 'the API event loop must progress before password derivation completes');
  releaseDerivation();
  assert.equal(await verification, true);
});

test('HTTP login awaits the asynchronous verifier', () => {
  const server = fs.readFileSync(new URL('../apps/api/server.js', import.meta.url), 'utf8');
  assert.match(server, /await verifyAdminPasswordAsync\(submitted, ADMIN_PASSWORD_HASH\)/);
  assert.doesNotMatch(server, /verifyAdminPassword\(submitted, ADMIN_PASSWORD_HASH\)/);
});
