import { spawn } from 'node:child_process';
import { verifyVpsRuntime } from '../packages/shared/security.js';
import { resolveBindTarget, probePortAvailable } from '../packages/shared/bind.js';
import {
  createDeploymentIdentityProvider,
  validateDeploymentIdentityForStartup,
} from '../packages/shared/deployment-identity.js';

function fatal(reason, errors) {
  process.stderr.write(`fatal: ${reason}:\n${errors.map((e) => `  - ${e}`).join('\n')}\n`);
  process.exit(1);
}

const roleArgument = process.argv.length === 3 ? process.argv[2] : '';
const role = roleArgument === '--api-only' ? 'api' : roleArgument === '--worker-only' ? 'worker' : null;
if (!role) fatal('production service role verification failed', ['expected exactly --api-only or --worker-only']);

// Fail closed before spawning any child if the runtime is unsafe. Messages are sanitized (no env values).
const runtime = verifyVpsRuntime();
if (!runtime.ok) fatal('production runtime verification failed', runtime.errors);

// Resolve the canonical loopback host and explicit port once, then hand the exact values to
// both children so the supervisor and the real listener can never diverge.
const bind = resolveBindTarget();
if (!bind.ok) fatal('production bind verification failed', bind.errors);

// Read-only conflict preflight. An occupied port stops the start; the existing listener on
// that port is never terminated, signalled, or modified.
const availability = role === 'api' ? await probePortAvailable(bind.host, bind.port) : { free: true };
if (!availability.free) {
  fatal('production port conflict', [
    `${bind.host}:${bind.port} is already in use (${availability.code || 'unavailable'}); refusing to start without a fallback port.`,
  ]);
}

// Verify the packaged deployment artifact before starting either long-lived process.
const deploymentIdentity = createDeploymentIdentityProvider().get();
const identityValidation = validateDeploymentIdentityForStartup(deploymentIdentity);
if (!identityValidation.ok) {
  fatal('deployment identity verification failed', [`state ${identityValidation.state}`, `reason ${identityValidation.reasonCode}`]);
}

const childEnvironment = { ...process.env, BIND_HOST: bind.host, PORT: String(bind.port) };
const entrypoint = role === 'api' ? 'apps/api/server.js' : 'apps/worker/worker.js';
const children = [spawn(process.execPath, [entrypoint], { stdio: 'inherit', env: childEnvironment })];
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
