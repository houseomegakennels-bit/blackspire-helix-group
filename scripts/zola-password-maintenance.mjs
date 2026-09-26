#!/usr/bin/env node
import {createPasswordMaintenanceHost} from '../packages/zola-release/password-maintenance-host.js';
import {runPasswordMaintenance} from '../packages/zola-release/password-maintenance.js';
const host=createPasswordMaintenanceHost();
try{if(process.argv.length!==3||!['--check','--apply'].includes(process.argv[2]))throw Error('Expected --check or --apply');
 if(process.argv[2]==='--check'){await host.preflight();console.log('PASSWORD_MAINTENANCE_PREFLIGHT_PASS');}
 else console.log(JSON.stringify(await runPasswordMaintenance(host)));
}catch{console.error('PASSWORD_MAINTENANCE_STOPPED: retain evidence; do not blindly retry');process.exitCode=1;}finally{host.close();}
