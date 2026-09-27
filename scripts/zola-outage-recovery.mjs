#!/usr/bin/env node
import {createOutageRecoveryHost} from '../packages/zola-release/outage-recovery-host.js';
import {runOutageRecovery} from '../packages/zola-release/outage-recovery.js';
const host=createOutageRecoveryHost();
try {
  if(process.argv.length!==3||!['--check','--apply'].includes(process.argv[2]))throw Error('Expected --check or --apply');
  if(process.argv[2]==='--check'){await host.preflight();console.log('OUTAGE_RECOVERY_PREFLIGHT_PASS');}
  else console.log(JSON.stringify(await runOutageRecovery(host)));
} catch {console.error('OUTAGE_RECOVERY_STOPPED: retain evidence; do not blindly retry');process.exitCode=1;}
finally {host.close();}
