#!/usr/bin/env node
import { collectSixReads, validateCollectorConfig, readCases, digest } from '../packages/zola-six-reads/collector.js';
import { readRootOwnedJson } from '../packages/buyer-writer/protected-json.js';

// --dry-run parses metadata only. It does not open credentials, SQLite, journal,
// process environment, services or sockets, and performs no writes.
let host, journal;
try {
  const [mode, configPath, ...extra] = process.argv.slice(2);
  if (!['--dry-run','--production'].includes(mode) || !configPath || extra.length) throw new Error('ARGUMENTS_REJECTED');
  const config = validateCollectorConfig(readRootOwnedJson(configPath, { groupId: 0 }));
  if (mode === '--dry-run') {
    process.stdout.write(`${JSON.stringify({ version: 1, mode: 'dry-run', status: 'PLAN_VALIDATED', productionExecuted: false,
      releaseSha: config.releaseSha, configDigest: digest(config),
      reads: readCases(config.dealId).map(({ capability, route, permissions }) => ({ capability, route, permissions })),
      prerequisites: ['Exact production API/worker generation and frontend SHA', 'Existing distinct principal authenticated session',
        'Protected journal directory and credentials', 'API/worker open the exact configured authority SQLite inode'],
      livePass: false, remainingGates: ['Authoritative division mutation delta', 'Process-wide egress observation', 'Supabase row-owner denial'] })}\n`);
    process.stderr.write('Six-read plan validated; no network, credentials, database, or journal opened. Live acceptance remains unverified.\n');
  } else {
    const { openCollectorJournal, createProductionCollectorHost } = await import('../packages/zola-six-reads/collector-host.js');
    journal = openCollectorJournal(config.journalDirectory, config.runId);
    host = createProductionCollectorHost(config);
    const report = await collectSixReads(config, host, journal);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    process.stderr.write(`Collected ${report.results.length}/6 observed reads. Full production acceptance remains unverified; release gate refused.\n`);
    process.exitCode = report.livePass ? 0 : 2;
  }
} catch (error) {
  // Do not expose HTTP, SQLite, protected path, parser or credential error text.
  const reason = /^[A-Z][A-Z_]{2,80}$/.test(error?.code ?? '') ? error.code : 'COLLECTOR_FAILED_CLOSED';
  process.stdout.write(`${JSON.stringify({ version: 1, livePass: false, status: 'FAILED_CLOSED', reason })}\n`);
  process.stderr.write(`Six-read collector refused: ${reason}. Retain the journal; never issue a new key after uncertain admission.\n`);
  process.exitCode = 1;
} finally {
  try { host?.close(); } catch { process.stderr.write('Collector database close failed.\n'); process.exitCode = 1; }
  try { journal?.close(); } catch { process.stderr.write('Collector journal close failed; retain evidence and reconcile lock.\n'); process.exitCode = 1; }
}
