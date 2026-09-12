import fs from 'node:fs';
import path from 'node:path';
import {readRootOwnedJson} from '../packages/buyer-writer/protected-json.js';
import {prepareN8nTransition,createN8nTransport,executeN8nTransition} from '../packages/zola-release/commander-n8n.js';
import {openReleaseJournal,recoverReleaseJournalLock,RELEASE_OPERATION_ROOT,hash} from '../packages/zola-release/commander-journal.js';
import {readReleaseProtectedBytes,verifyReleaseSource,verifyCanonicalWriter,verifyReleaseCi} from '../packages/zola-release/commander-host.js';

// This concrete workflow lane never merges, applies SQL, starts a service, runs
// a workflow or republishes the legacy definition. Other release gates remain
// the commander's prerequisites; this command is not global release acceptance.
let journal;
try{
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1'||process.argv.length!==4)throw new Error();
 const [flag,inputPath]=process.argv.slice(2),mode=flag.replace(/^--/,'');
 if(!['dry-run','inspect','deactivate','update','publish','rollback','reconcile'].includes(mode))throw new Error();
 const input=readRootOwnedJson(inputPath,{groupId:0});
 if(Object.keys(input).sort().join(',')!=='backupFile,configurationFile,exclusiveWindowUntil,packageConfigurationFile,releaseSha')throw new Error();
 const configuration=readRootOwnedJson(input.packageConfigurationFile,{groupId:0});
 if(input.releaseSha!==configuration.releaseSha)throw new Error();
 const backupBytes=readReleaseProtectedBytes(input.backupFile,2*1024*1024);
 const plan=prepareN8nTransition({configuration,backupBytes});
 if(mode==='dry-run'){
  process.stdout.write(JSON.stringify({status:'PLAN_VALIDATED',releaseSha:plan.releaseSha,namespace:plan.namespace,releaseReady:false,mutationSent:false})+'\n');
 }else{
  verifyReleaseSource(input.releaseSha,{requireRemote:!['rollback','inspect','reconcile'].includes(mode)});
  const parent=path.dirname(RELEASE_OPERATION_ROOT),s=fs.lstatSync(parent);
  if(!s.isDirectory()||s.uid!==0||s.isSymbolicLink()||(s.mode&0o022))throw new Error();
  try{fs.mkdirSync(RELEASE_OPERATION_ROOT,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  if(mode==='reconcile')recoverReleaseJournalLock();
  journal=openReleaseJournal();
  // Global operations own forward transitions under the same lock. Retain the
  // GET-only reconciliation and exact candidate deactivation recovery paths.
  if(journal.stream('release').events().length&&!['inspect','reconcile','rollback'].includes(mode))throw new Error();
  const key=readReleaseProtectedBytes('/var/lib/blackspire-operator/n8n-api-key',16384).trim();
  const request=createN8nTransport(key);
  const stable=()=>{
   if(hash(readReleaseProtectedBytes(input.backupFile,2*1024*1024))!==plan.backupSha256
    ||JSON.stringify(readRootOwnedJson(input.packageConfigurationFile,{groupId:0}))!==JSON.stringify(configuration))throw new Error();
  };
  stable();
  const result=await executeN8nTransition({plan,mode,request,journal,exclusiveWindowUntil:input.exclusiveWindowUntil,
   verifyWriter:async()=>{verifyReleaseSource(input.releaseSha);verifyReleaseCi(input.releaseSha);stable();return verifyCanonicalWriter(input.releaseSha,input.configurationFile);}});
  stable();
  process.stdout.write(JSON.stringify({...result,releaseSha:input.releaseSha})+'\n');
 }
}catch(error){
 const reason=/^[A-Z_]{3,80}$/.test(error?.code??'')?error.code:'COMMAND_FAILED_CLOSED';
 process.stdout.write(JSON.stringify({status:'STOPPED',reason,releaseReady:false})+'\n');
 process.stderr.write('Zola workflow command stopped. Retain intent evidence; reconcile uncertain operations without retry.\n');process.exitCode=1;
}finally{try{journal?.close();}catch{process.exitCode=1;}}
