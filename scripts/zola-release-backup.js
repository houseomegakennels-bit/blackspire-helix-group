import {captureProtectedReleaseBackup,verifyProtectedReleaseBackup} from '../packages/zola-release/commander-backup.js';
import {verifyReleaseSource} from '../packages/zola-release/commander-host.js';
try{
 const [mode,releaseSha,manifestFile]=process.argv.slice(2);
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1'||!(mode==='--capture'&&process.argv.length===4||mode==='--verify'&&process.argv.length===5))throw new Error();
 verifyReleaseSource(releaseSha);
 const result=mode==='--capture'?captureProtectedReleaseBackup(releaseSha):verifyProtectedReleaseBackup({releaseSha,manifestFile});
 process.stdout.write(JSON.stringify(result)+'\n');
}catch{process.stdout.write(JSON.stringify({status:'STOPPED',reason:'PROTECTED_BACKUP_REJECTED',productionAccepted:false})+'\n');process.exitCode=1;}
