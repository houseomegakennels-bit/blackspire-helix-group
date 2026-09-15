#!/usr/bin/env node
import { supervise } from '../packages/zola-six-reads/supervise.js';
import { validateIntegratedRecoveryReport } from '../packages/zola-rollback/integrated-report.js';
try {
  if(process.argv.length!==2)throw new Error('arguments refused');
  const report=JSON.parse(await supervise([new URL('./zola-recovery-integrated-child.js',import.meta.url).pathname],{isolatedNetwork:true,timeoutMs:180000}));
  validateIntegratedRecoveryReport(report);
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
}catch{process.stderr.write('FAIL: fixed integrated recovery rehearsal\n');process.exitCode=1;}
