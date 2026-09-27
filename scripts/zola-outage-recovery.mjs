#!/usr/bin/env node
import {createOutageRecoveryHost} from '../packages/zola-release/outage-recovery-host.js';
import {runOutageRecovery} from '../packages/zola-release/outage-recovery.js';
const resumeStop=process.argv[2]==='--resume-stop'||process.argv[2]==='--check-resume-stop';
const host=createOutageRecoveryHost({resumeStop});
try {
  if(process.argv.length!==3||!['--check','--apply','--resume-stop','--check-resume-stop'].includes(process.argv[2]))throw Error('Expected --check or --apply');
  if(['--check','--check-resume-stop'].includes(process.argv[2])){await host.preflight();console.log('OUTAGE_RECOVERY_PREFLIGHT_PASS');}
  else console.log(JSON.stringify(await runOutageRecovery(host,{resumeStop})));
} catch {console.error('OUTAGE_RECOVERY_STOPPED: retain evidence; do not blindly retry');process.exitCode=1;}
finally {host.close();}
