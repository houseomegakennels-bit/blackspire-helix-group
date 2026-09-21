#!/usr/bin/env node
import {openReleaseJournal} from '../packages/zola-release/commander-journal.js';
import {retirePartialRelease} from '../packages/zola-release/partial-release-retirement.js';
import {createPartialRetirementHost,createPartialRetirementStore} from '../packages/zola-release/partial-release-retirement-host.js';
let journal;
try{
 if(process.getuid()!==0||process.versions.node!=='22.23.1'||process.argv.length!==5||process.argv[2]!=='--retire')throw new Error();
 journal=openReleaseJournal();
 const result=await retirePartialRelease({successorReleaseSha:process.argv[3],successorOperationId:process.argv[4],journal},{host:createPartialRetirementHost(),store:createPartialRetirementStore()});
 process.stdout.write(JSON.stringify(result)+'\n');
}catch{process.stderr.write('Partial release retirement refused; preserve stop intent, history and data\n');process.exitCode=1;}
finally{journal?.close();}
