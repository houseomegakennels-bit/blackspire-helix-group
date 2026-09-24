import {runOwnedBuyerMigration} from '../packages/buyer-writer/owned-migration-host.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import pg from 'pg';
import {prepareOwnedBuyerSchema} from '../packages/buyer-writer/owned-schema.js';
import {holdOwnedBuyerSourceSnapshot,inspectOwnedBuyerDataSnapshot,transferOwnedBuyerRelation} from '../packages/buyer-writer/owned-data-copy-postgres.js';
import {OWNED_BUYER_COPY_ORDER} from '../packages/buyer-writer/owned-data-migration.js';
assert.equal(process.env.ZOLA_DISPOSABLE_EXECUTOR,'1');assert.equal(process.versions.node,'22.23.1');
const ports=JSON.parse(fs.readFileSync(0,'utf8'));assert.ok([ports.source,ports.target].every(p=>/^172\.[0-9]+\.[0-9]+\.[0-9]+$/.test(p)));assert.notEqual(ports.source,ports.target);
const clients=[];const connect=async (database,user='postgres')=>{const c=new pg.Client({host:database==='owned_fixture'?ports.target:ports.source,port:5432,user,database:'postgres',connectionTimeoutMillis:2000,query_timeout:35000});await c.connect();clients.push(c);return c;};
try{
 for(const database of ['postgres','owned_fixture']){const boot=await connect(database,'blackspire_cluster_admin');await boot.query('CREATE ROLE postgres LOGIN NOSUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS;ALTER DATABASE postgres OWNER TO postgres;GRANT EXECUTE ON FUNCTION pg_control_system() TO postgres;GRANT ALL ON SCHEMA public TO postgres');await boot.end();}
 const source=await connect('postgres');
 const body=prepareOwnedBuyerSchema(JSON.parse(fs.readFileSync(new URL('../packages/buyer-writer/owned-source-schema.json',import.meta.url)))).body;
 await source.query(body);
 const target=await connect('owned_fixture');await target.query(body);
 const owner='00000000-0000-4000-8000-000000000001',job='00000000-0000-4000-8000-000000000002',buyer='00000000-0000-4000-8000-000000000003';
 await source.query('INSERT INTO public."SearchJob"(id,user_id,state,county,property_type) VALUES($1,$2,$3,$4,$5)',[job,owner,'TX','Synthetic','home']);
 await source.query('INSERT INTO public."BuyerProfile"(id,buyer_name,total_spend,updated_at) VALUES($1,$2,123456789012345678901234567890.1234567890123456789,$3)',[buyer,'Synthetic','2026-09-21T00:00:00.123456Z']);
 await source.query('INSERT INTO public."BuyerReport"(search_job_id,buyer_profile_id) VALUES($1,$2)',[job,buyer]);
 for(const name of ['RawSale','CleanSale'])await source.query(`INSERT INTO public."${name}"(search_job_id) VALUES($1)`,[job]);
 await source.query('INSERT INTO public.exports(user_id,search_job_id,file_name,storage_path) VALUES($1,$2,$3,$4)',[owner,job,'fixture.csv','synthetic/path']);
 await target.end();await source.end();
 const admin=await connect('owned_fixture');await admin.query('DROP SCHEMA public CASCADE;DROP SCHEMA auth CASCADE;CREATE SCHEMA public;DROP ROLE anon;DROP ROLE authenticated;DROP ROLE service_role');
 const targetId=(await admin.query('SELECT (pg_control_system()).system_identifier::text AS id')).rows[0].id;await admin.end();
 const sourceAdmin=await connect('postgres');
 const sourceId=(await sourceAdmin.query('SELECT (pg_control_system()).system_identifier::text AS id')).rows[0].id;
 await sourceAdmin.query('REVOKE INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES ON public."SearchJob",public."BuyerProfile",public."BuyerReport",public."RawSale",public."CleanSale",public.exports FROM anon,authenticated,service_role');await sourceAdmin.end();
 const releaseSha='a'.repeat(40),operationId='00000000-0000-4000-8000-000000000099',profileDigest='b'.repeat(64),manifestDigest='c'.repeat(64);
 const profile={systemIdentifier:targetId},sourceInput={releaseSha,operationId,profileDigest,sourceSystemIdentifier:sourceId,sourceCreatorOid:10,providerManifest:{}},migrationVersion='20260921000000';
 const proof={kind:'owned-buyer-source-security-proof-v1',status:'OWNED_SOURCE_SECURITY_VERIFIED',releaseSha,operationId,profileDigest,manifestDigest,sourceWritesDenied:true,sourceBrowserSecurityVerified:true,sourceProviderAclChanged:false};
 const memory=new Map(),baseline=JSON.parse(fs.readFileSync(new URL('../packages/buyer-writer/owned-source-schema.json',import.meta.url)));
 const checkFreeze=async client=>{const r=await client.query(`SELECT NOT EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN (VALUES('anon'),('authenticated'),('service_role')) role(name) WHERE n.nspname='public' AND c.relkind='r' AND (has_table_privilege(role.name,c.oid,'INSERT') OR has_table_privilege(role.name,c.oid,'UPDATE') OR has_table_privilege(role.name,c.oid,'DELETE'))) AS frozen`);assert.equal(r.rows[0].frozen,true);return proof;};
 const deps={openReleaseGuard:()=>({close(){}}),uid:()=>0,verifySource:()=>true,stopped:()=>true,directory:()=>{},retained:p=>memory.get(p)??null,publish:(p,v)=>{assert.equal(memory.has(p),false);memory.set(p,structuredClone(v));},
 read:p=>p.endsWith('configuration.json')?{...sourceInput,migrationVersion}:p.endsWith('rollback.json')?{releaseSha,operationId,sourceSystemIdentifier:sourceId,sourcePreserved:true}:p==='source-management'?{fixture:'source'}:p==='target-management'?{fixture:'target'}:assert.fail('unknown protected input'),
 database:{readOwnedDatabaseProfile:()=>profile,databaseProfileDigest:()=>profileDigest,LEGACY_DATABASE_MANAGEMENT:'source-management',OWNED_DATABASE_MANAGEMENT:'target-management',validateManagementCredential:v=>v,databaseTlsOptions:()=>({fixture:true}),verifyOwnedDatabaseIdentity:async c=>assert.equal((await c.query('SELECT (pg_control_system()).system_identifier::text AS id')).rows[0].id,targetId)},
 security:{prepareOwnedSourceSecurityPackage:()=>({plan:{}}),observeOwnedSourceSecurity:checkFreeze,validateOwnedSourceSecurityInTransaction:checkFreeze},
 connect:async config=>{const c=await connect(config.fixture==='target'?'owned_fixture':'postgres');const query=c.query.bind(c);if(config.fixture==='source')c.query=async(...args)=>{const value=await query(...args);if(typeof args[0]==='string'&&args[0].includes("'authUid'"))value.rows[0].metadata.authUid=baseline.authUid;return value;};return c;}};
 assert.equal((await runOwnedBuyerMigration({releaseSha,operationId,mode:'apply'},deps)).status,'OWNED_BUYER_DATA_COMMITTED');
 assert.equal((await runOwnedBuyerMigration({releaseSha,operationId,mode:'reconcile'},deps)).status,'OWNED_BUYER_DATA_RECONCILED');
 const verify=await connect('owned_fixture');assert.equal((await verify.query('SELECT count(*)::int AS n FROM owned_buyer_migration.copy_receipts')).rows[0].n,1);
 assert.equal((await verify.query('SELECT count(*)::int AS n FROM public."SearchJob"')).rows[0].n,1);
 await verify.query('UPDATE owned_buyer_migration.copy_receipts SET receipt=receipt||jsonb_build_object(\'manifestDigest\',\'tampered\')');await verify.end();
 await assert.rejects(runOwnedBuyerMigration({releaseSha,operationId,mode:'reconcile'},deps));
 console.log(JSON.stringify({status:'PASS',checks:['native host copy and atomic receipt','read-only retained receipt reconciliation','tampered receipt refusal','effective source grants frozen'],modeled:['root profile and files','systemd','source security history receipt and auth owner'],productionConnections:0}));
}finally{for(const c of clients)try{await c.end();}catch{}}
