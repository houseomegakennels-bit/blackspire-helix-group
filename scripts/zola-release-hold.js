#!/usr/bin/env node
// Explicit stopped-service preparation. No enable/open or restart command.
import {spawnSync} from 'node:child_process';
import {openReleaseJournal} from '../packages/zola-release/commander-journal.js';
import {verifyReleaseSource} from '../packages/zola-release/commander-host.js';
import {inspectReleaseCommander} from '../packages/zola-release/commander.js';
import {engageReleaseAdmissionHold,reconcileReleaseAdmissionHold} from '../packages/zola-release/admission-hold.js';
let journal;
try {
  const mode=process.argv[2];
  if(process.getuid()!==0||process.versions.node!=='22.23.1'||!(mode==='--hold'&&process.argv.length===4||mode==='--reconcile'&&process.argv.length===3))throw new Error();
  const releaseSha=process.argv[3];if(mode==='--hold')verifyReleaseSource(releaseSha);
  const group=spawnSync('/usr/bin/getent',['group','blackspire'],{encoding:'utf8',timeout:1000,maxBuffer:4096,env:{PATH:'/usr/bin:/bin'}});
  const fields=group.stdout?.trim().split(':');
  if(group.status!==0||group.error||group.stderr!==''||fields?.length!==4||fields[0]!=='blackspire'||!/^\d+$/.test(fields[2]))throw new Error();
  journal=openReleaseJournal();
  if(mode==='--hold'&&inspectReleaseCommander(journal).migrationReconciliationRequired)throw new Error();
  console.log(JSON.stringify(mode==='--hold'?engageReleaseAdmissionHold({releaseSha,journal},{groupId:Number(fields[2])})
    :reconcileReleaseAdmissionHold({journal},{groupId:Number(fields[2])})));
}catch{console.log(JSON.stringify({status:'STOPPED',reason:'RELEASE_HOLD_REJECTED',intakeOpen:false,productionAccepted:false}));process.exitCode=1;}
finally{try{journal?.close();}catch{process.exitCode=1;}}
