import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const child = spawn('node', ['apps/api/server.js'], { env: { ...process.env, PORT: '8792', COMMAND_ADMIN_TOKEN: 'smoke', BLACKSPIRE_DB_PATH: '.blackspire-command/smoke.sqlite' }, stdio: ['ignore', 'pipe', 'pipe'] });
let lastError;
let health;
for (let i = 0; i < 30; i += 1) {
  if (child.exitCode !== null) break;
  try {
    health = await fetch('http://localhost:8792/health');
    break;
  } catch (error) {
    lastError = error;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
assert.equal(health?.status, 200, `API did not become healthy: ${lastError?.message || 'child exited'}`);
child.kill('SIGTERM');
console.log('End-to-end local smoke test passed.');
