import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import net from 'node:net';

import { runContainedProcess } from '../scripts/test-process-supervisor.js';

// These prove the final review blocker is closed: the trusted runner is bounded, a hung run fails
// closed nonzero, its diagnostic appears exactly once, and the whole descendant tree is reaped.
// They live in their own file so tests/trust-boundary-regression.test.js stays byte-identical to
// origin/main (its inode/timestamp flake is a separate follow-up). Every path is disposable and
// every port is kernel-assigned; ports 8787 and 8788 are never used.

const node = process.execPath;

const BUDGET_DIAGNOSTIC = 'execution budget';

// The timeout diagnostic is emitted by the supervisor itself via console.error, not through the
// child's stderr, so it is captured here rather than via onStderr.
async function captureConsoleError(fn) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => { lines.push(args.join(' ')); };
  try {
    const value = await fn();
    return { value, lines };
  } finally {
    console.error = original;
  }
}

test('a normal child completes successfully within the execution budget', async () => {
  const { value: result, lines } = await captureConsoleError(() => runContainedProcess(node, ['-e', "process.stdout.write('done\\n')"], {
    onStdout() {}, onStderr() {},
    executionTimeoutMs: 10_000,
  }));
  assert.equal(result.timedOut, false, 'a fast child must not be reported as timed out');
  assert.equal(result.code, 0, 'a normal child must succeed');
  assert.equal(result.processGroupTerminated, true);
  assert.equal(result.remainingDescendants, 0);
  assert.equal(lines.filter((line) => line.includes(BUDGET_DIAGNOSTIC)).length, 0, 'no timeout diagnostic may be emitted for a normal child');
});

test('a hanging child is terminated after the configured timeout with a nonzero result', async () => {
  const started = Date.now();
  const { value: result, lines } = await captureConsoleError(() => runContainedProcess(node, ['-e', 'setInterval(()=>{},1000)'], {
    onStdout() {}, onStderr() {},
    executionTimeoutMs: 300, gracefulShutdownMs: 100, forceShutdownMs: 2000,
  }));
  const elapsed = Date.now() - started;
  assert.equal(result.timedOut, true, 'the hang must be reported as a timeout');
  assert.notEqual(result.code, 0, 'a timed-out run must be nonzero');
  assert.ok(elapsed < 8000, `the timeout must fire promptly, took ${elapsed}ms`);
  assert.equal(result.processGroupTerminated, true, 'the timed-out child must be terminated');
  assert.equal(result.remainingDescendants, 0, 'no descendant may survive the timeout');
  assert.equal(lines.filter((line) => line.includes(BUDGET_DIAGNOSTIC)).length, 1, 'the timeout diagnostic must appear exactly once');
});

test('a hanging child that spawned descendants has the whole tree reaped', async () => {
  // A detached grandchild in its own right, plus a normal child of the child: both must be gone.
  const script = [
    "const {spawn}=require('node:child_process');",
    "spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'}).unref();",
    "spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});",
    'setInterval(()=>{},1000);',
  ].join('');
  const { value: result, lines } = await captureConsoleError(() => runContainedProcess(node, ['-e', script], {
    onStdout() {}, onStderr() {},
    executionTimeoutMs: 500, gracefulShutdownMs: 100, forceShutdownMs: 3000,
  }));
  assert.equal(result.timedOut, true);
  assert.notEqual(result.code, 0);
  assert.equal(result.processGroupTerminated, true);
  assert.equal(result.remainingDescendants, 0, 'the complete descendant tree must be reaped on timeout');
  assert.equal(lines.filter((line) => line.includes(BUDGET_DIAGNOSTIC)).length, 1);
});

test('misleading success output cannot make a timed-out run appear successful', async () => {
  // The child emits a passing-looking terminal line up front, then hangs unconditionally so the
  // timeout is the only way the run can end - no race between a self-exit and the timer. A timeout
  // is always a failure, so partial or forged output can never present a passing status.
  const script = "process.stdout.write('# trusted result: passed\\n');setInterval(()=>{},1000);";
  let stdout = '';
  const result = await runContainedProcess(node, ['-e', script], {
    onStdout: (chunk) => { stdout += chunk; }, onStderr() {},
    executionTimeoutMs: 300, gracefulShutdownMs: 100, forceShutdownMs: 2000,
  });
  assert.match(stdout, /trusted result: passed/, 'the child really did emit a success-looking line');
  assert.equal(result.timedOut, true);
  assert.notEqual(result.code, 0, 'a timed-out run can never present a passing status');
});

test('a timeout forces a nonzero result even when the child exited zero during teardown', async () => {
  // Unit-level proof of the invariant behind the previous test, with no timing race: a child that
  // exits 0 on SIGTERM must still yield a nonzero code once timedOut is set. The child installs a
  // SIGTERM handler that exits 0, so the timeout's graceful signal produces a zero child exit that
  // the supervisor must override.
  const script = "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000);";
  const result = await runContainedProcess(node, ['-e', script], {
    onStdout() {}, onStderr() {},
    executionTimeoutMs: 300, gracefulShutdownMs: 2000, forceShutdownMs: 4000,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.childCode, 0, 'the child exited zero on the timeout signal');
  assert.notEqual(result.code, 0, 'a zero child exit during a timeout must still be reported as failure');
});

test('the execution timeout leaves no process, listener, or port behind', async (t) => {
  // A disposable listener the timed-out child holds; after cleanup the port must be free again,
  // proving nothing from the run leaked into whatever runs next.
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen({ host: '127.0.0.1', port: 0, exclusive: true }, resolve));
  const { port } = probe.address();
  assert.equal([8787, 8788].includes(port), false, 'the disposable port must never be a protected port');
  await new Promise((resolve) => probe.close(resolve));

  const script = `const net=require('node:net');const s=net.createServer();s.listen(${port},'127.0.0.1',()=>{});setInterval(()=>{},1000);`;
  const result = await runContainedProcess(node, ['-e', script], {
    onStdout() {}, onStderr() {},
    executionTimeoutMs: 400, gracefulShutdownMs: 100, forceShutdownMs: 3000,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.remainingDescendants, 0);
  assert.equal(result.processGroupTerminated, true);

  // The port the child bound must be reclaimable, i.e. no leaked listener still holds it.
  const reclaim = net.createServer();
  await new Promise((resolve, reject) => {
    reclaim.once('error', reject);
    reclaim.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
  });
  t.after(() => new Promise((resolve) => reclaim.close(resolve)));
  assert.equal(reclaim.address().port, port, 'the disposable port must be free after the timeout cleanup');
});
