import {archiveOldObservation} from '../packages/zola-six-reads/owned-collector-successor-host.js';
try{
 if(process.getuid?.()!==0||process.geteuid?.()!==0||process.versions.node!=='22.23.1'||process.argv.length!==3||!['--check','--archive','--reconcile'].includes(process.argv[2]))throw Error();
 process.stdout.write(JSON.stringify(await archiveOldObservation({mutate:process.argv[2]!=='--check',reconcile:process.argv[2]==='--reconcile'}))+'\n');
}catch{process.stderr.write('Collector successor archive rejected. Retain all records and reconcile exact identities.\n');process.exitCode=1;}
