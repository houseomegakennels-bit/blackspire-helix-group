import { spawn } from 'node:child_process';
import { verifyVpsRuntime } from '../packages/shared/security.js';
import { resolveBindTarget, probePortAvailable } from '../packages/shared/bind.js';

function fatal(reason, errors) {
  process.stderr.write(`fatal: ${reason}:\n${errors.map((e) => `  - ${e}`).join('\n')}\n`);
  process.exit(1);
}

// Fail closed before spawning any child if the runtime is unsafe. Messages are sanitized (no env values).
const runtime = verifyVpsRuntime();
if (!runtime.ok) fatal('production runtime verification failed', runtime.errors);

// Resolve the canonical loopback host and explicit port once, then hand the exact values to
// both children so the supervisor and the real listener can never diverge.
const bind = resolveBindTarget();
if (!bind.ok) fatal('production bind verification failed', bind.errors);

// Read-only conflict preflight. An occupied port stops the start; the existing listener on
// that port is never terminated, signalled, or modified.
const availability = await probePortAvailable(bind.host, bind.port);
if (!availability.free) {
  fatal('production port conflict', [
    `${bind.host}:${bind.port} is already in use (${availability.code || 'unavailable'}); refusing to start without a fallback port.`,
  ]);
}

const childEnvironment = { ...process.env, BIND_HOST: bind.host, PORT: String(bind.port) };
const children = [
  spawn(process.execPath, ['apps/api/server.js'], { stdio: 'inherit', env: childEnvironment }),
  spawn(process.execPath, ['apps/worker/worker.js'], { stdio: 'inherit', env: childEnvironment }),
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
