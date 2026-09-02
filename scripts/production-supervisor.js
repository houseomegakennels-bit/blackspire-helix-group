import { spawn } from 'node:child_process';
import { verifyVpsRuntime } from '../packages/shared/security.js';
import { resolveBindTarget, probePortAvailable } from '../packages/shared/bind.js';
import { childExitStatus } from '../packages/shared/supervisor-exit.js';
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

// The shared EnvironmentFile is role-neutral. Derive identity from supervisor mode so a stale
// or generic profile value cannot cross the API/worker boundary.
const runtimeUser = process.env.BLACKSPIRE_RUNTIME_USER && process.env.BLACKSPIRE_RUNTIME_USER !== 'blackspire'
  ? process.env.BLACKSPIRE_RUNTIME_USER : `blackspire-${role}`;
const effectiveEnvironment = { ...process.env, BLACKSPIRE_RUNTIME_USER: runtimeUser };

// Fail closed before spawning any child if the runtime is unsafe. Messages are sanitized (no env values).
const runtime = verifyVpsRuntime(effectiveEnvironment);
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

const childEnvironment = { ...effectiveEnvironment, BIND_HOST: bind.host, PORT: String(bind.port) };
const entrypoint = role === 'api' ? 'apps/api/server.js' : 'apps/worker/worker.js';
const children = [spawn(process.execPath, [entrypoint], { stdio: 'inherit', env: childEnvironment })];
let stopping = false;
let forwardedSignal = null;
function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true;
  forwardedSignal = signal;
  for (const child of children) child.kill(signal);
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));
for (const child of children) child.on('exit', (code, signal) => {
  process.exitCode = childExitStatus(process.exitCode, { code, signal, stopping, forwardedSignal });
  if (!stopping) stop('SIGTERM');
  if (children.every((entry) => entry.exitCode !== null || entry.signalCode)) process.exit(process.exitCode || 0);
});
