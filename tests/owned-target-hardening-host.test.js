import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {OWNED_BUYER_RELATIONS,OWNED_BUYER_FOREIGN_KEYS,prepareOwnedBuyerMigrationExecution,ownedBuyerMigrationReceipt} from '../packages/buyer-writer/owned-data-migration.js';
import {prepareOwnedTargetHardening} from '../packages/buyer-writer/owned-target-hardening.js';
import {observeOwnedMigrationPrerequisites,verifyOwnedTargetHardeningForStore} from '../packages/buyer-writer/owned-target-hardening-host.js';
import {OWNED_POSTGRES_TARGET,ownedPostgresProfileDigest} from '../packages/buyer-writer/owned-postgres.js';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const h='a'.repeat(64),releaseSha='b'.repeat(40),operationId='11111111-1111-4111-8111-111111111111';
function fixture(){
 const profile={version:1,...OWNED_POSTGRES_TARGET,creatorOid:16401,systemIdentifier:'2234567890123456789',caSha256:h},profileDigest=ownedPostgresProfileDigest(profile);
 const input={releaseSha,operationId,profileDigest,sourceSecurityConfigurationFile:`/var/lib/blackspire-operator/owned-source-security/${operationId}/configuration.json`,ownedMigrationConfigurationFile:`/var/lib/blackspire-operator/owned-buyer-migration/${operationId}/manifest.json`};
 const source={status:'OWNED_SOURCE_SECURITY_VERIFIED',releaseSha,operationId,profileDigest,manifestDigest:h};const rollback={retained:true};
 const migration={releaseSha,source:{clusterId:'1234567890123456789',database:'postgres',snapshotId:'00000001-00000002-1',snapshotDigest:h,quiescenceDigest:hash(source)},target:{kind:'owned-postgres-v1',clusterId:profile.systemIdentifier,database:'postgres',profileDigest,schemaDigest:h},rollbackDigest:hash(rollback),
 inventory:{schemaDigest:h,relations:OWNED_BUYER_RELATIONS.map(name=>({schema:'public',name,owner:'postgres',rls:true,forceRls:false,primaryKey:['id'],rowCount:1,dataDigest:h,definitionDigest:h})),foreignKeys:OWNED_BUYER_FOREIGN_KEYS.map(([from,column,to,onDelete],i)=>({name:`fk_${i}`,from,to,columns:[column],referencedColumns:['id'],onDelete,definitionDigest:h})),dependencies:[{kind:'function',identity:'auth.uid()',definitionDigest:h}]}};
 const plan=prepareOwnedTargetHardening({releaseSha,operationId,profile,migration});
 const records=new Map([[input.sourceSecurityConfigurationFile,{releaseSha,operationId,profileDigest,sourceSystemIdentifier:migration.source.clusterId,migrationVersion:'20260921150000'}],[input.ownedMigrationConfigurationFile,migration],
 [input.ownedMigrationConfigurationFile.replace('manifest.json','intent.json'),ownedBuyerMigrationReceipt(prepareOwnedBuyerMigrationExecution(migration))],
 [input.ownedMigrationConfigurationFile.replace('manifest.json','rollback.json'),rollback],
 [`/var/lib/blackspire-operator/owned-target-hardening/${operationId}/plan.json`,plan],['source-credential',{}],['target-credential',{}]]);
 let connects=0,ends=0,sourceCalls=0,targetCalls=0;
 const deps={database:{readOwnedDatabaseProfile:()=>profile,databaseProfileDigest:ownedPostgresProfileDigest,validateOwnedDatabaseProfile:v=>v,LEGACY_DATABASE_MANAGEMENT:'source-credential',OWNED_DATABASE_MANAGEMENT:'target-credential',validateManagementCredential:()=>({}),databaseTlsOptions:()=>({})},
 verifySource:()=>{},prepareSource:()=>({plan:{}}),readSnapshot:file=>{assert.ok(records.has(file));return structuredClone({value:records.get(file),identity:{uid:0,gid:0,mode:0o600}});},
 connect:async()=>{connects++;return{end:async()=>{ends++;}};},observeSource:async()=>{sourceCalls++;return structuredClone(source);},observeTarget:async()=>{targetCalls++;return{...plan,status:'OWNED_TARGET_HARDENING_VERIFIED',rowsPreserved:true};}};
 return{input,profile,records,source,deps,stats:()=>({connects,ends,sourceCalls,targetCalls})};
}
test('post-admission observer binds both fixed connections and immutable source/copy/rollback/target proofs without taking global guard',async()=>{
 const f=fixture(),result=await observeOwnedMigrationPrerequisites(f.input,f.deps);assert.equal(result.status,'OWNED_MIGRATION_PREREQUISITES_VERIFIED');assert.equal(result.originalSourceMigrationsReapplied,false);
 assert.deepEqual(f.stats(),{connects:2,ends:2,sourceCalls:2,targetCalls:1});
 assert.equal((await verifyOwnedTargetHardeningForStore({releaseSha,operationId,profile:f.profile},f.deps)).copyManifestDigest,result.copyManifestDigest);
});
test('wrong operation paths and retained copy contradiction reject before any connection; current source drift closes both clients',async()=>{
 const f=fixture();await assert.rejects(observeOwnedMigrationPrerequisites({...f.input,operationId:'22222222-2222-4222-8222-222222222222'},f.deps));assert.equal(f.stats().connects,0);
 const key=f.input.ownedMigrationConfigurationFile.replace('manifest.json','intent.json');f.records.set(key,{});await assert.rejects(observeOwnedMigrationPrerequisites(f.input,f.deps));assert.equal(f.stats().connects,0);
 const g=fixture();g.deps.observeSource=async()=>({...g.source,manifestDigest:'f'.repeat(64)});await assert.rejects(observeOwnedMigrationPrerequisites(g.input,g.deps));assert.equal(g.stats().ends,2);assert.equal(g.stats().targetCalls,0);
});
