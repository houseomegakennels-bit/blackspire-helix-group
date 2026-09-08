import fs from 'node:fs';
import path from 'node:path';
import {readRootOwnedJson} from '../packages/buyer-writer/protected-json.js';
import {openReleaseJournal,RELEASE_OPERATION_ROOT} from '../packages/zola-release/commander-journal.js';
import {runReleasePreflight,inspectReleaseCommander} from '../packages/zola-release/commander.js';

let journal;
try{
 const [mode,inputFile]=process.argv.slice(2);
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1'
  ||!(mode==='--inspect'&&process.argv.length===3||mode==='--preflight'&&process.argv.length===4))throw new Error();
 const input=mode==='--preflight'?readRootOwnedJson(inputFile,{groupId:0}):null;
 const parent=fs.lstatSync(path.dirname(RELEASE_OPERATION_ROOT));
 if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==0||(parent.mode&0o022))throw new Error();
 try{fs.mkdirSync(RELEASE_OPERATION_ROOT,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
 journal=openReleaseJournal();
 const result=mode==='--inspect'?inspectReleaseCommander(journal):await runReleasePreflight({input,journal});
 process.stdout.write(JSON.stringify(result)+'\n');
 if(result.status==='STOPPED')process.exitCode=1;
}catch{
 process.stdout.write(JSON.stringify({status:'STOPPED',reason:'COMMAND_FAILED_CLOSED',releaseReady:false,mutationSent:false})+'\n');
 process.exitCode=1;
}finally{
 try{journal?.close();}catch{process.exitCode=1;}
}
