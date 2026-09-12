import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { validateIntegratedRecoveryReport, RECOVERY_FRONTEND_SOURCE_DIGEST, RECOVERY_FRONTEND_ARCHIVE_DIGEST, INTEGRATED_RECOVERY_LIMITATIONS } from '../packages/zola-rollback/integrated-report.js';
import { RECOVERY_SHA, RECOVERY_ARTIFACT } from '../packages/zola-rollback/intake.js';
import { cases } from '../packages/zola-six-reads/offline.js';

const fixture=()=>({version:1,status:'PASS_FIXED_INTEGRATED_HTTP',recoverySha:RECOVERY_SHA,artifactDigest:RECOVERY_ARTIFACT,
  sourceDigest:RECOVERY_FRONTEND_SOURCE_DIGEST,archiveDigest:RECOVERY_FRONTEND_ARCHIVE_DIGEST,productionAccepted:false,
  observedDatabaseMutationAttempts:0,externalNetwork:'kernel isolated; loopback only',limitations:[...INTEGRATED_RECOVERY_LIMITATIONS],
  boot:{scope:'fixed recovery processes on isolated loopback',generationAuthority:'disposable process supervisor; not systemd',
    limitations:['Test runtime configuration; production launchers and writer dependencies not exercised','No recovery frontend included in sealed backend artifact','No production routing or owner-policy acceptance'],recoverySha:RECOVERY_SHA,productionAccepted:false,apiBoot:'PASS',workerBoot:'PASS',workerRestart:'PASS',readinessLifecycle:'PASS',gracefulProcessExit:'PASS',
    stoppedWorkerReadinessDenied:true,heartbeatGenerationChangeObserved:true,anonymousPostDenials:9,invalidTokenPostDenials:9,
    integrated:{revokedGrantDenied:true,paidUsageRows:0,reads:cases.map((entry,index)=>({capability:entry.id,route:entry.route,status:'PASS_FIXED_PROCESS_HTTP',
      boundedResultCount:1,databaseRequests:1,apiPid:100,workerPid:200,apiGeneration:'a'.repeat(32),workerGeneration:'b'.repeat(32),taskId:`task_${index}`,receiptId:`receipt_${index}`,
      authorityBinding:true,claimReceiptBinding:true,idempotentReplay:true,anonymousDenial:true,wrongCredentialDenial:true,foreignWorkspaceDenial:true}))}}});
test('integrated report binds the sole fixed source/artifact and six unique process-bound receipts',()=>{
  const report=fixture();assert.deepEqual(validateIntegratedRecoveryReport(report),report);assert.notEqual(validateIntegratedRecoveryReport(report),report);
});
test('integrated report refuses missing evidence, altered pairing, changed processes and production overclaims',()=>{
  for(const mutate of [r=>r.boot.generationAuthority='systemd production verified',r=>r.boot.limitations=[],r=>r.boot.scope='production',r=>r.productionAccepted=true,r=>r.recoverySha='c'.repeat(40),r=>r.artifactDigest='c'.repeat(64),r=>r.sourceDigest='c'.repeat(64),
    r=>r.archiveDigest='c'.repeat(64),r=>r.limitations=[],r=>r.externalNetwork='unknown',r=>r.observedDatabaseMutationAttempts=1,
    r=>r.boot.gracefulProcessExit='UNKNOWN',r=>r.boot.stoppedWorkerReadinessDenied=false,r=>r.boot.integrated.paidUsageRows=1,
    r=>r.boot.integrated.reads.pop(),r=>r.boot.integrated.reads[0].route='/wrong',r=>r.boot.integrated.reads[0].boundedResultCount=0,
    r=>r.boot.integrated.reads[0].claimReceiptBinding=false,r=>r.boot.integrated.reads[0].apiPid=200,
    r=>r.boot.integrated.reads[1].workerGeneration='c'.repeat(32),r=>r.boot.integrated.reads[1].taskId='task_0',
    r=>r.boot.integrated.reads[1].receiptId='receipt_0',r=>r.boot.integrated.reads[0].idempotentReplay=false,
    r=>r.boot.integrated.reads[0].wrongCredentialDenial=false,r=>r.boot.integrated.revokedGrantDenied=false]){
    const report=fixture();mutate(report);assert.throws(()=>validateIntegratedRecoveryReport(report),/REJECTED/);
  }
});
test('integrated child refuses ambient network/credentials before any startup or export',()=>{
  const child=spawnSync(process.execPath,['scripts/zola-recovery-integrated-child.js'],{cwd:process.cwd(),encoding:'utf8',timeout:10000,env:{PATH:'/usr/bin:/bin'}});
  assert.equal(child.status,1);assert.equal(child.stdout,'');assert.match(child.stderr,/Integrated recovery failed/);
});
test('integrated public command refuses arguments instead of accepting a different recovery or origin',()=>{
  const child=spawnSync(process.execPath,['scripts/zola-recovery-integrated.js','--production'],{cwd:process.cwd(),encoding:'utf8',timeout:10000,env:{PATH:'/usr/bin:/bin'}});
  assert.equal(child.status,1);assert.equal(child.stdout,'');assert.match(child.stderr,/FAIL/);
});
