import { spawn } from 'node:child_process';
import { verifyVpsRuntime } from '../packages/shared/security.js';

// Fail closed before spawning any child if the runtime is unsafe. Messages are sanitized (no env values).
const runtime = verifyVpsRuntime();
if (!runtime.ok) {
  process.stderr.write(`fatal: production runtime verification failed:\n${runtime.errors.map((e) => `  - ${e}`).join('\n')}\n`);
  process.exit(1);
}

const children = [
  spawn(process.execPath, ['apps/api/server.js'], { stdio: 'inherit' }),
  spawn(process.execPath, ['apps/worker/worker.js'], { stdio: 'inherit' }),
];
let stopping = false;
function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill(signal);
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
for (const child of children) child.on('exit', (code, signal) => {
  if (!stopping) { stop('SIGTERM'); process.exitCode = code ?? 1; }
  if (children.every((entry) => entry.exitCode !== null || entry.signalCode)) process.exit(process.exitCode || 0);
});
