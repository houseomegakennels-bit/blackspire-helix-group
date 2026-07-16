import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-prodstartup-'));

function runApi(env) {
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

test('production startup boots normally with a valid configuration', async () => {
  const dbPath = path.join(root, 'safe', 'command.sqlite');
  const attachmentsDir = path.join(root, 'safe-attachments');
  const result = await runApi({
    NODE_ENV: 'production',
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
