import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {fail} from './local-protocol.js';
const schema=fs.readFileSync(new URL('./repository-schema.sql',import.meta.url),'utf8');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(canonical(v))).digest('hex');
export const BUYER_STORE_SCHEMA_SHA256=hash(schema);
export const BUYER_STORE_SCHEMA_ROLES=Object.freeze(['buyer_repository_user','buyer_repository_login','buyer_capability_reader','buyer_capability_login']);
export const BUYER_STORE_SCHEMA_CATALOG_SQL=`SELECT jsonb_build_object(
 'roles',(SELECT jsonb_agg(jsonb_build_array(rolname,rolcanlogin,rolsuper,rolcreatedb,rolcreaterole,rolinherit,rolreplication,rolbypassrls,rolconnlimit,rolconfig) ORDER BY rolname) FROM pg_roles WHERE rolname=ANY($1::text[])),
 'memberships',(SELECT jsonb_agg(jsonb_build_array(r.rolname,m.rolname,g.rolname,a.admin_option,a.inherit_option,a.set_option) ORDER BY r.rolname,m.rolname,g.rolname) FROM pg_auth_members a JOIN pg_roles r ON r.oid=a.roleid JOIN pg_roles m ON m.oid=a.member JOIN pg_roles g ON g.oid=a.grantor WHERE r.rolname=ANY($1::text[]) OR m.rolname=ANY($1::text[])),
 'tables',(SELECT jsonb_agg(jsonb_build_array(c.relname,c.relowner,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text) ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN('SearchJob','BuyerReport','BuyerProfile','exports')),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.tablename,p.policyname) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename IN('SearchJob','BuyerReport','BuyerProfile','exports')),
 'publicAcl',(SELECT nspacl::text FROM pg_namespace WHERE nspname='public'),
 'databaseAcl',(SELECT datacl::text FROM pg_database WHERE datname=current_database())
) AS catalog`;
const receiptSql='SELECT binding,catalog_digest FROM buyer_store_setup.receipt WHERE singleton=true';
async function catalog(client){const r=await client.query(BUYER_STORE_SCHEMA_CATALOG_SQL,[BUYER_STORE_SCHEMA_ROLES]);if(r.rows?.length!==1||!r.rows[0].catalog)fail();return hash(r.rows[0].catalog);}
async function receipt(client,binding){
 const exists=await client.query("SELECT to_regclass('buyer_store_setup.receipt') IS NOT NULL AS present");if(exists.rows?.length!==1)fail();if(exists.rows[0].present!==true)return null;
 const r=await client.query(receiptSql);if(r.rows?.length!==1||hash(r.rows[0].binding)!==hash(binding)||r.rows[0].catalog_digest!==await catalog(client))fail();return r.rows[0].catalog_digest;
}
// The whole fixed DDL and its receipt commit atomically. Retained intent never redispatches DDL.
export async function provisionBuyerStoreSchema({client,binding,journal,fence,verifyIdentity}){
 if(Object.keys(binding??{}).sort().join(',')!=='artifactDigest,operationId,profileDigest,releaseSha,schemaDigest'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(binding.operationId??'')||binding.schemaDigest!==BUYER_STORE_SCHEMA_SHA256||!/^[a-f0-9]{40}$/.test(binding.releaseSha)||![binding.profileDigest,binding.artifactDigest].every(v=>/^[a-f0-9]{64}$/.test(v)))fail();
 await fence();await verifyIdentity();await client.query('SET search_path=pg_catalog');const prior=await journal.intent();
 if(prior){if(JSON.stringify(prior)!==JSON.stringify(binding))fail();const observed=await receipt(client,binding);if(!observed)fail();await fence();await journal.result({binding,catalogDigest:observed});return {status:'BUYER_STORE_SCHEMA_VERIFIED'};}
 let began=false,commitSent=false;
 try{
  await client.query('BEGIN');began=true;await client.query("SET LOCAL search_path=pg_catalog;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='15s';SET LOCAL transaction_timeout='60s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('blackspire-buyer-store-schema-v1',0))");
  const absent=await client.query("SELECT NOT EXISTS(SELECT FROM pg_roles WHERE rolname=ANY($1::text[])) AND NOT EXISTS(SELECT FROM pg_namespace WHERE nspname='buyer_store_setup') AS fresh",[BUYER_STORE_SCHEMA_ROLES]);if(absent.rows?.length!==1||absent.rows[0].fresh!==true)fail();
  await fence();await journal.writeIntent(binding);await client.query(schema);
  await client.query('CREATE SCHEMA buyer_store_setup AUTHORIZATION postgres; REVOKE ALL ON SCHEMA buyer_store_setup FROM PUBLIC; CREATE TABLE buyer_store_setup.receipt(singleton boolean PRIMARY KEY CHECK(singleton),binding jsonb NOT NULL,catalog_digest text NOT NULL); REVOKE ALL ON buyer_store_setup.receipt FROM PUBLIC');
  const catalogDigest=await catalog(client);await client.query('INSERT INTO buyer_store_setup.receipt VALUES(true,$1::jsonb,$2)',[JSON.stringify(binding),catalogDigest]);
  await fence();commitSent=true;await client.query('COMMIT');began=false;
  if(await receipt(client,binding)!==catalogDigest)fail();await fence();await journal.result({binding,catalogDigest});return {status:'BUYER_STORE_SCHEMA_VERIFIED'};
 }catch{if(began&&!commitSent)await client.query('ROLLBACK').catch(()=>{});fail();}
}
