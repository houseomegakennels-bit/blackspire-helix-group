#!/usr/bin/env node
import { runAuthority } from '../packages/zola-six-reads/authority.js';
import { runOffline } from '../packages/zola-six-reads/offline.js';
try {
  if (process.argv.length !== 2) throw new Error('unsupported argument');
  const report = await runOffline();
  report.authority = await runAuthority(process.env.ZOLA_SIX_READ_DISPOSABLE_DIR);
  process.stdout.write(`${JSON.stringify(report)}\n`);
} catch {
  process.stderr.write('offline contract failed\n'); process.exitCode = 1;
}
