import { spawn } from 'node:child_process';

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
