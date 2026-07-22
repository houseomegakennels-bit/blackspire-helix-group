import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';

import {
  captureTestTree,
  createLifecycleTracker,
  validateLifecycleResult,
  verifyTestTreeUnchanged,
} from '../scripts/test-inventory.js';
import { runContainedProcess } from '../scripts/test-process-supervisor.js';

const node = process.execPath;

function fixtureTree(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-test-identity-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const tests = path.join(root, 'tests');
  fs.mkdirSync(tests);
  fs.writeFileSync(path.join(tests, 'a.test.js'), 'export default 1;\n');
  return { root, tests };
}

test('immutable test identity detects content mutation and pathname replacement', (t) => {
  const { root, tests } = fixtureTree(t);
  const snapshot = captureTestTree(root, tests);
  const file = path.join(tests, 'a.test.js');

  fs.writeFileSync(file, 'export default 2;\n');
  assert.throws(() => verifyTestTreeUnchanged(snapshot), /changed|mutated|identity/i);

  fs.writeFileSync(file, 'export default 1;\n');
  const restored = captureTestTree(root, tests);
  fs.unlinkSync(file);
  fs.writeFileSync(file, 'export default 1;\n');
  assert.throws(() => verifyTestTreeUnchanged(restored), /changed|replaced|identity/i);
});

test('immutable test identity rejects symlink and hard-link aliases', (t) => {
  const { root, tests } = fixtureTree(t);
  const original = path.join(tests, 'a.test.js');
  fs.linkSync(original, path.join(tests, 'alias.test.js'));
  assert.throws(() => captureTestTree(root, tests), /hard.?link|link count|duplicate identity/i);

  fs.unlinkSync(path.join(tests, 'alias.test.js'));
  fs.symlinkSync(original, path.join(tests, 'alias.test.js'));
  assert.throws(() => captureTestTree(root, tests), /symlink/i);
});

test('immutable test identity detects removal, symlink substitution, and test-tree additions', (t) => {
  const { root, tests } = fixtureTree(t);
  const file = path.join(tests, 'a.test.js');
  const snapshot = captureTestTree(root, tests);
  fs.unlinkSync(file);
  assert.throws(() => verifyTestTreeUnchanged(snapshot), /changed|replaced/i);

  fs.writeFileSync(file, 'export default 1;\n');
  const beforeSymlink = captureTestTree(root, tests);
  fs.renameSync(file, `${file}.moved`);
  fs.symlinkSync(`${file}.moved`, file);
  assert.throws(() => verifyTestTreeUnchanged(beforeSymlink), /symlink|changed/i);

  fs.unlinkSync(file);
  fs.renameSync(`${file}.moved`, file);
  const beforeAddition = captureTestTree(root, tests);
  fs.writeFileSync(path.join(tests, 'new.test.js'), 'export default 2;\n');
  assert.throws(() => verifyTestTreeUnchanged(beforeAddition), /changed|mutated/i);
});

test('test workers receive no parent evidence capability or report path', () => {
  assert.equal(process.send, undefined);
  const runner = fs.readFileSync(new URL('../scripts/run-tests.js', import.meta.url), 'utf8');
  const trusted = fs.readFileSync(new URL('../scripts/trusted-test-runner.js', import.meta.url), 'utf8');
  assert.doesNotMatch(`${runner}\n${trusted}`, /terminal\.jsonl|writeTrustedInventoryReport|verify-test-inventory/);
  assert.doesNotMatch(trusted, /process\.argv|process\.env/);
  assert.match(runner, /--pid.*--fork.*--kill-child=SIGKILL.*--mount-proc/s);
  assert.doesNotMatch(runner, /\.\.\.process\.env|BLACKSPIRE_RUN_MIGRATIONS:/);
  assert.match(runner, /--non-interactive.*\/usr\/bin\/unshare.*\/usr\/bin\/setpriv/s);
  assert.match(runner, /--no-new-privs/);
  assert.match(runner, /--bounding-set=-all/);
  assert.match(runner, /--inh-caps=-all/);
  assert.match(runner, /--ambient-caps=-all/);
  assert.match(runner, /ptrace_scope/);

  const parentCommandLine = fs.readFileSync(`/proc/${process.ppid}/cmdline`, 'utf8');
  const parentEnvironment = fs.readFileSync(`/proc/${process.ppid}/environ`, 'utf8');
  assert.doesNotMatch(parentCommandLine, /runId|terminal\.jsonl|blackspire-test-report/);
  assert.doesNotMatch(parentEnvironment, /BLACKSPIRE_TEST_(?:REPORT_PATH|RUN_ID|MANIFEST_PATH)=/);
});

test('trusted workers cannot regain privilege or inspect parent memory', () => {
  if (process.env.BLACKSPIRE_TRUSTED_TEST_CONTEXT !== '1') return;

  assert.notEqual(process.getuid?.(), 0, 'test worker retained root');
  const status = fs.readFileSync('/proc/self/status', 'utf8');
  assert.match(status, /^NoNewPrivs:\s+1$/m);
  for (const field of ['CapInh', 'CapPrm', 'CapEff', 'CapBnd', 'CapAmb']) {
    assert.match(status, new RegExp(`^${field}:\\s+0+$`, 'm'), `${field} retained authority`);
  }
  assert.throws(
    () => fs.openSync(`/proc/${process.ppid}/mem`, 'r'),
    (error) => error?.code === 'EACCES' || error?.code === 'EPERM',
  );
  const sudo = spawnSync('/usr/bin/sudo', ['--non-interactive', '/usr/bin/true'], { encoding: 'utf8' });
  assert.notEqual(sudo.status, 0, 'test worker regained privilege through sudo');
});

test('PID namespace teardown kills an immediate detached descendant with closed output', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-pid-namespace-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const survived = path.join(root, 'survived');
  const script = [
    "const {spawn}=require('node:child_process');",
    `const child=spawn(process.execPath,['-e',${JSON.stringify(`setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(survived)},'escaped'),400);setTimeout(()=>{},10000)`) }],{detached:true,stdio:'ignore'});`,
    'child.unref();',
  ].join('');
  const namespaceArguments = process.getuid?.() === 0
    ? ['--pid', '--fork', '--kill-child=SIGKILL', '--mount-proc']
    : ['--user', '--map-root-user', '--pid', '--fork', '--kill-child=SIGKILL', '--mount-proc'];
  const namespaceInit = new URL('../scripts/test-namespace-init.sh', import.meta.url).pathname;
  const result = spawnSync('/usr/bin/unshare', [
    ...namespaceArguments, '/usr/bin/bash', namespaceInit, node, '-e', script,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  await new Promise((resolve) => setTimeout(resolve, 550));
  assert.equal(fs.existsSync(survived), false, 'detached descendant survived PID namespace teardown');
});

test('lifecycle validation requires real single start and terminal event per scheduled file', () => {
  const scheduled = ['tests/a.test.js', 'tests/b.test.js'];
  const valid = {
    discovered: scheduled,
    scheduled,
    started: scheduled,
    terminal: scheduled.map((file) => ({ file, status: 'passed' })),
  };
  assert.equal(validateLifecycleResult(valid).counts.passed, 2);
  assert.throws(() => validateLifecycleResult({ ...valid, started: [scheduled[0]], terminal: [valid.terminal[0]] }), /missing start/i);
  assert.throws(() => validateLifecycleResult({ ...valid, started: [...scheduled, scheduled[0]] }), /duplicate start/i);
  assert.throws(() => validateLifecycleResult({ ...valid, started: [scheduled[0]], terminal: valid.terminal }), /completion without start/i);
  assert.throws(() => validateLifecycleResult({ ...valid, terminal: [...valid.terminal, valid.terminal[0]] }), /duplicate completion/i);
  assert.throws(() => validateLifecycleResult({ ...valid, terminal: [{ file: scheduled[0], status: 'failed' }, valid.terminal[1]] }), /failed/i);
});

test('lifecycle tracking rejects illegal transitions in arrival order', () => {
  const tracker = createLifecycleTracker(['tests/a.test.js']);
  assert.throws(() => tracker.record('completed', 'tests/a.test.js', 'passed'), /before start/i);
  assert.throws(() => tracker.record('started', 'tests/a.test.js'), /before scheduling/i);

  tracker.record('scheduled', 'tests/a.test.js');
  assert.throws(() => tracker.record('completed', 'tests/a.test.js', 'passed'), /before start/i);
  tracker.record('started', 'tests/a.test.js');
  assert.throws(() => tracker.record('started', 'tests/a.test.js'), /duplicate start/i);
  tracker.record('completed', 'tests/a.test.js', 'passed');
  assert.throws(() => tracker.record('completed', 'tests/a.test.js', 'passed'), /duplicate completion/i);
  assert.equal(validateLifecycleResult(tracker.result()).counts.passed, 1);
});

test('contained process drains inherited output and removes lingering descendants', async () => {
  const script = [
    "const {spawn}=require('node:child_process');",
    "const child=spawn(process.execPath,['-e',\"setTimeout(()=>{process.stdout.write('late-output\\\\n')},80);setTimeout(()=>{},10000)\"],{detached:true,stdio:['ignore','inherit','inherit']});child.unref();",
    "process.stdout.write('# forged terminal JSON\\n');",
  ].join('');
  let stdout = '';
  const result = await runContainedProcess(node, ['-e', script], {
    onStdout: (chunk) => { stdout += chunk; },
    gracefulShutdownMs: 50,
    forceShutdownMs: 1000,
  });

  assert.match(stdout, /forged terminal JSON/);
  assert.equal(result.outputDrained, true);
  assert.equal(result.processGroupTerminated, true);
  assert.equal(result.remainingDescendants, 0);
  assert.notEqual(result.code, 0, 'cleanup of a lingering descendant cannot appear successful');
});

test('contained process preserves direct failure and terminating signal', async () => {
  const failed = await runContainedProcess(node, ['-e', 'process.exit(7)'], {
    onStdout() {}, onStderr() {},
  });
  assert.equal(failed.childCode, 7);
  assert.equal(failed.code, 7);
  assert.equal(failed.processGroupTerminated, true);

  const killed = await runContainedProcess(node, ['-e', "process.kill(process.pid, 'SIGKILL')"], {
    onStdout() {}, onStderr() {},
  });
  assert.equal(killed.childCode, null);
  assert.equal(killed.childSignal, 'SIGKILL');
  assert.equal(killed.code, 137);
});

test('contained process fails closed when the command cannot spawn', async () => {
  const result = await runContainedProcess('/definitely/not/a/command', [], {
    onStdout() {}, onStderr() {}, forceShutdownMs: 100,
  });
  assert.ok(result.spawnError);
  assert.notEqual(result.code, 0);
  assert.equal(result.remainingDescendants, 0);
});

test('contained process waits for real child exit after stdout closes', async () => {
  const result = await runContainedProcess(node, ['-e', "process.stdout.destroy();setTimeout(()=>{},80)"], {
    onStdout() {}, onStderr() {},
  });
  assert.equal(result.childCode, 0);
  assert.equal(result.outputDrained, true);
  assert.equal(result.processGroupTerminated, true);
  assert.equal(result.remainingDescendants, 0);
  assert.equal(result.code, 0);
});

test('contained process force-kills a daemon that ignores graceful cleanup', async () => {
  const script = [
    "const {spawn}=require('node:child_process');",
    "const child=spawn(process.execPath,['-e',\"process.on('SIGTERM',()=>{});setTimeout(()=>{},10000)\"],{detached:true,stdio:'ignore'});",
    'child.unref();setTimeout(()=>process.exit(0),100);',
  ].join('');
  const result = await runContainedProcess(node, ['-e', script], {
    onStdout() {}, onStderr() {}, gracefulShutdownMs: 30, forceShutdownMs: 1000,
  });
  assert.equal(result.cleanupRequired, true);
  assert.equal(result.forced, true);
  assert.equal(result.processGroupTerminated, true);
  assert.equal(result.remainingDescendants, 0);
  assert.notEqual(result.code, 0);
});

test('parent SIGHUP, SIGINT, and SIGTERM remain interrupted after cleanup', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-supervisor-signal-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const harness = path.join(root, 'harness.mjs');
  const supervisor = new URL('../scripts/test-process-supervisor.js', import.meta.url).href;
  fs.writeFileSync(harness, [
    `import { runContainedProcess } from ${JSON.stringify(supervisor)};`,
    "console.log('READY');",
    "const result=await runContainedProcess(process.execPath,['-e',\"process.on('SIGINT',()=>{});process.on('SIGTERM',()=>{});setTimeout(()=>{},10000)\"],{forwardParentSignals:true,gracefulShutdownMs:30,forceShutdownMs:1000});",
    'console.log(JSON.stringify(result));',
    'process.exitCode=result.code;',
  ].join('\n'));

  for (const signal of ['SIGHUP', 'SIGINT', 'SIGTERM']) {
    const child = spawn(node, [harness], { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let signaled = false;
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('READY') && !signaled) {
        signaled = true;
        setTimeout(() => child.kill(signal), 80);
      }
    });
    const status = await new Promise((resolve) => child.once('close', (code, childSignal) => resolve({ code, childSignal })));
    assert.notEqual(status.code, 0);
    const jsonLine = output.trim().split('\n').find((line) => line.startsWith('{'));
    assert.ok(jsonLine, `missing ${signal} containment result`);
    const result = JSON.parse(jsonLine);
    assert.equal(result.interruptedSignal, signal);
    assert.equal(result.processGroupTerminated, true);
    assert.equal(result.remainingDescendants, 0);
    assert.notEqual(result.code, 0);
  }
});
