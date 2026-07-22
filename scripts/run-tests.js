import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runContainedProcess } from './test-process-supervisor.js';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const trustedRunner = path.join(rootDirectory, 'scripts/trusted-test-runner.js');
const namespaceInit = path.join(rootDirectory, 'scripts/test-namespace-init.sh');
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
const runningAsRoot = process.getuid?.() === 0;
const command = runningAsRoot ? '/usr/bin/unshare' : '/usr/bin/sudo';
const commandArguments = runningAsRoot
  ? [...namespaceArguments, '/usr/bin/bash', namespaceInit, process.execPath, trustedRunner]
  : [
      '--non-interactive', '/usr/bin/unshare', ...namespaceArguments,
      '/usr/bin/setpriv', `--reuid=${process.getuid()}`, `--regid=${process.getgid()}`, '--clear-groups',
      '/usr/bin/env', ...Object.entries(environment).map(([name, value]) => `${name}=${value}`),
      '/usr/bin/bash', namespaceInit, process.execPath, trustedRunner,
    ];
const result = await runContainedProcess(command, commandArguments, {
  cwd: rootDirectory,
  env: runningAsRoot ? environment : { PATH: process.env.PATH ?? '/usr/bin:/bin' },
  forwardParentSignals: true,
});

if (result.spawnError) console.error(`Trusted test runner spawn failed: ${result.spawnError.message}`);
if (!result.outputDrained) console.error('Trusted test runner failed to drain stdout and stderr to EOF');
if (!result.processGroupTerminated || result.remainingDescendants !== 0) {
  console.error(`Trusted test runner cleanup failed: groupTerminated=${result.processGroupTerminated} remainingDescendants=${result.remainingDescendants}`);
}
if (result.interruptedSignal) console.error(`Trusted test runner remained interrupted by ${result.interruptedSignal}`);

console.log([
  'Trusted process containment:',
  `childCode=${String(result.childCode)}`,
  `childSignal=${String(result.childSignal)}`,
  `interrupted=${String(result.interruptedSignal)}`,
  `outputDrained=${result.outputDrained}`,
  `processGroupTerminated=${result.processGroupTerminated}`,
  `remainingDescendants=${result.remainingDescendants}`,
  `forced=${result.forced}`,
].join(' '));

process.exitCode = result.code ?? 1;
