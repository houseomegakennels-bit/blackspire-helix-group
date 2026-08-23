#!/usr/bin/env node
import { runContainedProcess } from './test-process-supervisor.js';

const args = process.argv.slice(2);
if (args.length === 0) process.exit(2);
let stdoutBytes = 0;
let stderrBytes = 0;
const limit = 64 * 1024;
let overflow = false;
const bounded = (stream) => (chunk) => {
  const bytes = Buffer.byteLength(chunk);
  if (stream === 'stdout') stdoutBytes += bytes;
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
process.exitCode = !overflow && result.code === 0 && result.processGroupTerminated && result.remainingDescendants === 0 ? 0 : 1;
