import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { prepareDisposableDatabase } from './helpers/prepare-disposable-database.js';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-prodstartup-'));

function runApi(env) {
  prepareDisposableDatabase(env.BLACKSPIRE_DB_PATH);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['apps/api/server.js'], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(async () => {
      // Still running after the grace period: treat as "booted", stop it and report no exit.
      child.kill('SIGTERM');
      resolve({ exited: false, code: null, stderr });
    }, 1500);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ exited: true, code, stderr });
    });
  });
}

test('production startup refuses to boot with an unsafe configuration', async () => {
  const result = await runApi({
    NODE_ENV: 'production',
    BLACKSPIRE_DB_PATH: path.join(root, 'unsafe', 'command.sqlite'),
    PORT: '8899',
    COMMAND_ADMIN_TOKEN: 'dev-admin-token-change-me',
    SESSION_SECRET: 'too-short',
    PUBLIC_BASE_URL: 'http://insecure.example.com',
  });
  assert.equal(result.exited, true, 'API must exit instead of serving traffic with an unsafe production config');
  assert.equal(result.code, 1);
  assert.match(result.stderr, /fatal/);
  assert.match(result.stderr, /COMMAND_ADMIN_TOKEN/);
});

test('startup refuses to boot when a required deployment identity is unverified', async () => {
  // The identity clause in the startup refusal had no executable coverage: deleting it from
  // apps/api/server.js left the whole suite green, even though refusing to serve traffic on an
  // unverified deployment identity is this change's central enforcement. Boot a real child under
  // an owner for which identity is REQUIRED, from a cwd carrying no COMMIT_SHA manifest, and
  // assert it exits fail-closed naming the reason. Everything else in this fixture is valid, so
  // the refusal cannot be attributed to an unrelated unsafe-config error.
  const result = await runApi({
    NODE_ENV: 'production',
    BLACKSPIRE_OPERATOR_PRINCIPAL_ID: 'startup-operator',
    BLACKSPIRE_STATE_OWNER: 'vps-staging',
    BLACKSPIRE_DB_PATH: path.join(root, 'identity', 'command.sqlite'),
    TELEGRAM_TMP_DIR: path.join(root, 'identity-attachments'),
    PORT: '8901',
    COMMAND_ADMIN_TOKEN: 'a'.repeat(32),
    SESSION_SECRET: 'b'.repeat(40),
    SECURE_COOKIES: 'true',
    PUBLIC_BASE_URL: 'https://command.example.com',
    TELEGRAM_MODE: 'dry-run',
    DEBUG: 'false',
    CORS_ORIGIN: 'https://command.example.com',
    RATE_LIMIT_DISABLED: 'false',
    TRUST_PROXY: 'false',
  });
  assert.equal(result.exited, true, `the API must refuse to serve traffic on an unverified deployment identity: ${result.stderr}`);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /deploymentIdentityReasonCode/, `the refusal must name the deployment identity: ${result.stderr}`);
  assert.match(result.stderr, /commit_manifest_missing/, `the operator must receive the machine-readable reason code: ${result.stderr}`);
  assert.match(result.stderr, /"errors":\[\]/, `the config itself must be valid, so the refusal is attributable to identity alone: ${result.stderr}`);
  assert.doesNotMatch(result.stderr, /COMMAND_ADMIN_TOKEN|SESSION_SECRET/, `the refusal must be the identity gate, not an unrelated config error: ${result.stderr}`);
});

test('production startup boots normally with a valid configuration', async () => {
  const dbPath = path.join(root, 'safe', 'command.sqlite');
  const attachmentsDir = path.join(root, 'safe-attachments');
  const result = await runApi({
    NODE_ENV: 'production',
    BLACKSPIRE_OPERATOR_PRINCIPAL_ID: 'startup-operator',
    BLACKSPIRE_DB_PATH: dbPath,
    TELEGRAM_TMP_DIR: attachmentsDir,
    PORT: '8900',
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
  });
  assert.equal(result.exited, false, 'API must stay up and serve traffic with a valid production config');
});
