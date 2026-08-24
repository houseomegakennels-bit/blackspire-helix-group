#!/usr/bin/env node
import { runContainedProcess } from './test-process-supervisor.js';

const argv = process.argv.slice(2);
const requireAuthenticatedDoctor = argv[0] === '--require-authenticated-doctor';
const args = requireAuthenticatedDoctor ? argv.slice(1) : argv;
if (args.length === 0) process.exit(2);
let stdoutBytes = 0;
let stderrBytes = 0;
const limit = 64 * 1024;
let overflow = false;
const stdoutChunks = [];
const bounded = (stream) => (chunk) => {
  const bytes = Buffer.byteLength(chunk);
  if (stream === 'stdout') {
    stdoutBytes += bytes;
    if (stdoutBytes <= limit) stdoutChunks.push(Buffer.from(chunk));
  }
  else stderrBytes += bytes;
  if (stdoutBytes > limit || stderrBytes > limit) overflow = true;
};
const result = await runContainedProcess(args[0], args.slice(1), {
  env: process.env,
  executionTimeoutMs: 2_000,
  gracefulShutdownMs: 1_000,
  forceShutdownMs: 2_000,
  onStdout: bounded('stdout'),
  onStderr: bounded('stderr'),
});
const contained = !overflow
  && result.processGroupTerminated
  && result.remainingDescendants === 0
  && result.outputDrained
  && !result.timedOut
  && !result.cleanupRequired
  && !result.forced
  && result.interruptedSignal === null
  && result.spawnError === null;
let authenticatedDoctor = false;
if (contained && requireAuthenticatedDoctor) {
  try {
    const report = JSON.parse(Buffer.concat(stdoutChunks).toString('utf8'));
    const checks = report?.checks;
    authenticatedDoctor = report?.schemaVersion === 1
      && checks?.['auth.credentials']?.status === 'ok'
      && checks?.['network.provider_reachability']?.status === 'ok'
      && checks?.['network.websocket_reachability']?.status === 'ok';
  } catch {
    authenticatedDoctor = false;
  }
}
process.exitCode = contained && (requireAuthenticatedDoctor ? authenticatedDoctor : result.code === 0) ? 0 : 1;
