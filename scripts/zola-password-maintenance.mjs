#!/usr/bin/env node
import {createPasswordMaintenanceHost} from '../packages/zola-release/password-maintenance-host.js';
import {runPasswordMaintenance} from '../packages/zola-release/password-maintenance.js';
const host=createPasswordMaintenanceHost({recovery:process.argv[2]==='--recover-readiness'||process.argv[2]==='--check-recovery'});
try{if(process.argv.length!==3||!['--check','--apply','--recover-readiness','--check-recovery'].includes(process.argv[2]))throw Error('Expected --check or --apply');
 if(['--check','--check-recovery'].includes(process.argv[2])){await host.preflight();console.log('PASSWORD_MAINTENANCE_PREFLIGHT_PASS');}
 else console.log(JSON.stringify(await runPasswordMaintenance(host)));
}catch{console.error('PASSWORD_MAINTENANCE_STOPPED: retain evidence; do not blindly retry');process.exitCode=1;}finally{host.close();}
