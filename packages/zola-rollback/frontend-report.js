import { RECOVERY_SHA } from './intake.js';
import { cases } from '../zola-six-reads/offline.js';

export function validateRecoveryFrontendReport(report) {
  const reject=()=>{throw new Error('IMMUTABLE_FRONTEND_REPORT_REJECTED');};
  if(!report||report.version!==1||report.status!=='PASS_IMMUTABLE_FRONTEND_HTTP'||report.recoverySha!==RECOVERY_SHA||report.productionAccepted!==false||
    !/^[a-f0-9]{64}$/.test(report.sourceDigest??'')||!/^[a-f0-9]{64}$/.test(report.archiveDigest??'')||
    report.observedDatabaseMutationAttempts!==0||report.externalNetwork!=='kernel isolated; loopback only'||
    !Array.isArray(report.results)||report.results.length!==cases.length||
    report.dependencyScope!=='Reused installed dependencies; exact recovery package and lock bytes match current checkout; installed package integrity not independently verified'||
    !Array.isArray(report.limitations)||!report.limitations.includes('Next development runtime, not production build or deployment')||
    !report.limitations.includes('Synthetic database; no live row-owner policy or complete functional rollback acceptance'))reject();
  for(const [index,row] of report.results.entries())if(!row||row.capability!==cases[index].id||row.status!=='PASS_IMMUTABLE_NEXT_HTTP'||
    !Number.isInteger(row.boundedResultCount)||row.boundedResultCount<1||row.boundedResultCount>5||
    row.anonymousDenial!==true||row.wrongCredentialDenial!==true||row.foreignWorkspaceDenial!==true||
    !Number.isInteger(row.databaseRequests)||row.databaseRequests<1||row.databaseRequests>100)reject();
  return structuredClone(report);
}
