import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rehearseRecoveryBoot } from '../packages/zola-rollback/boot.js';
import { RECOVERY_SHA } from '../packages/zola-rollback/intake.js';
import { supervise } from '../packages/zola-six-reads/supervise.js';

test('actual recovery boot refuses execution in the ambient network namespace', async () => {
  const previous = process.env.ZOLA_CANDIDATE_PARENT_NET;
  process.env.ZOLA_CANDIDATE_PARENT_NET = fs.readlinkSync('/proc/self/ns/net');
  try { await assert.rejects(rehearseRecoveryBoot({ artifact: '/not-accessed', root: '/not-accessed' })); }
  finally {
    if (previous === undefined) delete process.env.ZOLA_CANDIDATE_PARENT_NET;
    else process.env.ZOLA_CANDIDATE_PARENT_NET = previous;
  }
});

const available = process.getuid() === 0 && fs.existsSync(`/var/lib/blackspire-zola-rehearsal/releases/${RECOVERY_SHA}/COMMIT_SHA`);
test('fixed sealed recovery boots actual API and restarted workers in a private network namespace', { skip: !available, timeout: 20_000 }, async () => {
  const report = JSON.parse(await supervise([new URL('../scripts/zola-rollback-rehearsal-child.js', import.meta.url).pathname], { isolatedNetwork: true }));
  assert.equal(report.recoverySha, RECOVERY_SHA);
  assert.equal(report.productionAccepted, false);
  assert.equal(report.boot.productionAccepted, false);
  for (const key of ['apiBoot', 'workerBoot', 'workerRestart', 'readinessLifecycle', 'gracefulProcessExit']) assert.equal(report.boot[key], 'PASS');
  assert.equal(report.boot.generationAuthority, 'disposable process supervisor; not systemd');
  assert.equal(report.boot.stoppedWorkerReadinessDenied, true);
  assert.equal(report.boot.heartbeatGenerationChangeObserved, true);
  assert.equal(report.boot.anonymousPostDenials, 9);
  assert.equal(report.boot.invalidTokenPostDenials, 9);
  assert.equal(report.reads.length, 6);
  assert.equal(report.paidProviderCalls, 0);
});
