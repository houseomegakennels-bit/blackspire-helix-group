import pg from 'pg';
import {openReleaseJournal} from '../zola-release/commander-journal.js';
import {verifyReleaseSource} from '../zola-release/commander-host.js';
import {readRootOwnedJsonSnapshot,readRootOwnedMetadataSnapshot} from './protected-json.js';
import * as database from './database-profile.js';
import {createOwnedSourceSecurityFiles} from './owned-source-security-host.js';
import {verifyOwnedBuyerMigrationQuiescence} from './owned-migration-host.js';
import {prepareOwnedSourceSecurityPackage,observeOwnedSourceSecurity} from './owned-source-security.js';
import {prepareOwnedTargetHardening,executeOwnedTargetHardening,observeOwnedTargetHardening} from './owned-target-hardening.js';
export const OWNED_TARGET_HARDENING_ROOT='/var/lib/blackspire-operator/owned-target-hardening';
const fail=()=>{throw new Error('Owned migration prerequisite host rejected; retain records and reconcile');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function snapshot(file,credential=false){const r=credential?readRootOwnedJsonSnapshot(file,{groupId:0,maxBytes:65536}):readRootOwnedMetadataSnapshot(file,{groupId:0});if(r.identity.uid!==0||r.identity.gid!==0||(r.identity.mode&0o7777)!==0o600)fail();return r;}
async function connect(config,ssl){const c=new pg.Client({...config,ssl,application_name:'blackspire-owned-migration-proof',connectionTimeoutMillis:5000,query_timeout:35000,options:'-c statement_timeout=30000 -c lock_timeout=5000 -c timezone=UTC -c search_path=pg_catalog'});c.on('error',()=>{});try{await c.connect();return c;}catch{try{await c.end();}catch{}fail();}}
function paths(input){
 if(!input||Object.keys(input).sort().join(',')!=='operationId,ownedMigrationConfigurationFile,profileDigest,releaseSha,sourceSecurityConfigurationFile'
 ||!(/^[a-f0-9]{40}$/).test(input.releaseSha??'')||!(/^[a-f0-9]{64}$/).test(input.profileDigest??'')
 ||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(input.operationId??'')
 ||input.sourceSecurityConfigurationFile!==`/var/lib/blackspire-operator/owned-source-security/${input.operationId}/configuration.json`
 ||input.ownedMigrationConfigurationFile!==`/var/lib/blackspire-operator/owned-buyer-migration/${input.operationId}/manifest.json`)fail();
 return {work:`${OWNED_TARGET_HARDENING_ROOT}/${input.operationId}`,copyRoot:`/var/lib/blackspire-operator/owned-buyer-migration/${input.operationId}`};
}
async function withPrerequisites(input,deps,action){
 const p=paths(input),read=deps.readSnapshot??snapshot,db=deps.database??database,verify=deps.verifySource??verifyReleaseSource;
 const profile=db.readOwnedDatabaseProfile();if(db.databaseProfileDigest(profile)!==input.profileDigest)fail();verify(input.releaseSha);
 const records=[input.sourceSecurityConfigurationFile,input.ownedMigrationConfigurationFile,p.copyRoot+'/intent.json',p.copyRoot+'/rollback.json'].map(file=>({file,record:read(file)}));
 const sourceCredential=read(db.LEGACY_DATABASE_MANAGEMENT,true),targetCredential=read(db.OWNED_DATABASE_MANAGEMENT,true);
 const sourceConfig=db.validateManagementCredential(sourceCredential.value,{pinLegacyCa:true}),targetConfig=db.validateManagementCredential(targetCredential.value,{ownedProfile:profile});
 const configuration=records[0].record.value,{migrationVersion,...sourceInput}=configuration;
 if(sourceInput.releaseSha!==input.releaseSha||sourceInput.operationId!==input.operationId||sourceInput.profileDigest!==input.profileDigest||!/^\d{14}$/.test(migrationVersion??''))fail();
 const sourcePlan=(deps.prepareSource??prepareOwnedSourceSecurityPackage)(sourceInput).plan;
 const migration=records[1].record.value,plan=(deps.prepareTarget??prepareOwnedTargetHardening)({...input,profile,migration});
 const {createHash}=await import('node:crypto');const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
 const digest=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
 const {prepareOwnedBuyerMigrationExecution,ownedBuyerMigrationReceipt}=await import('./owned-data-migration.js');
 if(digest(records[2].record.value)!==digest(ownedBuyerMigrationReceipt(prepareOwnedBuyerMigrationExecution(migration)))||digest(records[3].record.value)!==migration.rollbackDigest
 ||migration.source.clusterId!==sourceInput.sourceSystemIdentifier||migration.target.clusterId!==profile.systemIdentifier)fail();
 const fence=async()=>{verify(input.releaseSha);if(db.databaseProfileDigest(db.readOwnedDatabaseProfile())!==input.profileDigest
 ||!same(read(db.LEGACY_DATABASE_MANAGEMENT,true),sourceCredential)||!same(read(db.OWNED_DATABASE_MANAGEMENT,true),targetCredential)
 ||records.some(({file,record})=>!same(read(file),record)))fail();};
 let source,target;try{await fence();source=await(deps.connect??connect)(sourceConfig,db.databaseTlsOptions(sourceConfig));target=await(deps.connect??connect)(targetConfig,db.databaseTlsOptions(targetConfig));
 const sourceProof=await(deps.observeSource??observeOwnedSourceSecurity)(source,sourcePlan,migrationVersion);if(!sourceProof||sourceProof.status!=='OWNED_SOURCE_SECURITY_VERIFIED'||sourceProof.profileDigest!==input.profileDigest||sourceProof.operationId!==input.operationId||digest(sourceProof)!==migration.source.quiescenceDigest)fail();
 const result=await action({p,plan,target,fence,sourceProof});
 const after=await(deps.observeSource??observeOwnedSourceSecurity)(source,sourcePlan,migrationVersion);if(!same(after,sourceProof))fail();await fence();return result;
 }finally{try{await target?.end();}finally{await source?.end();}}
}
// Safe after acceptance inserts and intended bounded roles exist: proves the
// retained copy/hardening receipts and CURRENT source freeze/target browser ACL.
// It does not claim current rows still equal the pre-acceptance copy snapshot.
export async function observeOwnedMigrationPrerequisites(input,deps={}){
 return withPrerequisites(input,deps,async({p,plan,target,fence,sourceProof})=>{
 const read=deps.readSnapshot??snapshot,retained=read(p.work+'/plan.json');if(!same(retained.value,plan))fail();await fence();
 const targetProof=await(deps.observeTarget??observeOwnedTargetHardening)(target,plan);if(!targetProof||targetProof.status!=='OWNED_TARGET_HARDENING_VERIFIED'||targetProof.releaseSha!==plan.releaseSha||targetProof.operationId!==plan.operationId||targetProof.profileDigest!==plan.profileDigest||targetProof.copyManifestDigest!==plan.copyManifestDigest||targetProof.bodySha256!==plan.bodySha256||targetProof.rowsPreserved!==true)fail();
 if(!same(read(p.work+'/plan.json'),retained))fail();return Object.freeze({status:'OWNED_MIGRATION_PREREQUISITES_VERIFIED',releaseSha:input.releaseSha,operationId:input.operationId,profileDigest:input.profileDigest,
 sourceSecurityManifestDigest:sourceProof.manifestDigest,copyManifestDigest:plan.copyManifestDigest,targetHardeningBodySha256:plan.bodySha256,sourceWritesDenied:true,targetBrowserSecurityVerified:true,originalSourceMigrationsReapplied:false});
 });
}
export async function runOwnedTargetHardening({mode,...input},deps={}){
 if(!['apply','reconcile'].includes(mode)||(deps.uid??process.getuid)()!==0)fail();const guard=(deps.openGlobal??openReleaseJournal)();let local;
 try{return await withPrerequisites(input,deps,async({p,plan,target,fence})=>{
 const files=deps.files??createOwnedSourceSecurityFiles(),stopped=deps.stopped??verifyOwnedBuyerMigrationQuiescence;
 stopped();if(mode==='reconcile'&&!same(files.read(p.work+'/plan.json'),plan))fail();files.directory(p.work);local=(deps.openLocal??openReleaseJournal)({root:p.work});files.publish(p.work+'/plan.json',plan);
 const executionFence=async()=>{await fence();stopped();if(!same(files.read(p.work+'/plan.json'),plan))fail();};
 return(deps.execute??executeOwnedTargetHardening)({client:target,plan,mode,journal:local.stream('release'),fence:executionFence});
 });}finally{try{local?.close();}finally{guard.close();}}
}

export async function verifyOwnedTargetHardeningForStore({releaseSha,operationId,profile},deps={}){
 const validated=(deps.database??database).validateOwnedDatabaseProfile(profile);
 return observeOwnedMigrationPrerequisites({releaseSha,operationId,profileDigest:(deps.database??database).databaseProfileDigest(validated),
 sourceSecurityConfigurationFile:`/var/lib/blackspire-operator/owned-source-security/${operationId}/configuration.json`,
 ownedMigrationConfigurationFile:`/var/lib/blackspire-operator/owned-buyer-migration/${operationId}/manifest.json`},deps);
}
