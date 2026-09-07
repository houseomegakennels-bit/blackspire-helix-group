#!/usr/bin/env node
// Deliberately no live mode: synthetic route evidence cannot satisfy release gates.
import { supervise } from '../packages/zola-six-reads/supervise.js';
try {
  if (process.argv.length !== 2) throw new Error('unsupported argument');
  const output = await supervise([new URL('./zola-six-read-child.js', import.meta.url).pathname]);
  const report = JSON.parse(output);
  if (report.productionReady !== false || report.evidence?.length !== 6) throw new Error('invalid report');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} catch {
  process.stderr.write('FAIL: offline six-read contract; no live acceptance claimed\n');
  process.exitCode = 1;
}
