import fs from 'node:fs';
import {readRootOwnedMetadataSnapshot} from '../packages/buyer-writer/protected-json.js';
import {prepareConnectedBuyerMigration,reconcileConnectedBuyerMigration} from '../packages/buyer-writer/migration-connected.js';
import {claimBuyerMigrationIntent,openBuyerMigrationEvidence,appendBuyerMigrationEvidence} from '../packages/buyer-writer/migration-journal.js';
import {verifyReleaseSource} from '../packages/zola-release/commander-host.js';

// The agent's connected Supabase transport is not a local ambient credential.
// Prepare its exact request and persist intent separately; reconcile only from
// the fixed read-only query. This CLI never sends SQL or claims release readiness.
let fd;
try{
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1'||process.argv.length!==5)throw new Error();
 const [mode,inputFile,outputFile]=process.argv.slice(2);
 if(!['--prepare','--claim','--reconcile'].includes(mode))throw new Error();
 const input=readRootOwnedMetadataSnapshot(inputFile,{groupId:0}).value;
 const keys=['releaseSha','providerManifest','manifestBytes','body','expectedManifestSha256'];
 if(Object.keys(input).sort().join(',')!==[...keys,...(mode==='--reconcile'?['observationFile']:[])].sort().join(','))throw new Error();
 const plan=prepareConnectedBuyerMigration(input);
 verifyReleaseSource(input.releaseSha,{requireRemote:mode==='--claim'});
 let result;
 if(mode==='--reconcile'){
  const rows=readRootOwnedMetadataSnapshot(input.observationFile,{groupId:0}).value;
  result=reconcileConnectedBuyerMigration(plan,rows);
 }else if(mode==='--claim'){
  // Share the native transport's exact release/body intent namespace. The API
  // chooses the actual migration version, so this timestamp is an intent ID
  // only and must never be reported as a committed Supabase history version.
  claimBuyerMigrationIntent({releaseSha:plan.releaseSha,bodySha256:plan.bodySha256,manifestSha256:plan.manifestSha256,
   migrationVersion:new Date().toISOString().replace(/\D/g,'').slice(0,14),transport:'connected'});
  result={status:'intent-recorded-send-once-or-reconcile',releaseSha:plan.releaseSha,querySha256:plan.querySha256,productionAcceptance:false};
 }else result={status:'prepared-not-authorized',...plan};
 fd=openBuyerMigrationEvidence(outputFile);appendBuyerMigrationEvidence(fd,result);
 process.stdout.write(JSON.stringify({status:result.status,releaseSha:plan.releaseSha,querySha256:plan.querySha256,
  mutationSent:false,productionAcceptance:false})+'\n');
}catch{
 process.stderr.write('Connected migration stopped; retain intent and reconcile without retry.\n');process.exitCode=1;
}finally{if(fd!==undefined)fs.closeSync(fd);}
