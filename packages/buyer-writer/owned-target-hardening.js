import {inspectOwnedBuyerDataSnapshot} from './owned-data-copy-postgres.js';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareOwnedBuyerMigrationExecution,ownedBuyerMigrationReceipt,OWNED_BUYER_RELATIONS} from './owned-data-migration.js';
import {validateOwnedDatabaseProfile,databaseProfileDigest,verifyOwnedDatabaseIdentity} from './database-profile.js';
const fail=()=>{throw new Error('Owned target hardening rejected; retain intent and reconcile');};
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(canonical(v))).digest('hex');
const same=(a,b)=>hash(a)===hash(b);
const plans=new WeakMap();
const bodyDigest='61baa67314a77d4fa0f0b587821de9216dfa0220d1bb9e22b2808bc2002ae01e';
export const OWNED_TARGET_HARDENING_CHECK_SQL=`SELECT jsonb_build_object(
 'browserDenied',NOT EXISTS(SELECT FROM unnest(ARRAY['anon','authenticated'])r CROSS JOIN unnest(ARRAY['RawSale','CleanSale','BuyerProfile','BuyerReport'])t
 WHERE has_table_privilege(r,format('public.%I',t),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR has_any_column_privilege(r,format('public.%I',t),'SELECT,INSERT,UPDATE,REFERENCES')),
 'anonymousJobsDenied',NOT has_table_privilege('anon','public."SearchJob"','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') AND NOT has_any_column_privilege('anon','public."SearchJob"','SELECT,INSERT,UPDATE,REFERENCES'),
 'inertWebRoles',(SELECT count(*)=3 AND bool_and(NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls) FROM pg_roles WHERE rolname IN('anon','authenticated','service_role')),
 'boundedRolesNoWebMembership',NOT EXISTS(SELECT FROM pg_roles r CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) w WHERE r.rolname IN('buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission_login','buyer_writer_owner','buyer_writer_admission','buyer_repository_user','buyer_repository_login','buyer_capability_reader','buyer_capability_login') AND pg_has_role(r.oid,w,'MEMBER')),
 'ownReadPreserved',has_table_privilege('authenticated','public."SearchJob"','SELECT')
 AND (SELECT relrowsecurity FROM pg_class WHERE oid='public."SearchJob"'::regclass)
 AND EXISTS(SELECT FROM pg_policies WHERE schemaname='public' AND tablename='SearchJob' AND policyname='user_read_own_search_jobs' AND cmd='SELECT' AND roles=ARRAY['authenticated']::name[] AND qual IN('(user_id = auth.uid())','(auth.uid() = user_id)'))
 AND NOT EXISTS(SELECT FROM pg_policies p WHERE schemaname='public' AND tablename='SearchJob' AND policyname<>'user_read_own_search_jobs'
 AND EXISTS(SELECT FROM unnest(p.roles) AS role_entry(role_name) WHERE CASE WHEN role_entry.role_name='public' THEN true ELSE pg_has_role('authenticated',role_entry.role_name,'USAGE') END))
 ) AS evidence`;
export const OWNED_TARGET_HARDENING_RECEIPT_SQL='SELECT receipt FROM owned_buyer_migration.hardening_receipts WHERE operation_id=$1';
const COPY_SQL='SELECT receipt FROM owned_buyer_migration.copy_receipts WHERE operation_id=$1';
export const OWNED_TARGET_RECEIPT_STORAGE_SQL=`SELECT c.relkind='r' AND c.relpersistence='p' AND NOT c.relispartition AND NOT c.relrowsecurity
 AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname='postgres')
 AND NOT EXISTS(SELECT FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a WHERE a.grantee<>c.relowner)
 AND NOT EXISTS(SELECT FROM pg_trigger WHERE tgrelid=c.oid AND NOT tgisinternal)
 AND NOT EXISTS(SELECT FROM pg_rewrite WHERE ev_class=c.oid)
 AND NOT EXISTS(SELECT FROM pg_inherits WHERE c.oid IN(inhparent,inhrelid))
 AND (SELECT count(*) FROM pg_attribute WHERE attrelid=c.oid AND attnum>0 AND NOT attisdropped)=2
 AND EXISTS(SELECT FROM pg_attribute WHERE attrelid=c.oid AND attname='operation_id' AND atttypid='uuid'::regtype AND attnotnull)
 AND EXISTS(SELECT FROM pg_attribute WHERE attrelid=c.oid AND attname='receipt' AND atttypid='jsonb'::regtype AND attnotnull)
 AS safe FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='owned_buyer_migration' AND c.relname=$1`;
async function storage(client,name){const r=await client.query(OWNED_TARGET_RECEIPT_STORAGE_SQL,[name]);if(r?.rows?.length!==1||Object.keys(r.rows[0]).join(',')!=='safe'||r.rows[0].safe!==true)fail();}

export function prepareOwnedTargetHardening({releaseSha,operationId,profile,migration}){
 profile=validateOwnedDatabaseProfile(profile);const copied=prepareOwnedBuyerMigrationExecution(migration),copyReceipt=ownedBuyerMigrationReceipt(copied);
 if(releaseSha!==copied.releaseSha||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(operationId??'')
 ||migration.target.profileDigest!==databaseProfileDigest(profile)||migration.target.clusterId!==profile.systemIdentifier)fail();
 const source=readFileSync(new URL('../../frontend/supabase/migrations/20260904223151_buyer_browser_security.sql',import.meta.url),'utf8');if(hash(source)!==bodyDigest)fail();
 const tables=OWNED_BUYER_RELATIONS.map(n=>`public."${n}"`);
 const snapshots=tables.map((t,i)=>`CREATE TEMP TABLE owned_hardening_rows_${i} ON COMMIT DROP AS SELECT to_jsonb(t) AS row FROM ${t} t;`).join('\n');
 const preserved=tables.map((t,i)=>`IF EXISTS((SELECT row FROM pg_temp.owned_hardening_rows_${i} EXCEPT ALL SELECT to_jsonb(t) FROM ${t} t) UNION ALL (SELECT to_jsonb(t) FROM ${t} t EXCEPT ALL SELECT row FROM pg_temp.owned_hardening_rows_${i})) THEN RAISE EXCEPTION 'Target rows changed';END IF;`).join('\n');
 const body=`LOCK TABLE ${tables.join(',')} IN ACCESS EXCLUSIVE MODE;\n${snapshots}\n${source}\nDO $owned_rows$ BEGIN\n${preserved}\nEND $owned_rows$;`;
 const plan=Object.freeze({version:1,kind:'owned-target-hardening-v1',releaseSha,operationId,profileDigest:databaseProfileDigest(profile),copyManifestDigest:copied.manifestDigest,bodySha256:hash(body),migrationSha256:bodyDigest});
 plans.set(plan,{profile,body,copyReceipt});return plan;
}
export function ownedTargetHardeningBody(plan){const data=plans.get(plan);if(!data)fail();return data.body;}
function expected(plan){return {...plan,rowsPreserved:true};}
async function copy(client,plan){await storage(client,'copy_receipts');const r=await client.query(COPY_SQL,[plan.operationId]);if(r?.rows?.length!==1||Object.keys(r.rows[0]).join(',')!=='receipt'||!same(r.rows[0].receipt,plans.get(plan).copyReceipt))fail();}
async function current(client){const r=await client.query(OWNED_TARGET_HARDENING_CHECK_SQL,[]),e=r?.rows?.[0]?.evidence;
 if(r?.rows?.length!==1||Object.keys(r.rows[0]).join(',')!=='evidence'||!e||Object.keys(e).sort().join(',')!=='anonymousJobsDenied,boundedRolesNoWebMembership,browserDenied,inertWebRoles,ownReadPreserved'||Object.values(e).some(v=>v!==true))fail();}
async function retained(client,plan){const exists=await client.query("SELECT to_regclass('owned_buyer_migration.hardening_receipts') IS NOT NULL AS present",[]);
 if(exists?.rows?.length!==1||typeof exists.rows[0].present!=='boolean')fail();if(!exists.rows[0].present)return false;
 await storage(client,'hardening_receipts');const r=await client.query(OWNED_TARGET_HARDENING_RECEIPT_SQL,[plan.operationId]);if(!Array.isArray(r?.rows)||r.rows.length>1)fail();
 if(!r.rows.length)return false;if(Object.keys(r.rows[0]).join(',')!=='receipt'||!same(r.rows[0].receipt,expected(plan)))fail();return true;}
export async function observeOwnedTargetHardening(client,plan){
 if(!plans.has(plan))fail();let began=false;try{await client.query('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');began=true;
 await client.query("SET LOCAL search_path=pg_catalog;SET LOCAL statement_timeout='30s';SET LOCAL lock_timeout='5s';");
 await verifyOwnedDatabaseIdentity(client,plans.get(plan).profile);await copy(client,plan);
 const found=await retained(client,plan);if(found)await current(client);await client.query('ROLLBACK');began=false;
 return found?Object.freeze({...expected(plan),status:'OWNED_TARGET_HARDENING_VERIFIED'}):null;
 }finally{if(began)try{await client.query('ROLLBACK');}catch{}}}
export function inspectOwnedTargetHardeningHistory(events){
 if(!Array.isArray(events)||events.length>2)fail();let intent=null,result=null;
 for(const e of events){if(!e||e.schema!==1||!e.binding||Object.keys(e.binding).sort().join(',')!=='bodySha256,copyManifestDigest,kind,migrationSha256,operationId,profileDigest,releaseSha,version'
 ||e.binding.version!==1||e.binding.kind!=='owned-target-hardening-v1'||!(/^[a-f0-9]{40}$/).test(e.binding.releaseSha??'')
 ||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(e.binding.operationId??'')
 ||!['bodySha256','copyManifestDigest','profileDigest'].every(k=>(/^[a-f0-9]{64}$/).test(e.binding[k]??''))||e.binding.migrationSha256!==bodyDigest)fail();if(e.type==='owned_target_hardening_intent'){
 if(intent||Object.keys(e).sort().join(',')!=='binding,schema,type')fail();intent=e;
 }else if(e.type==='owned_target_hardening_result'){
 if(!intent||result||Object.keys(e).sort().join(',')!=='binding,schema,status,type'||e.status!=='VERIFIED'||!same(e.binding,intent.binding))fail();result=e;
 }else fail();}
 return {intent,result};
}
// An unconfirmed intent is never permission to replay DDL. Reconciliation only
// reads the transactionally committed receipt and current database restrictions.
export async function executeOwnedTargetHardening({client,plan,journal,mode,fence},{inspectSnapshot=inspectOwnedBuyerDataSnapshot}={}){
 if(!plans.has(plan)||!['apply','reconcile'].includes(mode)||typeof journal?.events!=='function'||typeof journal?.append!=='function'||typeof fence!=='function')fail();
 const prior=inspectOwnedTargetHardeningHistory(journal.events());if(prior.intent&&!same(prior.intent.binding,plan)||mode==='apply'&&prior.intent||mode==='reconcile'&&!prior.intent)fail();
 const confirm=()=>{if(!inspectOwnedTargetHardeningHistory(journal.events()).result)journal.append({schema:1,type:'owned_target_hardening_result',binding:plan,status:'VERIFIED'});};
 if(mode==='reconcile'){await fence();const proof=await observeOwnedTargetHardening(client,plan);await fence();if(proof)confirm();return proof;}
 await fence();journal.append({schema:1,type:'owned_target_hardening_intent',binding:plan});let began=false,commitSent=false;
 try{await client.query('BEGIN');began=true;await client.query("SET LOCAL search_path=pg_catalog;SET LOCAL statement_timeout='30s';SET LOCAL lock_timeout='5s';SET LOCAL transaction_timeout='120s';");
 const lock=await client.query('SELECT pg_try_advisory_xact_lock(206994,132) AS acquired',[]);if(lock?.rows?.length!==1||lock.rows[0].acquired!==true)fail();
 await verifyOwnedDatabaseIdentity(client,plans.get(plan).profile);await copy(client,plan);if(await retained(client,plan))fail();await fence();
 await client.query(`LOCK TABLE ${OWNED_BUYER_RELATIONS.map(name=>`public."${name}"`).join(',')} IN ACCESS EXCLUSIVE MODE`);
 const before=await inspectSnapshot(client);if(!same(before.map(({name,rowCount,dataDigest})=>({name,rowCount,dataDigest})),plans.get(plan).copyReceipt.relations))fail();
 await client.query(plans.get(plan).body);await current(client);await copy(client,plan);
 if(!same(await inspectSnapshot(client),before))fail();
 await client.query('CREATE TABLE IF NOT EXISTS owned_buyer_migration.hardening_receipts(operation_id uuid PRIMARY KEY,receipt jsonb NOT NULL);REVOKE ALL ON TABLE owned_buyer_migration.hardening_receipts FROM PUBLIC,anon,authenticated,service_role;');
 const inserted=await client.query('INSERT INTO owned_buyer_migration.hardening_receipts(operation_id,receipt) VALUES($1,$2::jsonb)',[plan.operationId,JSON.stringify(expected(plan))]);if(inserted.rowCount!==1)fail();
 await fence();commitSent=true;await client.query('COMMIT');began=false;
 const proof=await observeOwnedTargetHardening(client,plan);await fence();if(!proof)fail();confirm();return proof;
 }catch{if(began&&!commitSent)try{await client.query('ROLLBACK');}catch{}throw new Error('Owned target hardening requires read-only reconciliation');}
}
