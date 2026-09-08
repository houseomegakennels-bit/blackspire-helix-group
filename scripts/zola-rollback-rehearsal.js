#!/usr/bin/env node
// Operator-host isolated proof; fixed sealed recovery only. No production mode.
import { supervise } from '../packages/zola-six-reads/supervise.js';
try {
  if (process.argv.length !== 2) throw new Error('arguments refused');
  const result = JSON.parse(await supervise([new URL('./zola-rollback-rehearsal-child.js', import.meta.url).pathname], { isolatedNetwork: true }));
  if (result.scope !== 'isolated recovery admission and dispatch' || result.productionAccepted !== false || result.reads.length !== 6) throw new Error('invalid report');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch { process.stderr.write('FAIL: isolated rollback rehearsal\n'); process.exitCode = 1; }
