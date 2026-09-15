#!/usr/bin/env node
// Operator-host isolated proof; fixed sealed recovery only. No production mode.
import { supervise } from '../packages/zola-six-reads/supervise.js';
try {
  if (process.argv.length !== 2) throw new Error('arguments refused');
  const result = JSON.parse(await supervise([new URL('./zola-rollback-rehearsal-child.js', import.meta.url).pathname], { isolatedNetwork: true }));
  if (result.scope !== 'isolated recovery admission and dispatch' || result.productionAccepted !== false || result.reads.length !== 6) throw new Error('invalid report');
  if (result.boot?.recoverySha !== result.recoverySha || result.boot.productionAccepted !== false ||
      ['apiBoot', 'workerBoot', 'workerRestart', 'readinessLifecycle', 'gracefulProcessExit'].some(key => result.boot[key] !== 'PASS') ||
      result.boot.stoppedWorkerReadinessDenied !== true || result.boot.heartbeatGenerationChangeObserved !== true ||
      result.boot.anonymousPostDenials !== 9 || result.boot.invalidTokenPostDenials !== 9) throw new Error('invalid boot report');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch { process.stderr.write('FAIL: isolated rollback rehearsal\n'); process.exitCode = 1; }
