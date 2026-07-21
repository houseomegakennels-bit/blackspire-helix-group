import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { prepareDisposableDatabase } from './helpers/prepare-disposable-database.js';

const port = '8792';
const dbPath = '.blackspire-command/smoke.sqlite';
prepareDisposableDatabase(dbPath);
const child = spawn(process.execPath, ['apps/api/server.js'], {
  env: { ...process.env, PORT: port, COMMAND_ADMIN_TOKEN: 'smoke', BLACKSPIRE_DB_PATH: dbPath },
  stdio: 'ignore',
});

try {
  let health;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      health = await fetch(`http://127.0.0.1:${port}/health`);
      if (health.status === 200) break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.equal(health?.status, 200);
  console.log('End-to-end local smoke test passed.');
} finally {
  child.kill('SIGTERM');
}
