import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareBuyerWriterExtensionAcl} from './extension-acl.js';
import {EXTENSION_ACL_CATALOG_SQL} from './extension-acl-catalog.js';
const reject=()=>{throw new Error('Owned source security package rejected');};
const hash=value=>createHash('sha256').update(value).digest('hex');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const OWNED_SOURCE_TABLES=Object.freeze(['SearchJob','RawSale','CleanSale','BuyerProfile','BuyerReport','exports']);
const protectedTables=[...OWNED_SOURCE_TABLES,'nexus_contacts'];
const identifiers=protectedTables.map(name=>`public."${name}"`);
const sourceMigrations=[['20260904201014_nexus_read_security.sql','1be43afc6d6964752301f0c80806423dc6b82d054b09748813cf40dca7944e51'],
 ['20260904223151_buyer_browser_security.sql','61baa67314a77d4fa0f0b587821de9216dfa0220d1bb9e22b2808bc2002ae01e']];
const plans=new WeakMap();
const jsonLiteral=value=>{const bytes=JSON.stringify(value);let marker='$owned_source_manifest$';for(let n=1;bytes.includes(marker);n++)marker=`$owned_source_manifest_${n}$`;return marker+bytes+marker;};
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";

// Source remains the original fixed Supabase database. This is not an owned
// target migration and makes no claim that its provider ACLs are isolated.
export function prepareOwnedSourceSecurityPackage(input){
 if(!input||Object.keys(input).sort().join(',')!=='operationId,profileDigest,providerManifest,releaseSha,sourceCreatorOid,sourceSystemIdentifier'
  ||!sha(input.releaseSha)||!uuid(input.operationId)||!digest(input.profileDigest)
  ||typeof input.sourceSystemIdentifier!=='string'||!(/^[1-9][0-9]{0,19}$/).test(input.sourceSystemIdentifier)||BigInt(input.sourceSystemIdentifier)>18446744073709551615n
  ||!Number.isInteger(input.sourceCreatorOid)||input.sourceCreatorOid<=10||input.sourceCreatorOid>4294967295)reject();
 const m=input.providerManifest;
 const regenerated=prepareBuyerWriterExtensionAcl({inventory:m?.baseline,columns:m?.baseline,effective:{effective:m?.effective,schemaEffective:m?.schemaEffective}}).manifest;
 if(JSON.stringify(m)!==JSON.stringify(regenerated)||m.baseline.database!=='postgres')reject();
 const sources=sourceMigrations.map(([file,expected])=>{const bytes=readFileSync(new URL('../../frontend/supabase/migrations/'+file,import.meta.url));if(hash(bytes)!==expected)reject();return bytes.toString('utf8');});
 // Exact catalog equality pins the source provider identity but leaves all its
 // privileges untouched. Data snapshots stay in transaction-local temp tables.
 let identityMarker='$source_identity$';for(let n=1;JSON.stringify(m.baseline).includes(identityMarker);n++)identityMarker=`$source_identity_${n}$`;
 const sourceGuard=`DO ${identityMarker} DECLARE observed jsonb; BEGIN
 IF current_database()<>'postgres' OR session_user<>'postgres' OR current_user<>session_user
  OR NOT EXISTS(SELECT FROM pg_roles WHERE rolname=current_user AND oid=${input.sourceCreatorOid} AND NOT rolsuper AND rolbypassrls)
  OR (SELECT system_identifier::text FROM pg_control_system())<>${literal(input.sourceSystemIdentifier)}
  OR (SELECT datdba FROM pg_database WHERE datname=current_database())<>${input.sourceCreatorOid}
  OR EXISTS(SELECT FROM pg_roles WHERE rolname IN('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission','buyer_writer_admission_login'))
  OR EXISTS(SELECT FROM pg_namespace WHERE nspname='buyer_writer')
 THEN RAISE EXCEPTION 'Source identity or writer authority changed';END IF;
 ${EXTENSION_ACL_CATALOG_SQL.replace(') as metadata',') INTO observed')};
 IF observed IS DISTINCT FROM ${jsonLiteral(m.baseline)}::jsonb THEN RAISE EXCEPTION 'Source provider catalog changed';END IF;
 END ${identityMarker};`;
 const relationGuard=`DO $source_relations$ BEGIN
 IF (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY(ARRAY[${protectedTables.map(literal)}])
  AND c.relkind='r' AND NOT c.relispartition AND c.relpersistence='p' AND c.relowner=${input.sourceCreatorOid})<>7
  OR EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_inherits i ON c.oid IN(i.inhparent,i.inhrelid) WHERE n.nspname='public' AND c.relname=ANY(ARRAY[${protectedTables.map(literal)}]))
  OR EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid JOIN pg_type t ON t.oid=a.atttypid JOIN pg_namespace tn ON tn.oid=t.typnamespace
    WHERE n.nspname='public' AND c.relname=ANY(ARRAY[${protectedTables.map(literal)}]) AND a.attnum>0 AND NOT a.attisdropped AND (tn.nspname<>'pg_catalog' OR t.typtype='d'))
  OR EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_rewrite r ON r.ev_class=c.oid WHERE n.nspname='public' AND c.relname=ANY(ARRAY[${protectedTables.map(literal)}]))
 THEN RAISE EXCEPTION 'Source relation shape unsafe';END IF;
 END $source_relations$;`;
 const preservedAcl=`SELECT jsonb_agg(jsonb_build_array(c.oid,a.grantor,a.grantee,a.privilege_type,a.is_grantable) ORDER BY c.oid,a.grantor,a.grantee,a.privilege_type,a.is_grantable)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
 WHERE n.nspname='public' AND c.relname=ANY(ARRAY[${protectedTables.map(literal)}]) AND a.grantee NOT IN(SELECT oid FROM pg_roles WHERE rolname IN('anon','authenticated','service_role'))`;
 const freeze=`DO $source_freeze$ DECLARE t text;r text;columns text; BEGIN
 FOREACH t IN ARRAY ARRAY[${OWNED_SOURCE_TABLES.map(literal)}] LOOP
  SELECT string_agg(format('%I',a.attname),',' ORDER BY a.attnum) INTO columns FROM pg_attribute a WHERE a.attrelid=format('public.%I',t)::regclass AND a.attnum>0 AND NOT a.attisdropped;
  IF columns IS NULL THEN RAISE EXCEPTION 'Source columns absent';END IF;
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   EXECUTE format('REVOKE INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN ON TABLE public.%I FROM %I RESTRICT',t,r);
   EXECUTE format('REVOKE INSERT (%s),UPDATE (%s),REFERENCES (%s) ON TABLE public.%I FROM %I RESTRICT',columns,columns,columns,t,r);
   IF has_table_privilege(r,format('public.%I',t),'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
    OR has_any_column_privilege(r,format('public.%I',t),'INSERT,UPDATE,REFERENCES') THEN RAISE EXCEPTION 'Source effective writes remain';END IF;
  END LOOP;
 END LOOP;
 REVOKE SELECT ON TABLE public.exports FROM anon,authenticated RESTRICT;
 FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
  FOREACH t IN ARRAY ARRAY['RawSale','CleanSale','BuyerProfile','BuyerReport','exports','nexus_contacts'] LOOP
   IF has_table_privilege(r,format('public.%I',t),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
    OR has_any_column_privilege(r,format('public.%I',t),'SELECT,INSERT,UPDATE,REFERENCES') THEN RAISE EXCEPTION 'Source browser authority remains';END IF;
  END LOOP;
 END LOOP;
 IF has_table_privilege('anon','public."SearchJob"','SELECT') OR has_any_column_privilege('anon','public."SearchJob"','SELECT')
  OR NOT has_table_privilege('authenticated','public."SearchJob"','SELECT')
  OR NOT EXISTS(SELECT FROM pg_policies WHERE schemaname='public' AND tablename='SearchJob' AND policyname='user_read_own_search_jobs' AND cmd='SELECT' AND roles=ARRAY['authenticated']::name[] AND qual IN('(user_id = auth.uid())','(auth.uid() = user_id)'))
  OR EXISTS(SELECT FROM pg_policies p WHERE schemaname='public' AND tablename='SearchJob' AND policyname<>'user_read_own_search_jobs'
  AND EXISTS(SELECT FROM unnest(p.roles) AS role_entry(role_name) WHERE CASE WHEN role_entry.role_name='public' THEN true ELSE pg_has_role('authenticated',role_entry.role_name,'USAGE') END))
  OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public."SearchJob"'::regclass)
 THEN RAISE EXCEPTION 'Source own-read policy changed';END IF;
 END $source_freeze$;`;
 const snapshots=identifiers.map((name,index)=>`CREATE TEMP TABLE owned_source_rows_${index} ON COMMIT DROP AS SELECT to_jsonb(t) AS row FROM ${name} t;`).join('\n');
 const preservation=identifiers.map((name,index)=>`IF EXISTS((SELECT row FROM pg_temp.owned_source_rows_${index} EXCEPT ALL SELECT to_jsonb(t) FROM ${name} t) UNION ALL (SELECT to_jsonb(t) FROM ${name} t EXCEPT ALL SELECT row FROM pg_temp.owned_source_rows_${index})) THEN RAISE EXCEPTION 'Source rows changed';END IF;`).join('\n');
 const body=`SET LOCAL search_path=pg_catalog;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';SET LOCAL transaction_timeout='120s';
${sourceGuard}
LOCK TABLE ${identifiers.join(',')} IN ACCESS EXCLUSIVE MODE;
${relationGuard}
${snapshots}
CREATE TEMP TABLE owned_source_other_acl ON COMMIT DROP AS ${preservedAcl.replace('\n FROM',' AS value\n FROM')};
${sources.join('\n')}
${freeze}
DO $source_preserve$ DECLARE observed jsonb; BEGIN
${preservation}
${preservedAcl.replace('\n FROM',' INTO observed\n FROM')};
IF observed IS DISTINCT FROM (SELECT value FROM pg_temp.owned_source_other_acl) THEN RAISE EXCEPTION 'Unrelated source ACL changed';END IF;
END $source_preserve$;
${sourceGuard}
`;
 const manifest={version:1,kind:'owned-buyer-source-security-v1',releaseSha:input.releaseSha,operationId:input.operationId,profileDigest:input.profileDigest,
  sourceCreatorOid:input.sourceCreatorOid,sourceSystemIdentifier:input.sourceSystemIdentifier,providerBaselineDigest:hash(JSON.stringify(m.baseline)),bodySha256:hash(body),migrationSources:sourceMigrations.map(([file,sha256])=>({file,sha256})),
  frozenTables:[...OWNED_SOURCE_TABLES],sourceProviderAclChanged:false,ownedTargetMigrated:false,productionAcceptance:false};
 const plan=Object.freeze({...manifest,manifestDigest:hash(JSON.stringify(manifest))});plans.set(plan,{body,sourceGuard});
 return Object.freeze({plan,body,manifest});
}

export function ownedSourceSecurityBody(plan){const stored=plans.get(plan);if(!stored)reject();return stored.body;}

export const OWNED_SOURCE_FREEZE_CHECK_SQL=`SELECT jsonb_build_object(
 'transactionReadOnly',current_setting('transaction_read_only')='on',
 'sourceWritesDenied',NOT EXISTS(SELECT FROM unnest(ARRAY['anon','authenticated','service_role'])r
  CROSS JOIN unnest(ARRAY['SearchJob','RawSale','CleanSale','BuyerProfile','BuyerReport','exports'])t
  WHERE has_table_privilege(r,format('public.%I',t),'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
   OR has_any_column_privilege(r,format('public.%I',t),'INSERT,UPDATE,REFERENCES')),
 'browserDenied',NOT EXISTS(SELECT FROM unnest(ARRAY['anon','authenticated'])r
  CROSS JOIN unnest(ARRAY['RawSale','CleanSale','BuyerProfile','BuyerReport','exports','nexus_contacts'])t
  WHERE has_table_privilege(r,format('public.%I',t),'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
   OR has_any_column_privilege(r,format('public.%I',t),'SELECT,INSERT,UPDATE,REFERENCES')),
 'anonymousJobsDenied',NOT has_table_privilege('anon','public."SearchJob"','SELECT') AND NOT has_any_column_privilege('anon','public."SearchJob"','SELECT'),
 'ownReadPreserved',has_table_privilege('authenticated','public."SearchJob"','SELECT')
  AND (SELECT relrowsecurity FROM pg_class WHERE oid='public."SearchJob"'::regclass)
  AND EXISTS(SELECT FROM pg_policies WHERE schemaname='public' AND tablename='SearchJob' AND policyname='user_read_own_search_jobs' AND cmd='SELECT' AND roles=ARRAY['authenticated']::name[] AND qual IN('(user_id = auth.uid())','(auth.uid() = user_id)'))
  AND NOT EXISTS(SELECT FROM pg_policies p WHERE schemaname='public' AND tablename='SearchJob' AND policyname<>'user_read_own_search_jobs'
   AND EXISTS(SELECT FROM unnest(p.roles) AS role_entry(role_name) WHERE CASE WHEN role_entry.role_name='public' THEN true ELSE pg_has_role('authenticated',role_entry.role_name,'USAGE') END))
 ) AS evidence`;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const proof=(plan,status,migrationVersion)=>Object.freeze({kind:'owned-buyer-source-security-proof-v1',status,releaseSha:plan.releaseSha,operationId:plan.operationId,
 profileDigest:plan.profileDigest,sourceSystemIdentifier:plan.sourceSystemIdentifier,sourceCreatorOid:plan.sourceCreatorOid,manifestDigest:plan.manifestDigest,bodySha256:plan.bodySha256,migrationVersion,
 sourceWritesDenied:true,sourceBrowserSecurityVerified:true,sourceProviderAclChanged:false,ownedTargetMigrated:false,productionAcceptance:false});
const historyIdentity=(plan,migrationVersion)=>({name:`zola_owned_source_security_${plan.operationId}`,key:`owned-source:${plan.operationId}:${plan.manifestDigest}`,migrationVersion});
async function receipt(client,plan,migrationVersion){
 const data=plans.get(plan);if(!data||!/^\d{14}$/.test(migrationVersion??''))reject();
 const id=historyIdentity(plan,migrationVersion);
 const result=await client.query('SELECT version,name,statements,idempotency_key FROM supabase_migrations.schema_migrations WHERE version=$1 OR name=$2 OR idempotency_key=$3',
  [id.migrationVersion,id.name,id.key]);
 if(!result||!Array.isArray(result.rows)||result.rows.length>1)reject();
 if(!result.rows.length)return false;
 const row=result.rows[0];if(!exact(row,['version','name','statements','idempotency_key'])||row.version!==id.migrationVersion||row.name!==id.name||row.idempotency_key!==id.key
  ||JSON.stringify(row.statements)!==JSON.stringify([data.body]))reject();return true;
}
async function observeInTransaction(client,plan,migrationVersion,{snapshot=false}={}){
 const data=plans.get(plan);if(!data)reject();
 await client.query(data.sourceGuard);
 if(!await receipt(client,plan,migrationVersion))return null;
 const observed=await client.query(OWNED_SOURCE_FREEZE_CHECK_SQL,[]),row=observed?.rows?.[0];
 if(observed?.rows?.length!==1||!exact(row,['evidence'])||!exact(row.evidence,['transactionReadOnly','sourceWritesDenied','browserDenied','anonymousJobsDenied','ownReadPreserved'])
  ||row.evidence.transactionReadOnly!==!snapshot||Object.entries(row.evidence).some(([key,value])=>key!=='transactionReadOnly'&&value!==true))reject();
 return proof(plan,'OWNED_SOURCE_SECURITY_VERIFIED',migrationVersion);
}
// The caller supplies a fixed original-source connection. This observer owns a
// read-only transaction and proves both durable receipt and CURRENT freeze.
export async function observeOwnedSourceSecurity(client,plan,migrationVersion){
 if(!plans.has(plan)||typeof client?.query!=='function')reject();let began=false;
 try{await client.query('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');began=true;
  await client.query("SET LOCAL search_path=pg_catalog;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';SET LOCAL idle_in_transaction_session_timeout='10s';");
  const locked=await client.query('SELECT pg_try_advisory_xact_lock(206994,126) AS acquired',[]);
  if(locked?.rows?.length!==1||locked.rows[0].acquired!==true)reject();
  const result=await observeInTransaction(client,plan,migrationVersion);await client.query('ROLLBACK');began=false;return result;
 }finally{if(began)try{await client.query('ROLLBACK');}catch{}}
}
const bindingFor=(plan,migrationVersion)=>({releaseSha:plan.releaseSha,operationId:plan.operationId,profileDigest:plan.profileDigest,
 manifestDigest:plan.manifestDigest,bodySha256:plan.bodySha256,migrationVersion});
export function inspectOwnedSourceSecurityHistory(events){
 if(!Array.isArray(events))reject();let intent=null,result=null;
 for(const event of events){
  if(!exact(event,event?.type==='owned_source_security_intent'?['schema','type','binding']:['schema','type','binding','status'])||event.schema!==1
   ||!['owned_source_security_intent','owned_source_security_result'].includes(event.type)
   ||!exact(event.binding,['releaseSha','operationId','profileDigest','manifestDigest','bodySha256','migrationVersion'])
   ||!sha(event.binding.releaseSha)||!uuid(event.binding.operationId)||!['profileDigest','manifestDigest','bodySha256'].every(k=>digest(event.binding[k]))
   ||!/^\d{14}$/.test(event.binding.migrationVersion))reject();
  if(event.type==='owned_source_security_intent'){if(intent)reject();intent=event;}
  else{
   if(!intent||JSON.stringify(intent.binding)!==JSON.stringify(event.binding)||!['COMMITTED','VERIFIED','OUTCOME_UNKNOWN','ABORTED','NOT_RECORDED'].includes(event.status)
    ||result&&(!['COMMITTED','OUTCOME_UNKNOWN','ABORTED'].includes(result.status)||!['VERIFIED','NOT_RECORDED'].includes(event.status)))reject();
   result=event;
  }
 }
 return {intent:structuredClone(intent),result:structuredClone(result)};
}
export async function executeOwnedSourceSecurity({client,plan,mode,journal,migrationVersion,fence}){
 if(!plans.has(plan)||!['apply','reconcile'].includes(mode)||typeof client?.query!=='function'||typeof journal?.events!=='function'||typeof journal?.append!=='function'
  ||typeof fence!=='function'||!/^\d{14}$/.test(migrationVersion??''))reject();
 const bound=bindingFor(plan,migrationVersion),prior=inspectOwnedSourceSecurityHistory(journal.events());
 if(mode==='apply'&&prior.intent||mode==='reconcile'&&(!prior.intent||JSON.stringify(prior.intent.binding)!==JSON.stringify(bound)))reject();
 const append=event=>{inspectOwnedSourceSecurityHistory([...journal.events(),event]);journal.append(event);};
 if(mode==='apply')append({schema:1,type:'owned_source_security_intent',binding:bound});
 const record=status=>{const state=inspectOwnedSourceSecurityHistory(journal.events());if(state.result?.status===status)return;
  append({schema:1,type:'owned_source_security_result',binding:bound,status});};
 if(mode==='reconcile'){
  await fence();const observed=await observeOwnedSourceSecurity(client,plan,migrationVersion);await fence();
  record(observed?'VERIFIED':'NOT_RECORDED');return observed??Object.freeze({status:'OWNED_SOURCE_NOT_RECORDED_RETRY_NOT_AUTHORIZED',...bound,productionAcceptance:false});
 }
 let began=false,commitSent=false;
 try{
  await client.query('BEGIN');began=true;
  await client.query("SET LOCAL search_path=pg_catalog;SET LOCAL lock_timeout='5s';SET LOCAL statement_timeout='30s';SET LOCAL transaction_timeout='120s';");
  const locked=await client.query('SELECT pg_try_advisory_xact_lock(206994,126) AS acquired',[]);
  if(locked?.rows?.length!==1||locked.rows[0].acquired!==true)reject();
  await fence();
  if(await receipt(client,plan,migrationVersion))reject();
  await client.query(plans.get(plan).body);
  const id=historyIdentity(plan,migrationVersion);
  const inserted=await client.query('INSERT INTO supabase_migrations.schema_migrations(version,name,statements,idempotency_key) VALUES($1,$2,$3,$4)',[id.migrationVersion,id.name,[plans.get(plan).body],id.key]);
  if(inserted.rowCount!==1)reject();await fence();commitSent=true;await client.query('COMMIT');began=false;
  record('COMMITTED');return proof(plan,'OWNED_SOURCE_SECURITY_COMMITTED',migrationVersion);
 }catch{
  let rolledBack=false;if(began&&!commitSent)try{await client.query('ROLLBACK');rolledBack=true;}catch{}
  try{record(commitSent||!rolledBack?'OUTCOME_UNKNOWN':'ABORTED');}catch{}
  throw new Error('Owned source security outcome requires read-only reconciliation');
 }
}

// Read-only statements inside the copy driver's existing snapshot transaction.
// A writable snapshot is accepted ONLY with its actual complete SHARE-lock set;
// this function never starts, commits or rolls back that caller-owned boundary.
export const OWNED_SOURCE_SNAPSHOT_FENCE_SQL=`SELECT current_setting('transaction_isolation')='repeatable read'
 AND current_setting('transaction_read_only')='off'
 AND (SELECT count(DISTINCT l.relation) FROM pg_locks l JOIN pg_class c ON c.oid=l.relation JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE l.pid=pg_backend_pid() AND l.granted AND l.locktype='relation' AND l.mode='ShareLock'
  AND n.nspname='public' AND c.relname=ANY(ARRAY['SearchJob','RawSale','CleanSale','BuyerProfile','BuyerReport','exports']))=6 AS safe`;
export async function validateOwnedSourceSecurityInTransaction(client,plan,migrationVersion){
 if(!plans.has(plan)||typeof client?.query!=='function')reject();
 const snapshot=await client.query(OWNED_SOURCE_SNAPSHOT_FENCE_SQL,[]);
 if(snapshot?.rows?.length!==1||!exact(snapshot.rows[0],['safe'])||snapshot.rows[0].safe!==true)reject();
 const lock=await client.query('SELECT pg_try_advisory_xact_lock(206994,126) AS acquired',[]);
 if(lock?.rows?.length!==1||lock.rows[0].acquired!==true)reject();
 return observeInTransaction(client,plan,migrationVersion,{snapshot:true});
}
