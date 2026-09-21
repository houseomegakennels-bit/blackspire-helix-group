#!/usr/bin/env node
import {runOwnedSourceSecurity} from '../packages/buyer-writer/owned-source-security-host.js';
try{
 const [flag,releaseSha,operationId,...extra]=process.argv.slice(2);
 if(process.versions.node!=='22.23.1'||process.getuid?.()!==0||process.geteuid?.()!==0||extra.length||!['--prepare','--apply','--reconcile'].includes(flag))throw new Error();
 const result=await runOwnedSourceSecurity({releaseSha,operationId,mode:flag.slice(2)});
 process.stdout.write(JSON.stringify(result)+'\n');
}catch{process.stderr.write('Owned source security stopped; retain protected operation records and reconcile.\n');process.exitCode=1;}
