import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';

const port = '8792';
const dbPath = '.blackspire-command/smoke.sqlite';
const migration = spawnSync(process.execPath, ['scripts/migrate.js'], { env: { ...process.env, BLACKSPIRE_DB_PATH: dbPath, BLACKSPIRE_RUN_MIGRATIONS: 'true' }, encoding: 'utf8' });
assert.equal(migration.status, 0, migration.stderr);
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
