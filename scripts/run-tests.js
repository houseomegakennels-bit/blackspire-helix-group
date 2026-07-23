import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { runContainedProcess } from './test-process-supervisor.js';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const namespaceArguments = ['--pid', '--fork', '--kill-child=SIGKILL', '--mount-proc'];
const environment = Object.fromEntries([
  'PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TMP', 'TEMP',
  'LANG', 'LANGUAGE', 'LC_ALL', 'TZ', 'CI', 'GITHUB_ACTIONS', 'RUNNER_TEMP',
].flatMap((name) => process.env[name] === undefined ? [] : [[name, process.env[name]]]));
Object.assign(environment, {
  NODE_ENV: 'test',
  SESSION_SECRET: 'blackspire-test-runner-session-secret-not-real-000000',
  TELEGRAM_ALLOWED_USERS: '1001',
  PORT: '8787',
  TRUST_PROXY: 'false',
  RATE_LIMIT_DISABLED: 'false',
});

if (process.platform !== 'linux') throw new Error('trusted test containment requires Linux PID namespaces');
const ptraceScope = Number.parseInt(fs.readFileSync('/proc/sys/kernel/yama/ptrace_scope', 'utf8').trim(), 10);
if (!Number.isInteger(ptraceScope) || ptraceScope < 1) {
  throw new Error('trusted test containment requires kernel.yama.ptrace_scope >= 1');
}
const runningAsRoot = process.getuid?.() === 0;
const targetUid = runningAsRoot ? 65534 : process.getuid();
const targetGid = runningAsRoot ? 65534 : process.getgid();
const runtimeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-contained-tests-'));
const snapshotDirectory = path.join(runtimeDirectory, 'repository');
try {
  const inventory = spawnSync('/usr/bin/git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: rootDirectory,
    encoding: 'buffer',
  });
  if (inventory.status !== 0) throw new Error(`failed to inventory trusted test snapshot: ${inventory.stderr.toString().trim()}`);
  fs.mkdirSync(snapshotDirectory);
  for (const relative of inventory.stdout.toString('utf8').split('\0').filter(Boolean)) {
    if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
      throw new Error(`snapshot inventory escaped the repository: ${relative}`);
    }
    const source = path.join(rootDirectory, relative);
    const destination = path.join(snapshotDirectory, relative);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const sourceType = fs.lstatSync(source);
    if (sourceType.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(source), destination);
    else if (sourceType.isFile()) fs.copyFileSync(source, destination);
    else throw new Error(`snapshot inventory contains an unsupported entry: ${relative}`);
  }
  const gitSteps = [
    ['init', '--quiet'],
    ['add', '--all'],
    ['-c', 'user.name=Blackspire Test Snapshot', '-c', 'user.email=blackspire-test.invalid',
      'commit', '--quiet', '--no-gpg-sign', '-m', 'immutable test snapshot'],
  ];
  for (const arguments_ of gitSteps) {
    const git = spawnSync('/usr/bin/git', arguments_, { cwd: snapshotDirectory, encoding: 'utf8' });
    if (git.status !== 0) throw new Error(`failed to create trusted test snapshot: ${git.stderr.trim()}`);
  }
  if (runningAsRoot) {
    const ownership = spawnSync('/usr/bin/chown', ['-R', `${targetUid}:${targetGid}`, runtimeDirectory], { encoding: 'utf8' });
    if (ownership.status !== 0) throw new Error(`failed to isolate trusted test snapshot: ${ownership.stderr.trim()}`);
  }
} catch (error) {
  fs.rmSync(runtimeDirectory, { recursive: true, force: true });
  throw error;
}
fs.chmodSync(runtimeDirectory, 0o700);
Object.assign(environment, {
  HOME: runtimeDirectory,
  TMPDIR: runtimeDirectory,
  BLACKSPIRE_TRUSTED_TEST_CONTEXT: '1',
});
const trustedRunner = path.join(snapshotDirectory, 'scripts/trusted-test-runner.js');
const namespaceInit = path.join(snapshotDirectory, 'scripts/test-namespace-init.sh');
const privilegeArguments = [
  `--reuid=${targetUid}`,
  `--regid=${targetGid}`,
  '--clear-groups',
  '--no-new-privs',
  '--bounding-set=-all',
  '--inh-caps=-all',
  '--ambient-caps=-all',
];
const command = runningAsRoot ? '/usr/bin/unshare' : '/usr/bin/sudo';
const commandArguments = runningAsRoot
  ? [
      ...namespaceArguments,
      '/usr/bin/setpriv', ...privilegeArguments,
      '/usr/bin/env', ...Object.entries(environment).map(([name, value]) => `${name}=${value}`),
      '/usr/bin/bash', namespaceInit, process.execPath, trustedRunner,
    ]
  : [
      '--non-interactive', '/usr/bin/unshare', ...namespaceArguments,
      '/usr/bin/setpriv', ...privilegeArguments,
      '/usr/bin/env', ...Object.entries(environment).map(([name, value]) => `${name}=${value}`),
      '/usr/bin/bash', namespaceInit, process.execPath, trustedRunner,
    ];
let result;
try {
  result = await runContainedProcess(command, commandArguments, {
    cwd: snapshotDirectory,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
    forwardParentSignals: true,
    // Outer bound around the whole contained run, larger than the runner's per-test budget so the
    // inner timeout fails the individual test first and this only fires if the runner itself cannot
    // make progress. A constant, never an environment variable, so no CI caller can relax it.
    executionTimeoutMs: 600_000,
  });
} finally {
  fs.rmSync(runtimeDirectory, { recursive: true, force: true });
}

if (result.spawnError) console.error(`Trusted test runner spawn failed: ${result.spawnError.message}`);
if (!result.outputDrained) console.error('Trusted test runner failed to drain stdout and stderr to EOF');
if (!result.processGroupTerminated || result.remainingDescendants !== 0) {
  console.error(`Trusted test runner cleanup failed: groupTerminated=${result.processGroupTerminated} remainingDescendants=${result.remainingDescendants}`);
}
if (result.interruptedSignal) console.error(`Trusted test runner remained interrupted by ${result.interruptedSignal}`);
if (result.timedOut) console.error('Trusted test runner exceeded its execution budget and was terminated');

console.log([
  'Trusted process containment:',
  `childCode=${String(result.childCode)}`,
  `childSignal=${String(result.childSignal)}`,
  `interrupted=${String(result.interruptedSignal)}`,
  `timedOut=${result.timedOut}`,
  `outputDrained=${result.outputDrained}`,
  `processGroupTerminated=${result.processGroupTerminated}`,
  `remainingDescendants=${result.remainingDescendants}`,
  `forced=${result.forced}`,
].join(' '));

process.exitCode = result.code ?? 1;
