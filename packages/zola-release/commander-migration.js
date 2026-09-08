import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {readRootOwnedMetadataSnapshot} from '../buyer-writer/protected-json.js';
import {readReleaseProtectedBytes} from './commander-host.js';
import {prepareBuyerMigrationPackage} from '../buyer-writer/migration-package.js';
import {prepareConnectedBuyerMigration} from '../buyer-writer/migration-connected.js';
import {prepareBuyerMigrationExecution,executeBuyerMigration} from '../buyer-writer/migration-executor.js';
import {claimBuyerMigrationIntent} from '../buyer-writer/migration-journal.js';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const reject=()=>{throw new Error('Release migration preparation rejected');};

// Read only. Regenerate both executor payloads from the reviewed provider
// manifest; neither a bundle digest nor imported history authorizes SQL.
export function verifyReleaseMigrationPackage({releaseSha,configurationFile},{
 readJson=file=>readRootOwnedMetadataSnapshot(file,{groupId:0}).value,
 readBytes=readReleaseProtectedBytes,
}={}){
 try{
  if(!/^[a-f0-9]{40}$/.test(releaseSha??'')||typeof configurationFile!=='string'
   ||!path.isAbsolute(configurationFile)||path.resolve(configurationFile)!==configurationFile
   ||path.basename(configurationFile)!=='migration-input.json')reject();
  const configuration=readJson(configurationFile);
  if(Object.keys(configuration).sort().join(',')!=='providerManifest,releaseSha'||configuration.releaseSha!==releaseSha)reject();
  const prepared=prepareBuyerMigrationPackage(configuration),root=path.dirname(configurationFile);
  const manifestBytes=readBytes(path.join(root,'migration-manifest.json'),2*1024*1024);
  const body=readBytes(path.join(root,'application-body.sql'),2*1024*1024);
  const sql=readBytes(path.join(root,'application.sql'),2*1024*1024);
  if(manifestBytes!==prepared.manifestBytes||body!==prepared.body||sql!==prepared.sql)reject();
  const connected=prepareConnectedBuyerMigration({...configuration,manifestBytes,body,expectedManifestSha256:digest(manifestBytes)});
  // Re-read all inputs to reject package replacement during preparation.
  if(JSON.stringify(readJson(configurationFile))!==JSON.stringify(configuration)
   ||readBytes(path.join(root,'migration-manifest.json'),2*1024*1024)!==manifestBytes
   ||readBytes(path.join(root,'application-body.sql'),2*1024*1024)!==body
   ||readBytes(path.join(root,'application.sql'),2*1024*1024)!==sql)reject();
  return{releaseSha,manifestSha256:digest(manifestBytes),bodySha256:digest(body),nativeSqlSha256:digest(sql),
   connectedQuerySha256:connected.querySha256,projectId:connected.request.project_id,
   status:'PACKAGE_VERIFIED_EXECUTION_GATED',productionAcceptance:false};
 }catch{reject();}
}

const migrationTypes=new Set(['release_migration_intent','release_migration_result']);
const statuses=new Set(['committed','committed-history-verified','not-recorded-retry-not-authorized','outcome-unknown','execution-failed','claim-unavailable']);
export function inspectReleaseMigrationHistory(events){
 let intent;
 for(const event of events){
  if(!migrationTypes.has(event?.type))continue;
  const fields='schema,type,operationId,releaseSha,migrationVersion,bodySha256,manifestSha256'+(event.type==='release_migration_result'?',status':'');
  if(Object.keys(event).sort().join(',')!==fields.split(',').sort().join(',')||event.schema!==1
   ||!/^[a-f0-9-]{36}$/.test(event.operationId??'')||!/^[a-f0-9]{40}$/.test(event.releaseSha??'')
   ||!/^\d{14}$/.test(event.migrationVersion??'')||!['bodySha256','manifestSha256'].every(k=>/^[a-f0-9]{64}$/.test(event[k]??'')))reject();
  if(event.type==='release_migration_intent'){
   if(intent)reject();intent=event;
  }else{
   if(!intent||!statuses.has(event.status)||!['operationId','releaseSha','migrationVersion','bodySha256','manifestSha256'].every(k=>event[k]===intent[k]))reject();
  }
 }
 return intent?structuredClone(intent):null;
}

// Internal execution adapter, deliberately unreachable from the observational
// CLI. The enclosing commander must hold its global journal lock and satisfy
// intake/backup/identity/acceptance gates before invoking apply. This adapter
// owns durable no-retry semantics and invokes the real guarded transaction
// executor (including in-transaction provider ACL postconditions), never SQL
// supplied by a callback. The dedicated TLS client is supplied by that owner.
export async function executeReleaseNativeMigration({input,client,journal,mode},{claim=claimBuyerMigrationIntent}={}){
 try{
  if(!['apply','reconcile'].includes(mode))reject();
  const plan=prepareBuyerMigrationExecution(input),stream=journal.stream('release');
  const events=stream.events();
  if(events.some(event=>!migrationTypes.has(event?.type)&&!['preflight_started','preflight_passed','preflight_stopped'].includes(event?.type)))reject();
  const prior=inspectReleaseMigrationHistory(events);
  let intent=prior;
  if(mode==='apply'){
   // Any prior release migration, even a different SHA or failed claim,
   // requires reconciliation. Changing the candidate never clears uncertainty.
   if(prior)reject();
   intent={schema:1,type:'release_migration_intent',operationId:randomUUID(),...plan};
   stream.append(intent);
   try{claim({...plan,transport:'native'});}catch{
    stream.append({...intent,type:'release_migration_result',status:'claim-unavailable'});
    return{status:'STOPPED',reason:'MIGRATION_CLAIM_UNAVAILABLE',productionAcceptance:false,mutationSent:false};
   }
  }else if(!prior||!['releaseSha','migrationVersion','bodySha256','manifestSha256'].every(k=>prior[k]===plan[k]))reject();
  let result;
  try{result=await executeBuyerMigration({client,plan,mode});}
  catch(error){
   const status=error.code==='OUTCOME_UNKNOWN'?'outcome-unknown':'execution-failed';
   stream.append({...intent,type:'release_migration_result',status});
   return{status:'STOPPED',reason:status==='outcome-unknown'?'MIGRATION_OUTCOME_UNKNOWN':'MIGRATION_EXECUTION_FAILED',
    productionAcceptance:false,mutationSent:mode==='apply',reconcileOnly:true};
  }
  stream.append({...intent,type:'release_migration_result',status:result.status});
  return{...result,mutationSent:mode==='apply',reconcileOnly:true};
 }catch{
  // A lost result append is itself uncertain. Never return a success whose
  // durable result is missing, and never repeat SQL on a subsequent apply.
  return{status:'STOPPED',reason:'RELEASE_MIGRATION_REJECTED',productionAcceptance:false,reconcileOnly:true};
 }
}
