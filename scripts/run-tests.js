import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runContainedProcess } from './test-process-supervisor.js';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const trustedRunner = path.join(rootDirectory, 'scripts/trusted-test-runner.js');
const namespaceInit = path.join(rootDirectory, 'scripts/test-namespace-init.sh');
const namespaceArguments = process.getuid?.() === 0
  ? ['--pid', '--fork', '--kill-child=SIGKILL', '--mount-proc']
  : ['--user', '--map-root-user', '--pid', '--fork', '--kill-child=SIGKILL', '--mount-proc'];
const environment = { ...process.env };
delete environment.BLACKSPIRE_RUN_MIGRATIONS;
delete environment.BLACKSPIRE_TEST_MANIFEST_PATH;
delete environment.BLACKSPIRE_TEST_REPORT_PATH;
delete environment.BLACKSPIRE_TEST_RUN_ID;

if (process.platform !== 'linux') throw new Error('trusted test containment requires Linux PID namespaces');
const result = await runContainedProcess('/usr/bin/unshare', [
  ...namespaceArguments,
  '/usr/bin/bash', namespaceInit, process.execPath, trustedRunner,
], {
  cwd: rootDirectory,
  env: environment,
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
