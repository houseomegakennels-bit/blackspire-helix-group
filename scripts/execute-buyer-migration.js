import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import pg from 'pg';
import {readRootOwnedMetadataSnapshot,readRootOwnedJson} from '../packages/buyer-writer/protected-json.js';
import {prepareBuyerMigrationExecution,executeBuyerMigration} from '../packages/buyer-writer/migration-executor.js';
import {claimBuyerMigrationIntent,openBuyerMigrationEvidence,appendBuyerMigrationEvidence} from '../packages/buyer-writer/migration-journal.js';

// Explicit root-operated entrypoint. The commander must pass all release gates
// before --apply. No production credentials are loaded by --dry-run. A fresh
// exclusive intent file is mandatory; uncertain attempts are reconciled using
// --reconcile and never automatically retried. Evidence is not live acceptance.
let fd,client;
let record;
const save=()=>appendBuyerMigrationEvidence(fd,record);
try {
  if(process.getuid?.()!==0||process.versions.node!=='22.23.1'||process.argv.length!==5)throw new Error();
  const [mode,inputPath,evidencePath]=process.argv.slice(2);
  if(!['--dry-run','--apply','--reconcile'].includes(mode))throw new Error();
  const input=readRootOwnedMetadataSnapshot(inputPath,{groupId:0}).value;
  if(Object.keys(input).sort().join(',')!=='body,databaseConfigPath,expectedManifestSha256,manifestBytes,migrationVersion,providerManifest,releaseSha')throw new Error();
  const plan=prepareBuyerMigrationExecution(input);
  const root=fileURLToPath(new URL('..',import.meta.url));
  const options={encoding:'utf8',timeout:5000,maxBuffer:1024*1024,env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1'}};
  const git=args=>execFileSync('/usr/bin/git',['--no-replace-objects','-c','core.useReplaceRefs=false','-C',root,...args],options).trim();
  if(git(['rev-parse','HEAD'])!==input.releaseSha||git(['status','--porcelain','--untracked-files=all'])!=='')throw new Error();
  fd=openBuyerMigrationEvidence(evidencePath);
  record={version:1,...plan,mode:mode.slice(2),timestamp:new Date().toISOString(),status:'intent-recorded',productionAcceptance:false};save();
  if(mode==='--dry-run')record.status='validated-no-connection';
  else {
    if(mode==='--apply')claimBuyerMigrationIntent(plan);
    const config=readRootOwnedJson(input.databaseConfigPath,{groupId:0,maxBytes:65536});
    if(Object.keys(config).sort().join(',')!=='ca,host,password'||config.host!=='db.kchtrvfcixnimvxxctkj.supabase.co'
      ||typeof config.password!=='string'||config.password.length<16||config.password.length>4096
      ||typeof config.ca!=='string'||!config.ca.startsWith('-----BEGIN CERTIFICATE-----'))throw new Error();
    client=new pg.Client({host:config.host,port:5432,database:'postgres',user:'postgres',password:config.password,
      ssl:{rejectUnauthorized:true,ca:config.ca},connectionTimeoutMillis:5000,query_timeout:35000,
      application_name:'zola-guarded-application-migration'});
    client.on('error',()=>{});
    await client.connect();
    Object.assign(record,await executeBuyerMigration({client,plan,mode:mode.slice(2)}));
  }
  save();console.log(JSON.stringify({status:record.status,releaseSha:plan.releaseSha,productionAcceptance:false}));
}catch(error){
  if(fd!==undefined){record.status=error?.code==='OUTCOME_UNKNOWN'?'outcome-unknown-reconcile-only':'failed-no-automatic-retry';try{save();}catch{/* retain intent if possible */}}
  console.error('Buyer migration execution stopped; inspect protected evidence and reconcile uncertain attempts');process.exitCode=1;
}finally{
  if(client){try{await client.end();}catch{process.exitCode=1;}}
  if(fd!==undefined)fs.closeSync(fd);
}
