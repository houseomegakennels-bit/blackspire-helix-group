import fs from 'node:fs';
import path from 'node:path';
import {readRootOwnedJson} from '../packages/buyer-writer/protected-json.js';
import {openReleaseJournal,RELEASE_OPERATION_ROOT} from '../packages/zola-release/commander-journal.js';
import {runReleasePreflight,inspectReleaseCommander} from '../packages/zola-release/commander.js';
import {loadProductionReleaseInput} from '../packages/zola-release/production-release-input.js';
import {runProductionRelease} from '../packages/zola-release/production-release.js';

let journal;
try{
 const [mode,inputFile]=process.argv.slice(2);
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1'
  ||!(mode==='--inspect'&&process.argv.length===3||['--preflight','--release'].includes(mode)&&process.argv.length===4))throw new Error();
 const input=mode==='--preflight'?readRootOwnedJson(inputFile,{groupId:0})
  :mode==='--release'?loadProductionReleaseInput(inputFile):null;
 const parent=fs.lstatSync(path.dirname(RELEASE_OPERATION_ROOT));
 if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==0||(parent.mode&0o022))throw new Error();
 try{fs.mkdirSync(RELEASE_OPERATION_ROOT,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
 journal=openReleaseJournal();
 const result=mode==='--inspect'?inspectReleaseCommander(journal)
  :mode==='--preflight'?await runReleasePreflight({input,journal})
  :await runProductionRelease({loadedInput:input,journal});
 process.stdout.write(JSON.stringify(result)+'\n');
 if(result.status!=='COMPLETE'&&result.status!=='OBSERVED')process.exitCode=1;
}catch{
 // Failure to open or validate the journal cannot establish whether a prior
 // release sent a mutation. Preserve uncertainty; never turn unreadable history
 // into evidence that production was untouched.
 process.stdout.write(JSON.stringify({status:'STOPPED',reason:'COMMAND_FAILED_CLOSED',releaseReady:false,mutationSent:null,reconciliationRequired:true})+'\n');
 process.exitCode=1;
}finally{
 try{journal?.close();}catch{process.exitCode=1;}
}
