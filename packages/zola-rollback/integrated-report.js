import { RECOVERY_SHA, RECOVERY_ARTIFACT } from './intake.js';
import { cases } from '../zola-six-reads/offline.js';

export const RECOVERY_FRONTEND_SOURCE_DIGEST='6c87b02ac6950018e769a4923e3ab2cf3136fbe66eaba37d3fd671b419a3f425';
export const RECOVERY_FRONTEND_ARCHIVE_DIGEST='a108bfaee741bf9d6149f7d5f71a76b99baee061f1647b3eb5b705ba9872a4bc';
export const INTEGRATED_RECOVERY_LIMITATIONS=Object.freeze([
  'Next development runtime; installed dependency integrity unverified',
  'Synthetic identities and database; no live owner-policy proof',
  'Disposable process supervision; no systemd activation or production generation fence',
  'No historical URL containment or full functional rollback acceptance',
]);
export function validateIntegratedRecoveryReport(report) {
  const reject=()=>{throw new Error('INTEGRATED_RECOVERY_REPORT_REJECTED');};
  if(!report||report.version!==1||report.status!=='PASS_FIXED_INTEGRATED_HTTP'||report.recoverySha!==RECOVERY_SHA||
    report.artifactDigest!==RECOVERY_ARTIFACT||report.sourceDigest!==RECOVERY_FRONTEND_SOURCE_DIGEST||report.archiveDigest!==RECOVERY_FRONTEND_ARCHIVE_DIGEST||
    report.productionAccepted!==false||report.observedDatabaseMutationAttempts!==0||report.externalNetwork!=='kernel isolated; loopback only'||
    JSON.stringify(report.limitations)!==JSON.stringify(INTEGRATED_RECOVERY_LIMITATIONS))reject();
  const boot=report.boot;
  if(!boot||boot.recoverySha!==RECOVERY_SHA||boot.productionAccepted!==false||
    boot.scope!=='fixed recovery processes on isolated loopback'||boot.generationAuthority!=='disposable process supervisor; not systemd'||
    JSON.stringify(boot.limitations)!==JSON.stringify(['Test runtime configuration; production launchers and writer dependencies not exercised',
      'No recovery frontend included in sealed backend artifact','No production routing or owner-policy acceptance'])||
    ['apiBoot','workerBoot','workerRestart','readinessLifecycle','gracefulProcessExit'].some(key=>boot[key]!=='PASS')||
    boot.stoppedWorkerReadinessDenied!==true||boot.heartbeatGenerationChangeObserved!==true||
    boot.anonymousPostDenials!==9||boot.invalidTokenPostDenials!==9||
    boot.integrated?.revokedGrantDenied!==true||boot.integrated?.paidUsageRows!==0||
    !Array.isArray(boot.integrated?.reads)||boot.integrated.reads.length!==6)reject();
  const taskIds=new Set(),receiptIds=new Set(); let generation;
  for(const [index,row] of boot.integrated.reads.entries()){
    if(!row||row.capability!==cases[index].id||row.route!==cases[index].route||row.status!=='PASS_FIXED_PROCESS_HTTP'||
      !Number.isInteger(row.boundedResultCount)||row.boundedResultCount<1||row.boundedResultCount>5||
      !Number.isInteger(row.databaseRequests)||row.databaseRequests<1||row.databaseRequests>100||
      ![row.apiPid,row.workerPid].every(pid=>Number.isInteger(pid)&&pid>1)||row.apiPid===row.workerPid||
      ![row.apiGeneration,row.workerGeneration].every(value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value))||row.apiGeneration===row.workerGeneration||
      ![row.taskId,row.receiptId].every(value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,180}$/.test(value))||
      taskIds.has(row.taskId)||receiptIds.has(row.receiptId)||
      ['authorityBinding','claimReceiptBinding','idempotentReplay','anonymousDenial','wrongCredentialDenial','foreignWorkspaceDenial'].some(key=>row[key]!==true))reject();
    const current=JSON.stringify([row.apiPid,row.workerPid,row.apiGeneration,row.workerGeneration]);
    if(generation&&generation!==current)reject(); generation=current;
    taskIds.add(row.taskId);receiptIds.add(row.receiptId);
  }
  return structuredClone(report);
}
