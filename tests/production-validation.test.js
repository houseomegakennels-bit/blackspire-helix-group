import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-prodvalidation-'));
const writableDbDir = path.join(root, 'db');
const writableAttachmentsDir = path.join(root, 'attachments');
fs.mkdirSync(writableDbDir, { recursive: true });
fs.mkdirSync(writableAttachmentsDir, { recursive: true });

const { requireProductionSafeConfig } = await import('../packages/shared/security.js');

function validEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    COMMAND_ADMIN_TOKEN: 'a'.repeat(32),
    SESSION_SECRET: 'b'.repeat(40),
    SECURE_COOKIES: 'true',
    PUBLIC_BASE_URL: 'https://command.example.com',
    TELEGRAM_MODE: 'polling',
    DEBUG: 'false',
    CORS_ORIGIN: 'https://command.example.com',
    RATE_LIMIT_DISABLED: 'false',
    TRUST_PROXY: 'false',
    GIT_WORKFLOW_ENABLED: 'false',
    ...overrides,
  };
}

function dirs(overrides = {}) {
  return { dbDir: writableDbDir, attachmentsDir: writableAttachmentsDir, ...overrides };
}

test('valid production configuration passes with zero errors', () => {
  const result = requireProductionSafeConfig(validEnv(), dirs());
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test('rejects a missing or placeholder admin token', () => {
  assert.match(requireProductionSafeConfig(validEnv({ COMMAND_ADMIN_TOKEN: 'dev-admin-token-change-me' }), dirs()).errors.join(), /COMMAND_ADMIN_TOKEN/);
  assert.equal(requireProductionSafeConfig(validEnv({ COMMAND_ADMIN_TOKEN: '' }), dirs()).ok, false);
});

test('rejects a weak (short) admin token', () => {
  assert.match(requireProductionSafeConfig(validEnv({ COMMAND_ADMIN_TOKEN: 'short' }), dirs()).errors.join(), /COMMAND_ADMIN_TOKEN/);
});

test('rejects a weak or missing session secret', () => {
  assert.match(requireProductionSafeConfig(validEnv({ SESSION_SECRET: 'too-short' }), dirs()).errors.join(), /SESSION_SECRET/);
});

test('rejects an HTTP (non-HTTPS) public base URL', () => {
  assert.match(requireProductionSafeConfig(validEnv({ PUBLIC_BASE_URL: 'http://command.example.com' }), dirs()).errors.join(), /HTTPS/);
});

test('rejects secure cookies disabled', () => {
  assert.match(requireProductionSafeConfig(validEnv({ SECURE_COOKIES: 'false' }), dirs()).errors.join(), /SECURE_COOKIES/);
});

test('rejects wildcard CORS', () => {
  assert.match(requireProductionSafeConfig(validEnv({ CORS_ORIGIN: '*' }), dirs()).errors.join(), /CORS/);
});

test('rejects debug mode', () => {
  assert.match(requireProductionSafeConfig(validEnv({ DEBUG: 'true' }), dirs()).errors.join(), /DEBUG/);
});

test('rejects rate limiting disabled', () => {
  assert.match(requireProductionSafeConfig(validEnv({ RATE_LIMIT_DISABLED: 'true' }), dirs()).errors.join(), /Rate limiting/);
});

test('rejects webhook mode without a Telegram webhook secret', () => {
  assert.match(requireProductionSafeConfig(validEnv({ TELEGRAM_MODE: 'webhook', TELEGRAM_WEBHOOK_SECRET: '' }), dirs()).errors.join(), /TELEGRAM_WEBHOOK_SECRET/);
});

test('rejects missing trusted-proxy configuration', () => {
  const env = validEnv();
  delete env.TRUST_PROXY;
  assert.match(requireProductionSafeConfig(env, dirs()).errors.join(), /TRUST_PROXY/);
});

test('rejects an unsupported Node.js version', () => {
  assert.match(requireProductionSafeConfig(validEnv({ NODE_VERSION_OVERRIDE: '16.20.0' }), dirs()).errors.join(), /Node\.js/);
});

// Note: this sandbox runs as root, where chmod-based permission bits do not actually block writes
// (root bypasses the mode check). To make "unwritable directory" deterministic under any UID, a plain
// file is placed where the directory needs to be created, so mkdirSync(..., {recursive:true}) fails with
// EEXIST/ENOTDIR regardless of who is running the process.
function unwritablePath(name) {
  const target = path.join(root, name);
  fs.writeFileSync(target, 'not a directory');
  return target;
}

test('rejects an unwritable database directory', () => {
  const blocked = unwritablePath('locked-db');
  assert.match(requireProductionSafeConfig(validEnv(), dirs({ dbDir: blocked })).errors.join(), /Database directory/);
});

test('rejects an unwritable Telegram attachment directory', () => {
  const blocked = unwritablePath('locked-attachments');
  assert.match(requireProductionSafeConfig(validEnv(), dirs({ attachmentsDir: blocked })).errors.join(), /attachment directory/);
});

test('rejects Git workflow enabled without git available', () => {
  const emptyBin = path.join(root, 'empty-bin');
  fs.mkdirSync(emptyBin, { recursive: true });
  const originalPath = process.env.PATH;
  process.env.PATH = emptyBin;
  try {
    assert.match(requireProductionSafeConfig(validEnv({ GIT_WORKFLOW_ENABLED: 'true' }), dirs()).errors.join(), /git binary/);
  } finally {
    process.env.PATH = originalPath;
  }
});

test('the database directory check also applies outside production (dev/test still needs a writable data dir)', () => {
  const blocked = unwritablePath('locked-nonprod');
  const result = requireProductionSafeConfig({ NODE_ENV: 'development' }, dirs({ dbDir: blocked }));
  assert.equal(result.ok, false);
});
