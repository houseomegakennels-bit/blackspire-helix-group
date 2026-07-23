// Read-only production port selection. Reports the preferred free port for the durable VPS
// runtime without writing configuration, starting a service, or touching an existing listener.
//
// 8789 is preferred; when it is occupied the first verified free candidate through 8799 is
// reported instead. Ports 8787 (existing API/worker) and 8788 (restricted staging) are never
// candidates. Each check binds only if the port is free and releases it immediately.
import { selectProductionPort, PRODUCTION_BIND_HOST } from '../packages/shared/bind.js';

const result = await selectProductionPort({ host: PRODUCTION_BIND_HOST });
for (const entry of result.checked) {
  process.stdout.write(`checked ${PRODUCTION_BIND_HOST}:${entry.port} -> ${entry.free ? 'free' : `in use (${entry.code || 'unavailable'})`}\n`);
}
if (!result.ok) {
  process.stderr.write(`${result.errors.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write(`\nSELECTED PRODUCTION BIND: BIND_HOST=${result.host} PORT=${result.port}\n`);
process.stdout.write('This is a report only. No service, configuration, or listener was changed.\n');
