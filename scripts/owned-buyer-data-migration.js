#!/usr/bin/env node
import {runOwnedBuyerMigration} from '../packages/buyer-writer/owned-migration-host.js';
try{
 const [flag,releaseSha,operationId,...extra]=process.argv.slice(2);
 if(process.versions.node!=='22.23.1'||process.getuid?.()!==0||process.geteuid?.()!==0||extra.length||!['--apply','--reconcile'].includes(flag))throw new Error();
 const result=await runOwnedBuyerMigration({releaseSha,operationId,mode:flag.slice(2)});
 process.stdout.write(JSON.stringify(result)+'\n');
}catch{process.stderr.write('Owned Buyer migration stopped; retain protected operation records and reconcile.\n');process.exitCode=1;}
