import {PREDECESSOR_MAIN,bindSuccessorMain,observeSuccessorMain} from './owned-successor-main.js';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {readRootOwnedMetadataSnapshot} from '../buyer-writer/protected-json.js';
import {createOwnedSourceSecurityFiles} from '../buyer-writer/owned-source-security-host.js';
import {readOwnedDatabaseProfile,databaseProfileDigest} from '../buyer-writer/database-profile.js';
import {observeOwnedMigrationPreparationHeld,OWNED_MIGRATION_PREDECESSOR as P,OWNED_MIGRATION_PREDECESSOR_FILES as F,OWNED_MIGRATION_PREDECESSOR_RECORD_DIGESTS as D} from '../buyer-writer/owned-migration-successor.js';
import {verifyReleaseSource,readReleaseProtectedBytes} from './commander-host.js';
import {createN8nTransport,executeN8nTransition,prepareN8nTransition,WORKFLOW_ID} from './commander-n8n.js';
import {prepareOfflineReleaseBundle,writeOfflineReleaseBundle} from './offline-bundle.js';
import {captureProtectedReleaseBackup,verifyProtectedReleaseBackup} from './commander-backup.js';
import {verifyReleaseArtifactDisk} from './commander-preconditions.js';
import {prepareOwnedSuccessorProductionReleaseInput} from './owned-release-input-preparation.js';
const fail=()=>{throw Error('Owned successor input host refused');};
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex'),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
// The native caller supplies only its fixed, fully verified deterministic paths.
export async function synchronizeKnownSuccessorOutputs(paths,verify){
 if(!Array.isArray(paths)||!paths.length||paths.length>16||new Set(paths).size!==paths.length||paths.some(p=>typeof p!=='string'||!path.isAbsolute(p)||path.resolve(p)!==p))fail();
 await verify();for(const p of [...paths,...new Set(paths.map(p=>path.dirname(p)))]){const fd=fs.openSync(p,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}await verify();
}
const OLD='/var/lib/blackspire-operator/preparation/owned-final-2636a1e-95a11ea1-289f-46a9-b5cd-cc7805497242-56ef766c-ed0d-413d-a9fb-730cd38654bc/production-release.json';
const RECOVERY='2c0b600c268faa0571f08322e16d7f81f37789be';
const metadata=p=>{const r=readRootOwnedMetadataSnapshot(p,{groupId:0});if(r.identity.uid!==0||r.identity.gid!==0||(r.identity.mode&4095)!==0o600)fail();return r.value;};
export function createOwnedSuccessorFinalInputHost({releaseSha,journal,inspect=false}){
 if(process.getuid?.()!==0||!/^[a-f0-9]{40}$/.test(releaseSha??'')||releaseSha===P.releaseSha)fail();
 const root='/var/lib/blackspire-operator/preparation/owned-successor-final-'+releaseSha,files=createOwnedSourceSecurityFiles();if(!inspect)files.directory(root);
 const filename=n=>{if(!/^[a-z0-9.-]+\.json$/.test(n))fail();return root+'/'+n;};
 const read=n=>{const p=filename(n),v=files.read(p),pending=files.read(p+'.pending');if(v!==null&&pending!==null)fail();return v??pending;};
 let captured;
 const snapshot=async sha=>{
  verifyReleaseSource(sha);const currentMainSha=observeSuccessorMain(sha);const profile=readOwnedDatabaseProfile(),old=metadata(OLD);if(databaseProfileDigest(profile)!==P.profileDigest||old.schema!==2||old.releaseSha!==P.releaseSha||old.previousMainSha!==PREDECESSOR_MAIN||old.recoverySha!==RECOVERY||old.profileDigest!==P.profileDigest||old.sourceSecurityConfigurationFile!==F.sourceSecurityConfigurationFile||old.ownedMigrationConfigurationFile!==F.ownedMigrationConfigurationFile)fail();
  const originals={};for(const [key,p]of Object.entries(F)){originals[key]=metadata(p);if(hash(originals[key])!==D[key])fail();}
  const n8n=metadata(old.packageConfigurationFile),disk={...metadata(old.diskConfigurationFile),artifactRoot:'/opt/blackspire-command/releases/'+sha};
  if(disk.databasePath!=='/opt/blackspire-command/shared/database/command.sqlite'||disk.releaseRoot!=='/opt/blackspire-command')fail();
  const proof=await verifyReleaseArtifactDisk({releaseSha:sha,configuration:disk}),held=await observeOwnedMigrationPreparationHeld(journal);
  const oldBackup=readReleaseProtectedBytes(old.n8nBackupFile,2*1024*1024);captured={currentMainSha,profile,old,originals,n8n,disk,oldBackup};
  return {currentMainSha,oldInputDigest:hash(old),profileDigest:P.profileDigest,originalDigests:D,n8nDigest:hash(n8n),oldBackupDigest:hash(oldBackup),disk,artifactDigest:proof.artifact.artifactDigest,held};
 };
 const bundle=(plan,workflow)=>{const backupBytes=JSON.stringify(workflow.observation)+'\n',n8n={...captured.n8n,releaseSha:plan.releaseSha,backupSha256:hash(backupBytes)},source=captured.originals.sourceSecurityConfigurationFile;
  return {backupBytes,n8n,prepared:prepareOfflineReleaseBundle({releaseSha:plan.releaseSha,n8nConfiguration:n8n,providerManifest:source.providerManifest,creatorOid:source.sourceCreatorOid,backupBytes})};};
 const input=(plan,results)=>{const old=bindSuccessorMain(captured.old,captured.currentMainSha);const legacy=Object.fromEntries(['schema','kind','releaseSha','previousMainSha','recoverySha','workspace','principal','preparationRoot','packageConfigurationFile','n8nBackupFile','diskConfigurationFile','backupManifestFile','migrationConfigurationFile','activationConfigurationFile'].map(k=>[k,old[k]]));
  Object.assign(legacy,{schema:1,releaseSha:plan.releaseSha,packageConfigurationFile:root+'/bundle/n8n-configuration.json',n8nBackupFile:root+'/n8n-backup.json',diskConfigurationFile:root+'/disk.json',backupManifestFile:results.backup.manifestFile,migrationConfigurationFile:root+'/bundle/migration-input.json',activationConfigurationFile:root+'/activation-location.json'});
  return prepareOwnedSuccessorProductionReleaseInput({legacy,profile:captured.profile,operationId:plan.operationId});};
 const verify=async(stage,plan,results,value)=>{
  if(stage==='workflow'){const p=prepareN8nTransition({configuration:{...captured.n8n,releaseSha:plan.releaseSha},backupBytes:captured.oldBackup});let calls=0;const observed=await executeN8nTransition({plan:p,mode:'inspect',request:async(method,url,body)=>{if(method!=='GET'||url!==`/api/v1/workflows/${WORKFLOW_ID}`||body!==undefined)fail();calls++;return value.observation;},journal:{events:()=>[],append:()=>{}}});if(calls!==2||value.requests!==2||observed.mutationSent!==false||observed.state.kind!=='BASELINE'||observed.state.active!==true)fail();}
  else if(stage==='bundle'){const b=bundle(plan,results.workflow);if(value.manifestSha256!==b.prepared.manifestSha256)fail();for(const [name,bytes]of Object.entries(b.prepared.files))if(readReleaseProtectedBytes(root+'/bundle/'+name,2*1024*1024)!==bytes)fail();if(readReleaseProtectedBytes(root+'/n8n-backup.json',2*1024*1024)!==b.backupBytes)fail();}
  else if(stage==='backup'){if(typeof value.manifestFile!=='string'||!value.manifestFile.startsWith('/var/lib/blackspire-operator/preparation/zola-backups/'+plan.releaseSha+'-')||!value.manifestFile.endsWith('/manifest.json'))fail();verifyProtectedReleaseBackup({releaseSha:plan.releaseSha,manifestFile:value.manifestFile});}
  else{const expected=input(plan,results);if(value.productionInputFile!==root+'/production-release.json'||value.successorLineageFile!==expected.successorLineageFile||!same(metadata(value.productionInputFile),expected)||!same(metadata(root+'/disk.json'),captured.disk)||!same(metadata(root+'/activation-location.json'),{workspace:'blackspire-command',bindingFile:'/etc/blackspire/buyer-writer-binding.json'}))fail();}
 };
 const reconcile=async(stage,plan,results)=>{
  let value,paths;if(stage==='bundle'){const b=bundle(plan,results.workflow);value={manifestSha256:b.prepared.manifestSha256};paths=[root+'/n8n-backup.json',...Object.keys(b.prepared.files).map(name=>root+'/bundle/'+name)];}
  else if(stage==='input'){const expected=input(plan,results);value={productionInputFile:root+'/production-release.json',successorLineageFile:expected.successorLineageFile};paths=[root+'/disk.json',root+'/activation-location.json',value.productionInputFile];}else fail();
  // Observe only complete exact outputs; do not call either publication primitive.
  await synchronizeKnownSuccessorOutputs(paths,()=>verify(stage,plan,results,value));return value;
 };
 return {snapshot,read,reconcile,publish:(n,v)=>files.publish(filename(n),v),verify,async execute(stage,plan,results){if(inspect)fail();
  if(stage==='workflow'){const p=prepareN8nTransition({configuration:{...captured.n8n,releaseSha:plan.releaseSha},backupBytes:captured.oldBackup}),transport=createN8nTransport(readReleaseProtectedBytes('/var/lib/blackspire-operator/n8n-api-key',16384).trim());const rows=[];const observed=await executeN8nTransition({plan:p,mode:'inspect',request:async(method,url,body)=>{if(method!=='GET'||url!==`/api/v1/workflows/${WORKFLOW_ID}`||body!==undefined||rows.length>=2)fail();const v=await transport(method,url);rows.push(v);return v;},journal:{events:()=>[],append:()=>{}}});if(rows.length!==2||observed.mutationSent!==false||observed.state.kind!=='BASELINE'||observed.state.active!==true)fail();return {requests:2,observation:rows[1]};}
  if(stage==='bundle'){const b=bundle(plan,results.workflow);files.publish(root+'/n8n-backup.json',results.workflow.observation);writeOfflineReleaseBundle(root+'/bundle',b.prepared);return {manifestSha256:b.prepared.manifestSha256};}
  if(stage==='backup'){const v=captureProtectedReleaseBackup(plan.releaseSha);return {manifestFile:v.manifestFile};}
  const value=input(plan,results);files.publish(root+'/disk.json',captured.disk);files.publish(root+'/activation-location.json',{workspace:'blackspire-command',bindingFile:'/etc/blackspire/buyer-writer-binding.json'});files.publish(root+'/production-release.json',value);return {productionInputFile:root+'/production-release.json',successorLineageFile:value.successorLineageFile};
 }};
}
