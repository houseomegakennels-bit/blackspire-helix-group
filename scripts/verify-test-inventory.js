import { expectedTestFiles, readTrustedInventoryReport } from './test-inventory.js';

const [reportPath, runId] = process.argv.slice(2);
if (!reportPath || !runId) {
  throw new Error('Usage: node scripts/verify-test-inventory.js <trusted-report.jsonl> <run-id>');
}

try {
  const record = readTrustedInventoryReport(reportPath, { intended: expectedTestFiles(), runId });
  console.log([
    'Trusted test inventory verified:',
    `intended=${record.counts.discovered}`,
    `discovered=${record.counts.discovered}`,
    `started=${record.counts.started}`,
    `completed=${record.counts.completed}`,
    `childStatus=${record.childStatus.code}`,
    `terminalState=${record.terminalState}`,
  ].join(' '));
} catch (error) {
  console.error(`Trusted test inventory verification failed: ${error.message}`);
  process.exitCode = 1;
}
