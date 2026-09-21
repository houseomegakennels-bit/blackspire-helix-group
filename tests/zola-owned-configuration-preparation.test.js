import test from 'node:test';import assert from 'node:assert/strict';
import {prepareOwnedCollectorConfiguration} from '../packages/zola-six-reads/configuration-preparation.js';
import {prepareOwnedProductionReleaseInput,ownedReleaseOperationId} from '../packages/zola-release/owned-release-input-preparation.js';
import {OWNED_POSTGRES_TARGET,ownedPostgresProfileDigest} from '../packages/buyer-writer/owned-postgres.js';
const sha='a'.repeat(40),op='11111111-1111-4111-8111-111111111111';
const profile={version:1,...OWNED_POSTGRES_TARGET,creatorOid:16385,systemIdentifier:'7000000000000000001',caSha256:'c'.repeat(64)},profileDigest=ownedPostgresProfileDigest(profile);
const target={schema:1,kind:'zola_owned_bounded_writer_acceptance_target',backendProfile:'owned-postgres-v1',profileDigest,releaseSha:sha,workspace:'blackspire-command',principal:'blackspire-release-root',capability:'buyer.writer.acceptance',jobId:op,ownerId:'22222222-2222-4222-8222-222222222222',criteria:{state:'FL',county:'Zola Acceptance',property_type:'acceptance',date_range_start:'2026-01-01',date_range_end:'2026-01-02',min_purchases:1,cash_buyers_only:false,llc_buyers_only:false},updatedAt:'2026-09-21T00:00:00.000000Z'};
const base={version:4,releaseSha:sha,frontendOrigin:'https://exact-preview.vercel.app',workspace:'blackspire-command',principal:'blackspire-operator',deniedPrincipal:'zola-denied',dealId:'DE-0001',apiPid:101,workerPid:102,port:8789,databasePath:'/var/lib/blackspire-command/db.sqlite',credentialPath:'/var/lib/blackspire-operator/session.json',journalDirectory:'/var/lib/blackspire-operator/observations',runId:op,observerDatabaseConfigPath:'/etc/blackspire-buyer-writer-gateway/management.json',denialReceiptPath:'/var/lib/blackspire-operator/denied.json'};
test('collector builder preserves observed sessions, processes and stage epoch while explicitly selecting owned versions',()=>{
 for(const version of [4,5]){const configuration={...base,version,...(version===5?{frontendOrigin:'https://blackspirehelix.com',releaseRunId:op}:{})};
 const result=prepareOwnedCollectorConfiguration({configuration,profile,target});assert.equal(result.version,version+2);assert.equal(result.acceptanceSearchJobId,target.jobId);assert.equal(result.profileDigest,profileDigest);
 for(const k of Object.keys(configuration))if(k!=='version')assert.deepEqual(result[k],configuration[k]);assert.equal(Object.hasOwn(result,'ownerId'),false);
 }
 for(const patch of [{releaseSha:'b'.repeat(40)},{profileDigest:'f'.repeat(64)},{ownerId:'bad'},{criteria:{...target.criteria,county:'Customer'}}])assert.throws(()=>prepareOwnedCollectorConfiguration({configuration:base,profile,target:{...target,...patch}}));
 assert.throws(()=>prepareOwnedCollectorConfiguration({configuration:{...base,version:5,releaseRunId:op},profile,target}));
});
test('production builder preserves legacy package fields and derives one exact source/copy operation',()=>{
 const legacy={schema:1,kind:'zola_production_release',releaseSha:sha,previousMainSha:'b'.repeat(40),recoverySha:'c'.repeat(40),workspace:'zola-production',principal:'blackspire-release-root',preparationRoot:'/var/lib/blackspire-operator/preparation'};
 for(const k of ['packageConfigurationFile','n8nBackupFile','diskConfigurationFile','backupManifestFile','migrationConfigurationFile','activationConfigurationFile'])legacy[k]='/var/lib/blackspire-operator/preparation/'+k+'.json';
 const result=prepareOwnedProductionReleaseInput({legacy,profile,operationId:op});assert.equal(result.schema,2);assert.equal(ownedReleaseOperationId(result),op);for(const k of Object.keys(legacy))if(k!=='schema')assert.equal(result[k],legacy[k]);
 assert.throws(()=>prepareOwnedProductionReleaseInput({legacy:{...legacy,migrationConfigurationFile:'/tmp/other'},profile,operationId:op}));
 assert.throws(()=>ownedReleaseOperationId({...result,ownedMigrationConfigurationFile:result.ownedMigrationConfigurationFile.replace(op,'22222222-2222-4222-8222-222222222222')}));
});
