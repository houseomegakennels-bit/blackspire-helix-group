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

const { requireProductionSafeConfig, verifyVpsRuntime } = await import('../packages/shared/security.js');
const { hashAdminPassword } = await import('../packages/shared/password-auth.js');
const VALID_PASSWORD_HASH = hashAdminPassword('thirteen-char');

function validEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    BLACKSPIRE_OPERATOR_PRINCIPAL_ID: 'production-operator',
    COMMAND_ADMIN_TOKEN: 'a'.repeat(32),
    COMMAND_ADMIN_PASSWORD_HASH: VALID_PASSWORD_HASH,
    ALLOW_BEARER_AUTH: 'false',
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

test('application startup accepts only the coherent enabled Codex profile', () => {
  const enabled = validEnv({
    BLACKSPIRE_RUNTIME_MODE: 'production',
    BLACKSPIRE_PRODUCTION_EXECUTION: 'enabled',
    BLACKSPIRE_PROVIDER_MODE: 'codex',
    BLACKSPIRE_HERMES_MODE: 'production',
    BLACKSPIRE_PRODUCTION_PROVIDERS: 'codex',
    TELEGRAM_MODE: 'dry-run',
  });
  assert.equal(requireProductionSafeConfig(enabled, dirs()).ok, true);
  for (const overrides of [
    { BLACKSPIRE_PROVIDER_MODE: 'manual' },
    { BLACKSPIRE_HERMES_MODE: 'restricted' },
    { BLACKSPIRE_PRODUCTION_PROVIDERS: '' },
    { BLACKSPIRE_PRODUCTION_EXECUTION: 'enabledd', BLACKSPIRE_PROVIDER_MODE: 'manual', BLACKSPIRE_HERMES_MODE: 'restricted', BLACKSPIRE_PRODUCTION_PROVIDERS: '' },
    { BLACKSPIRE_PRODUCTION_PROVIDERS: 'codex,mock' },
    { BLACKSPIRE_PRODUCTION_PROVIDERS: 'codex,' },
    { BLACKSPIRE_PRODUCTION_PROVIDERS: 'codex,unknown' },
  ]) assert.equal(requireProductionSafeConfig({ ...enabled, ...overrides }, dirs()).ok, false);
});

test('bearer token is optional when bearer authentication is disabled', () => {
  assert.equal(requireProductionSafeConfig(validEnv({ COMMAND_ADMIN_TOKEN: '' }), dirs()).ok, true);
});

test('rejects a missing or malformed canonical operator principal', () => {
  assert.match(requireProductionSafeConfig(validEnv({ BLACKSPIRE_OPERATOR_PRINCIPAL_ID: '' }), dirs()).errors.join(), /BLACKSPIRE_OPERATOR_PRINCIPAL_ID/);
  assert.match(requireProductionSafeConfig(validEnv({ BLACKSPIRE_OPERATOR_PRINCIPAL_ID: '../operator' }), dirs()).errors.join(), /BLACKSPIRE_OPERATOR_PRINCIPAL_ID/);
});

test('rejects a weak (short) admin token', () => {
  assert.match(requireProductionSafeConfig(validEnv({ ALLOW_BEARER_AUTH: 'true', COMMAND_ADMIN_TOKEN: 'short' }), dirs()).errors.join(), /COMMAND_ADMIN_TOKEN/);
});

test('production requires a supported password hash', () => {
  for (const value of ['', 'v2$scrypt$bad', 'v1$scrypt$1$1$1$bad$bad$p13-128']) assert.match(requireProductionSafeConfig(validEnv({ COMMAND_ADMIN_PASSWORD_HASH: value }), dirs()).errors.join(), /COMMAND_ADMIN_PASSWORD_HASH/);
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

test('same-origin API does not treat legacy CORS_ORIGIN as an authorization control', () => {
  assert.equal(requireProductionSafeConfig(validEnv({ CORS_ORIGIN: '*' }), dirs()).ok, true);
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

test('API and supervisor accept only explicitly paired private Telegram', () => {
  const env = validEnv({
    BLACKSPIRE_RUNTIME_MODE: 'production', BLACKSPIRE_STATE_OWNER: 'vps-production',
    BLACKSPIRE_RUNTIME_USER: 'blackspire', BLACKSPIRE_PROVIDER_MODE: 'manual',
    BIND_HOST: '127.0.0.1', PORT: '8799',
    BLACKSPIRE_STARTUP_TIMEOUT_SECONDS: '30', BLACKSPIRE_HEALTH_TIMEOUT_SECONDS: '5',
    BLACKSPIRE_TELEGRAM_ENABLED: 'enabled', TELEGRAM_MODE: 'webhook',
    TELEGRAM_BOT_TOKEN: '12345:' + 't'.repeat(35), TELEGRAM_WEBHOOK_SECRET: 's'.repeat(40),
    TELEGRAM_PRIVATE_CHAT_ID: '123456789', TELEGRAM_ALLOWED_USERS: '123456789',
  });
  const opts = { uid: 1001, username: 'blackspire', nodeVersion: '22.23.1',
    isWritable: () => true, dirOwnerUid: () => 1001, dirExists: () => true };
  const validators = [
    value => requireProductionSafeConfig(value, dirs()),
    value => verifyVpsRuntime(value, opts),
  ];
  for (const validate of validators) {
    assert.deepEqual(validate(env).errors, []);
    for (const overrides of [
      { BLACKSPIRE_TELEGRAM_ENABLED: undefined }, { BLACKSPIRE_TELEGRAM_ENABLED: 'true' },
      { TELEGRAM_MODE: 'polling' }, { TELEGRAM_BOT_TOKEN: '' },
      { TELEGRAM_WEBHOOK_SECRET: 'short' }, { TELEGRAM_PRIVATE_CHAT_ID: '-123456789' },
      { TELEGRAM_ALLOWED_USERS: '123456789,987654321' }, { TELEGRAM_ALLOWED_USERS: '987654321' },
      { OPENAI_API_KEY: 'provider-secret' },
    ]) assert.equal(validate({ ...env, ...overrides }).ok, false);
  }
});
