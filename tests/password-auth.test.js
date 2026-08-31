import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createPasswordDerivationLimiter, hashAdminPassword, parseAdminPasswordHash, validPasswordInput, verifyAdminPassword, verifyAdminPasswordAsync, verifyAdminPasswordAsyncResult } from '../packages/shared/password-auth.js';
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

function controlledDerivations() {
  const pending = [];
  let started = 0;
  let active = 0;
  let peak = 0;
  const scrypt = (password, salt, length, options, callback) => {
    started += 1;
    active += 1;
    peak = Math.max(peak, active);
    pending.push({ password, salt, length, options, callback });
  };
  const finish = (index, error = null) => {
    const job = pending[index];
    active -= 1;
    if (error) job.callback(error);
    else crypto.scrypt(job.password, job.salt, job.length, job.options, job.callback);
  };
  return { scrypt, pending, finish, stats: () => ({ started, active, peak }) };
}

test('process-wide admission refuses excess derivations without a waiting queue', async () => {
  const encoded = hashAdminPassword('thirteen-char');
  const limiter = createPasswordDerivationLimiter(2);
  const controlled = controlledDerivations();
  const first = verifyAdminPasswordAsyncResult('thirteen-char', encoded, { limiter, scrypt: controlled.scrypt });
  const second = verifyAdminPasswordAsyncResult('incorrect-password', encoded, { limiter, scrypt: controlled.scrypt });
  const excess = await Promise.all(Array.from({ length: 6 }, () => verifyAdminPasswordAsyncResult('thirteen-char', encoded, { limiter, scrypt: controlled.scrypt })));
  assert.deepEqual(controlled.stats(), { started: 2, active: 2, peak: 2 });
  assert.ok(excess.every((result) => result.status === 'overloaded'));
  controlled.finish(0);
  controlled.finish(1);
  assert.equal((await first).status, 'verified');
  assert.equal((await second).status, 'invalid');
  assert.equal(limiter.active, 0);
});

test('derivation capacity is released after success, mismatch, and thrown errors', async () => {
  const encoded = hashAdminPassword('thirteen-char');
  const limiter = createPasswordDerivationLimiter(1);
  assert.equal((await verifyAdminPasswordAsyncResult('thirteen-char', encoded, { limiter })).status, 'verified');
  assert.equal(limiter.active, 0);
  assert.equal((await verifyAdminPasswordAsyncResult('incorrect-password', encoded, { limiter })).status, 'invalid');
  assert.equal(limiter.active, 0);
  const throwing = (_password, _salt, _length, _options, callback) => callback(new Error('deliberate derivation failure'));
  assert.equal((await verifyAdminPasswordAsyncResult('thirteen-char', encoded, { limiter, scrypt: throwing })).status, 'invalid');
  assert.equal(limiter.active, 0);
  assert.equal((await verifyAdminPasswordAsyncResult('thirteen-char', encoded, { limiter })).status, 'verified');
});

test('HTTP login awaits the asynchronous verifier', () => {
  const server = fs.readFileSync(new URL('../apps/api/server.js', import.meta.url), 'utf8');
  assert.match(server, /await verifyAdminPasswordAsyncResult\(password, ADMIN_PASSWORD_HASH\)/);
  assert.doesNotMatch(server, /verifyAdminPassword\(submitted, ADMIN_PASSWORD_HASH\)/);
});

test('browser login never submits or falls back to the machine admin token', () => {
  const client = fs.readFileSync(new URL('../apps/jarvis-pwa/public/jarvis.js', import.meta.url), 'utf8');
  assert.match(client, /JSON\.stringify\(\{ password \}\)/);
  assert.doesNotMatch(client, /JSON\.stringify\(\{ adminToken/);
  const guide = fs.readFileSync(new URL('../docs/JARVIS_PASSWORD_AUTHENTICATION.md', import.meta.url), 'utf8');
  assert.match(guide, /including development, must configure `COMMAND_ADMIN_PASSWORD_HASH`/);
  assert.match(guide, /browser never submits or falls back to `COMMAND_ADMIN_TOKEN`/);
  const iphoneGuide = fs.readFileSync(new URL('../JARVIS_UI_IPHONE_TEST_GUIDE.md', import.meta.url), 'utf8');
  assert.match(iphoneGuide, /COMMAND_ADMIN_PASSWORD_HASH/);
  assert.match(iphoneGuide, /disposable password/);
  assert.doesNotMatch(iphoneGuide, /token field|wrong token|COMMAND_ADMIN_TOKEN set/);
});
