import {proveOwnedWriterProvisioning} from './test-owned-writer-provision-helper.mjs';
import {createHash} from 'node:crypto';
import {createBuyerStoreRepository} from '../packages/buyer-store/repository.js';
import {prepareOwnedTargetHardening,executeOwnedTargetHardening} from '../packages/buyer-writer/owned-target-hardening.js';
import {databaseProfileDigest,verifyOwnedDatabaseIdentity} from '../packages/buyer-writer/database-profile.js';
import * as security from '../packages/buyer-writer/owned-source-security.js';
import {EXTENSION_ACL_CATALOG_SQL} from '../packages/buyer-writer/extension-acl-catalog.js';
import {prepareBuyerWriterExtensionAcl} from '../packages/buyer-writer/extension-acl.js';
import {OWNED_POSTGRES_BOOTSTRAP_SQL,OWNED_POSTGRES_TEMPLATE_SQL,OWNED_POSTGRES_TARGET} from '../packages/buyer-writer/owned-postgres.js';
import {WRITER_IDENTITY_SQL} from '../packages/buyer-writer/postgres.js';
import {BUYER_WRITER_ENTRYPOINTS,BUYER_WRITER_ROUTINES} from '../packages/buyer-writer/routine-policy.js';
import {runOwnedBuyerMigration} from '../packages/buyer-writer/owned-migration-host.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import pg from 'pg';
import {prepareOwnedBuyerSchema} from '../packages/buyer-writer/owned-schema.js';
import {inspectOwnedBuyerDataSnapshot} from '../packages/buyer-writer/owned-data-copy-postgres.js';
assert.equal(process.env.ZOLA_DISPOSABLE_EXECUTOR,'1');assert.equal(process.versions.node,'22.23.1');
const ports=JSON.parse(fs.readFileSync(0,'utf8'));assert.ok([ports.source,ports.target].every(p=>/^172\.[0-9]+\.[0-9]+\.[0-9]+$/.test(p)));assert.notEqual(ports.source,ports.target);
const rolePasswords=new Map();
const clients=[];const connect=async (database,user='postgres')=>{const c=new pg.Client({host:['owned_fixture','template1'].includes(database)?ports.target:ports.source,port:5432,user,password:rolePasswords.get(user),database:database==='template1'?'template1':'postgres',connectionTimeoutMillis:2000,query_timeout:35000});await c.connect();clients.push(c);return c;};
try{
 const sourceAdminBoot=await connect('postgres','blackspire_cluster_admin');await sourceAdminBoot.query('CREATE ROLE postgres LOGIN SUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS;ALTER DATABASE postgres OWNER TO postgres');
 const targetAdminBoot=await connect('owned_fixture','blackspire_cluster_admin'),template=await connect('template1','blackspire_cluster_admin');await template.query(OWNED_POSTGRES_TEMPLATE_SQL);await template.end();await targetAdminBoot.query(OWNED_POSTGRES_BOOTSTRAP_SQL);await targetAdminBoot.query('ALTER ROLE postgres LOGIN');await targetAdminBoot.end();
 const source=await connect('postgres');
 const body=prepareOwnedBuyerSchema(JSON.parse(fs.readFileSync(new URL('../packages/buyer-writer/owned-source-schema.json',import.meta.url)))).body;
 await source.query(body);
 const target=await connect('owned_fixture');
 const owner='00000000-0000-4000-8000-000000000001',job='00000000-0000-4000-8000-000000000002',buyer='00000000-0000-4000-8000-000000000003';
 await source.query('INSERT INTO public."SearchJob"(id,user_id,state,county,property_type) VALUES($1,$2,$3,$4,$5)',[job,owner,'TX','Synthetic','home']);
 await source.query('INSERT INTO public."BuyerProfile"(id,buyer_name,total_spend,updated_at) VALUES($1,$2,123456789012345678901234567890.1234567890123456789,$3)',[buyer,'Synthetic','2026-09-21T00:00:00.123456Z']);
 await source.query('INSERT INTO public."BuyerReport"(search_job_id,buyer_profile_id) VALUES($1,$2)',[job,buyer]);
 for(const name of ['RawSale','CleanSale'])await source.query(`INSERT INTO public."${name}"(search_job_id) VALUES($1)`,[job]);
 await source.query('INSERT INTO public.exports(user_id,search_job_id,file_name,storage_path) VALUES($1,$2,$3,$4)',[owner,job,'fixture.csv','synthetic/path']);
 await target.end();await source.end();
 const admin=await connect('owned_fixture');
 const targetId=(await admin.query('SELECT (pg_control_system()).system_identifier::text AS id')).rows[0].id;const targetCreatorOid=(await admin.query("SELECT oid::int AS id FROM pg_roles WHERE rolname='postgres'")).rows[0].id;await admin.end();
 const sourceAdmin=await connect('postgres');
 const sourceId=(await sourceAdmin.query('SELECT (pg_control_system()).system_identifier::text AS id')).rows[0].id;
  // Inert stand-ins reproduce ACL semantics; no extension/network function runs.
  await sourceAdmin.query(`create role supabase_admin nologin;create role consumer nologin;create role observer nologin;
   create schema net authorization supabase_admin;create schema extensions;
   grant usage on schema net,extensions to public;
   set role supabase_admin;
   create table net._http_response(id integer);create table net.http_request_queue(id integer);
   create sequence net.http_request_queue_id_seq;
   grant all on all tables in schema net to public;grant all on all sequences in schema net to public;
   reset role;
   create view extensions.pg_stat_statements as select 1 as id;
   create view extensions.pg_stat_statements_info as select 1 as id;
   grant select on extensions.pg_stat_statements,extensions.pg_stat_statements_info to public;`);
  for(const fn of ['_await_response','_encode_url_with_params_array','_http_collect_response','_urlencode_string','check_worker_is_up','http_collect_response','http_delete','http_get','http_post','wait_until_running','wake','worker_restart'])
   await sourceAdmin.query(`set role supabase_admin;create function net.${fn}() returns integer language sql as 'select null::integer';`);
  await sourceAdmin.query(`set role supabase_admin;grant execute on function net.http_get() to consumer with grant option;
   set role consumer;grant execute on function net.http_get() to observer;reset role;
   grant consumer to observer with inherit true,set true;`);

 const baseline=JSON.parse(fs.readFileSync(new URL('../packages/buyer-writer/owned-source-schema.json',import.meta.url)));
 await sourceAdmin.query('CREATE ROLE supabase_auth_admin NOLOGIN;CREATE ROLE dashboard_user NOLOGIN;ALTER SCHEMA auth OWNER TO supabase_auth_admin;GRANT USAGE ON SCHEMA auth TO postgres;');
 await sourceAdmin.query(baseline.authUid.definition);
 await sourceAdmin.query('ALTER FUNCTION auth.uid() OWNER TO supabase_auth_admin;REVOKE ALL ON FUNCTION auth.uid() FROM PUBLIC,postgres,anon,authenticated,service_role,supabase_auth_admin;SET ROLE supabase_auth_admin;GRANT EXECUTE ON FUNCTION auth.uid() TO PUBLIC,supabase_auth_admin,dashboard_user;RESET ROLE;');
 await sourceAdmin.query(fs.readFileSync(new URL('../tests/fixtures/buyer-writer/nexus.sql',import.meta.url),'utf8'));
 await sourceAdmin.query('CREATE SCHEMA supabase_migrations;CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text,statements text[],idempotency_key text UNIQUE);GRANT EXECUTE ON FUNCTION pg_control_system() TO postgres;');
 await sourceAdminBoot.query('ALTER ROLE postgres NOSUPERUSER');await sourceAdminBoot.end();
 const sourceCreatorOid=(await sourceAdmin.query("SELECT oid::int AS id FROM pg_roles WHERE rolname='postgres'")).rows[0].id;
 const inventory=(await sourceAdmin.query(EXTENSION_ACL_CATALOG_SQL)).rows[0].metadata;
 const effective=(await sourceAdmin.query(`with c as (${EXTENSION_ACL_CATALOG_SQL}), o as (select value from c,jsonb_array_elements(metadata->'objects'))
 select jsonb_agg(jsonb_build_array(r.rolname,o.value->>'schema',o.value->>'name',o.value->>'kind',o.value->'arguments',p,
 case when o.value->>'kind'='function' then has_function_privilege(r.oid,(o.value->>'oid')::oid,p) when o.value->>'kind'='S' then has_sequence_privilege(r.oid,(o.value->>'oid')::oid,p) else has_table_privilege(r.oid,(o.value->>'oid')::oid,p) end,
 case when o.value->>'kind'='function' then has_function_privilege(r.oid,(o.value->>'oid')::oid,p||' WITH GRANT OPTION') when o.value->>'kind'='S' then has_sequence_privilege(r.oid,(o.value->>'oid')::oid,p||' WITH GRANT OPTION') else has_table_privilege(r.oid,(o.value->>'oid')::oid,p||' WITH GRANT OPTION') end)
 order by r.rolname,o.value->>'schema',o.value->>'name',p) AS value
 from pg_roles r cross join o cross join lateral unnest(case when o.value->>'kind'='function' then array['EXECUTE'] when o.value->>'kind'='S' then array['SELECT','UPDATE','USAGE'] else array['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE'] end) p`)).rows[0].value;
 const schemaEffective=(await sourceAdmin.query(`select jsonb_agg(jsonb_build_array(rolname,s,has_schema_privilege(rolname,s,'USAGE'),has_schema_privilege(rolname,s,'CREATE')) order by rolname,s) AS value from pg_roles cross join unnest(array['extensions','net']) s`)).rows[0].value;
 const providerManifest=prepareBuyerWriterExtensionAcl({inventory,columns:inventory,effective:{effective,schemaEffective}}).manifest;
 const releaseSha='a'.repeat(40),operationId='00000000-0000-4000-8000-000000000099';
 const ca=fs.readFileSync(new URL('../tests/fixtures/buyer-writer/supabase-production-ca.crt',import.meta.url),'utf8');
 const profile={version:1,...OWNED_POSTGRES_TARGET,creatorOid:targetCreatorOid,systemIdentifier:targetId,caSha256:createHash('sha256').update(ca).digest('hex')},profileDigest=databaseProfileDigest(profile),sourceInput={releaseSha,operationId,profileDigest,sourceSystemIdentifier:sourceId,sourceCreatorOid,providerManifest},migrationVersion='20260921000000';
 const sourcePlan=security.prepareOwnedSourceSecurityPackage(sourceInput).plan,events=[];
 assert.equal((await security.executeOwnedSourceSecurity({client:sourceAdmin,plan:sourcePlan,mode:'apply',migrationVersion,journal:{events:()=>structuredClone(events),append:v=>events.push(structuredClone(v))},fence:async()=>{}})).status,'OWNED_SOURCE_SECURITY_COMMITTED');
 assert.equal((await security.observeOwnedSourceSecurity(sourceAdmin,sourcePlan,migrationVersion)).status,'OWNED_SOURCE_SECURITY_VERIFIED');await sourceAdmin.end();
 const memory=new Map();
 const deps={openReleaseGuard:()=>({close(){}}),uid:()=>0,verifySource:()=>true,stopped:()=>true,directory:()=>{},retained:p=>memory.get(p)??null,publish:(p,v)=>{assert.equal(memory.has(p),false);memory.set(p,structuredClone(v));},
 read:p=>p.endsWith('configuration.json')?{...sourceInput,migrationVersion}:p.endsWith('rollback.json')?{releaseSha,operationId,sourceSystemIdentifier:sourceId,sourcePreserved:true}:p==='source-management'?{fixture:'source'}:p==='target-management'?{fixture:'target'}:assert.fail('unknown protected input'),
 database:{readOwnedDatabaseProfile:()=>profile,databaseProfileDigest:()=>profileDigest,LEGACY_DATABASE_MANAGEMENT:'source-management',OWNED_DATABASE_MANAGEMENT:'target-management',validateManagementCredential:v=>v,databaseTlsOptions:()=>({fixture:true}),verifyOwnedDatabaseIdentity},
 security,connect:async config=>connect(config.fixture==='target'?'owned_fixture':'postgres')};
 assert.equal((await runOwnedBuyerMigration({releaseSha,operationId,mode:'apply'},deps)).status,'OWNED_BUYER_DATA_COMMITTED');
 assert.equal((await runOwnedBuyerMigration({releaseSha,operationId,mode:'reconcile'},deps)).status,'OWNED_BUYER_DATA_RECONCILED');
 // Native pre-read rejection: unexpected receipt DDL and manager drift must never reach the receipt SELECT.
 const originalConnect=deps.connect;let receiptReads=0;
 deps.connect=async config=>{const c=await originalConnect(config),query=c.query.bind(c);c.query=async(text,...args)=>{if(text==='SELECT receipt FROM owned_buyer_migration.copy_receipts WHERE operation_id=$1')receiptReads++;return query(text,...args);};return c;};
 const mutate=async(sql)=>{const c=await connect('owned_fixture','blackspire_cluster_admin');try{await c.query(sql);}finally{await c.end();}};
 for(const [bad,restore] of [
  ['ALTER TABLE owned_buyer_migration.copy_receipts ENABLE ROW LEVEL SECURITY','ALTER TABLE owned_buyer_migration.copy_receipts DISABLE ROW LEVEL SECURITY'],
  ['ALTER TABLE owned_buyer_migration.copy_receipts ADD CHECK (true)','ALTER TABLE owned_buyer_migration.copy_receipts DROP CONSTRAINT copy_receipts_check'],
  ['ALTER ROLE postgres NOBYPASSRLS','ALTER ROLE postgres BYPASSRLS'],
 ]){await mutate(bad);receiptReads=0;await assert.rejects(runOwnedBuyerMigration({releaseSha,operationId,mode:'reconcile'},deps));assert.equal(receiptReads,0);await mutate(restore);}
 const originalRead=deps.read;
 for(const filename of ['source-management','target-management','configuration.json']){
  let reads=0;deps.read=p=>{const value=originalRead(p);if(p.endsWith(filename)&&++reads>1)return {...value,drift:true};return value;};
  receiptReads=0;await assert.rejects(runOwnedBuyerMigration({releaseSha,operationId,mode:'reconcile'},deps));assert.equal(receiptReads,0);deps.read=originalRead;
 }
 // A credential change after receipt SELECT is caught before a successful reconciliation result.
 let drift=false;deps.read=p=>p==='source-management'&&drift?{...originalRead(p),drift:true}:originalRead(p);
 deps.connect=async config=>{const c=await originalConnect(config),query=c.query.bind(c);c.query=async(text,...args)=>{const r=await query(text,...args);if(text==='SELECT receipt FROM owned_buyer_migration.copy_receipts WHERE operation_id=$1')drift=true;return r;};return c;};
 await assert.rejects(runOwnedBuyerMigration({releaseSha,operationId,mode:'reconcile'},deps));deps.read=originalRead;deps.connect=originalConnect;
 assert.equal((await runOwnedBuyerMigration({releaseSha,operationId,mode:'reconcile'},deps)).status,'OWNED_BUYER_DATA_RECONCILED');
 const verify=await connect('owned_fixture');assert.equal((await verify.query('SELECT count(*)::int AS n FROM owned_buyer_migration.copy_receipts')).rows[0].n,1);
 assert.equal((await verify.query('SELECT count(*)::int AS n FROM public."SearchJob"')).rows[0].n,1);

 const snapshot=async()=>{await verify.query('BEGIN READ ONLY');try{return await inspectOwnedBuyerDataSnapshot(verify);}finally{await verify.query('ROLLBACK');}};
 const copied=await snapshot();
 const hardening=prepareOwnedTargetHardening({releaseSha,operationId,profile,migration:memory.get(`/var/lib/blackspire-operator/owned-buyer-migration/${operationId}/manifest.json`)}),hardeningEvents=[];
 const sourceFreezeClient=await connect('postgres');
 const hardeningArgs={client:verify,plan:hardening,journal:{events:()=>structuredClone(hardeningEvents),append:e=>hardeningEvents.push(structuredClone(e))},fence:async()=>{assert.equal((await security.observeOwnedSourceSecurity(sourceFreezeClient,sourcePlan,migrationVersion)).status,'OWNED_SOURCE_SECURITY_VERIFIED');}};
 assert.equal((await executeOwnedTargetHardening({...hardeningArgs,mode:'apply'})).status,'OWNED_TARGET_HARDENING_VERIFIED');
 assert.equal((await executeOwnedTargetHardening({...hardeningArgs,mode:'reconcile'})).status,'OWNED_TARGET_HARDENING_VERIFIED');
 assert.deepEqual(await snapshot(),copied);
 // Model the dedicated acceptance job added after copy; its preparation has a separate real owner-lock rehearsal.
 await verify.query('INSERT INTO public."SearchJob"(id,user_id,state,county,property_type,status)VALUES($1,$2,$3,$4,$5,$6)',['00000000-0000-4000-8000-000000000098',owner,'NC','Zola Acceptance','acceptance','pending']);
 const afterAcceptance=await snapshot();
 const creatorOid=(await verify.query("SELECT oid::int AS id FROM pg_roles WHERE rolname='postgres'")).rows[0].id;
 await verify.query("SELECT set_config('blackspire.buyer_writer_creator_oid',$1,false)",[String(creatorOid)]);
 const installer=fs.readFileSync(new URL('../packages/buyer-writer/sql/install.sql',import.meta.url),'utf8');await verify.query(installer);
 await proveOwnedWriterProvisioning({connect,profile,ca,owner,host:ports.target,releaseSha,operationId,rolePasswords});
 const identity=async kind=>{const c=await connect('owned_fixture',`buyer_writer_${kind}`);try{await c.query("SET search_path=pg_catalog;SET statement_timeout='10s';SET lock_timeout='5s'");assert.equal((await c.query(WRITER_IDENTITY_SQL,[`buyer_writer_${kind}`,BUYER_WRITER_ENTRYPOINTS[kind],JSON.stringify(BUYER_WRITER_ROUTINES),creatorOid])).rows[0].safe,true);}finally{await c.end();}};
 await identity('runtime');await identity('issuer');
 await verify.query(fs.readFileSync(new URL('../packages/buyer-store/repository-schema.sql',import.meta.url),'utf8'));
 await identity('runtime');await identity('issuer');await verify.query(installer);
 const repository=await connect('owned_fixture','buyer_repository_login');await repository.query('BEGIN;SET LOCAL ROLE buyer_repository_user');
 await repository.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[owner]);
 for(const [table,count] of [['SearchJob',2],['BuyerReport',1],['exports',1]])assert.equal((await repository.query(`SELECT count(*)::int AS n FROM public."${table}"`)).rows[0].n,count);
 await repository.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[buyer]);
 for(const table of ['SearchJob','BuyerReport','exports'])assert.equal((await repository.query(`SELECT count(*)::int AS n FROM public."${table}"`)).rows[0].n,0);
 await repository.query('ROLLBACK');await repository.end();
 assert.equal((await verify.query("SELECT has_function_privilege('buyer_repository_user','auth.uid()','EXECUTE') AS allowed,has_function_privilege('buyer_capability_reader','auth.uid()','EXECUTE') AS capability,has_function_privilege('buyer_writer_runtime','auth.uid()','EXECUTE') AS writer")).rows[0].allowed,true);
 assert.equal((await verify.query("SELECT has_function_privilege('buyer_capability_reader','auth.uid()','EXECUTE') OR has_function_privilege('buyer_writer_runtime','auth.uid()','EXECUTE') AS allowed")).rows[0].allowed,false);

 assert.deepEqual(await snapshot(),afterAcceptance);
 const storeRepository=createBuyerStoreRepository({connect:()=>connect('owned_fixture','buyer_repository_login'),connectCapability:()=>connect('owned_fixture','buyer_capability_login')});
 const listed=await storeRepository.execute('exports-list',{searchJobId:job,limit:50},owner);
 assert.equal(listed.length,1);assert.equal(listed[0].file_name,'fixture.csv');assert.equal(listed[0].storage_path,'synthetic/path');assert.equal(listed[0].user_id,owner);assert.equal(listed[0].search_job_id,job);
 assert.deepEqual(await storeRepository.execute('exports-list',{searchJobId:job,limit:50},buyer),[]);
 const exportRequest={id:'00000000-0000-4000-8000-000000000097',searchJobId:job,fileName:'created.csv',rowCount:3};
 const created=await storeRepository.execute('export-create',exportRequest,owner,'admin');assert.equal(created.user_id,owner);assert.equal(created.row_count,3);
 assert.deepEqual(await storeRepository.execute('export-create',exportRequest,owner,'admin'),created);
 await assert.rejects(storeRepository.execute('export-create',{...exportRequest,id:'00000000-0000-4000-8000-000000000096'},buyer,'admin'));
 await assert.rejects(storeRepository.execute('export-create',exportRequest,buyer,'admin'));
 assert.equal((await storeRepository.execute('exports-list',{searchJobId:job,limit:50},owner)).length,2);
 await identity('runtime');await identity('issuer');
 assert.equal((await executeOwnedTargetHardening({...hardeningArgs,mode:'reconcile'})).status,'OWNED_TARGET_HARDENING_VERIFIED');
 assert.equal((await verify.query("SELECT to_regclass('auth.users') AS relation")).rows[0].relation,null);
 console.log('PASS: real source security receipt/freeze, strict source snapshot, six-table native copy+receipt/reconcile, target-only browser hardening, canonical writer and repository install order with runtime/issuer verification and preserved rows plus a later dedicated job. Host profile files/systemd/credential transport modeled; no production connections.');
}finally{for(const c of clients)try{await c.end();}catch{}}
