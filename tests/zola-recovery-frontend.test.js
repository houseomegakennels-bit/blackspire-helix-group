import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { validateRecoveryFrontendReport } from '../packages/zola-rollback/frontend-report.js';
import { RECOVERY_SHA } from '../packages/zola-rollback/intake.js';
import { cases } from '../packages/zola-six-reads/offline.js';

const fixture=()=>({version:1,recoverySha:RECOVERY_SHA,status:'PASS_IMMUTABLE_FRONTEND_HTTP',productionAccepted:false,sourceDigest:'a'.repeat(64),archiveDigest:'b'.repeat(64),
  observedDatabaseMutationAttempts:0,externalNetwork:'kernel isolated; loopback only',
  dependencyScope:'Reused installed dependencies; exact recovery package and lock bytes match current checkout; installed package integrity not independently verified',
  limitations:['Next development runtime, not production build or deployment','Synthetic database; no live row-owner policy or complete functional rollback acceptance'],
  results:cases.map(row=>({capability:row.id,status:'PASS_IMMUTABLE_NEXT_HTTP',boundedResultCount:1,anonymousDenial:true,wrongCredentialDenial:true,foreignWorkspaceDenial:true,databaseRequests:1}))});
test('immutable frontend report retains development and dependency limits without accepting production',()=>{
  const report=fixture();assert.deepEqual(validateRecoveryFrontendReport(report),report);assert.notEqual(validateRecoveryFrontendReport(report),report);
});
test('missing reads, malformed witnesses, dependency overclaims and scope escalation fail closed',()=>{
  for(const mutate of [r=>r.productionAccepted=true,r=>r.recoverySha='c'.repeat(40),r=>r.sourceDigest='bad',r=>r.results.pop(),
    r=>r.results[1]=r.results[0],r=>r.results[0].boundedResultCount=0,r=>r.results[0].databaseRequests=0,
    r=>r.results[0].foreignWorkspaceDenial=false,r=>r.observedDatabaseMutationAttempts=1,r=>r.limitations=[],r=>r.dependencyScope='Verified']){
    const report=fixture();mutate(report);assert.throws(()=>validateRecoveryFrontendReport(report),/REJECTED/);
  }
});
test('frontend child refuses ambient execution before Git export, credentials or server startup',()=>{
  const result=spawnSync(process.execPath,['scripts/zola-recovery-frontend-child.js'],{cwd:process.cwd(),encoding:'utf8',timeout:10000,env:{PATH:'/usr/bin:/bin'}});
  assert.equal(result.status,1);assert.equal(result.stdout,'');assert.match(result.stderr,/Immutable recovery frontend failed/);
});
