import {openReleaseJournal} from '../packages/zola-release/commander-journal.js';
import {retireBlockedRelease} from '../packages/zola-release/blocked-release-retirement.js';
let journal;
try{
 if(process.getuid()!==0||process.versions.node!=='22.23.1'||process.argv.length!==4||process.argv[2]!=='--retire')throw new Error();
 journal=openReleaseJournal();
 process.stdout.write(JSON.stringify(await retireBlockedRelease({successorReleaseSha:process.argv[3],journal}))+'\n');
}catch{process.stderr.write('Blocked Zola release retirement refused; preserve journal and protected evidence\n');process.exitCode=1;}
finally{journal?.close();}
