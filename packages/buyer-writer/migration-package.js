import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {buyerWriterExtensionPostcondition} from './extension-acl.js';

const migrations=[
 ['20260904201014_nexus_read_security.sql','1be43afc6d6964752301f0c80806423dc6b82d054b09748813cf40dca7944e51'],
 ['20260904223151_buyer_browser_security.sql','61baa67314a77d4fa0f0b587821de9216dfa0220d1bb9e22b2808bc2002ae01e'],
];
const tables=['public."SearchJob"','public."RawSale"','public."CleanSale"','public."BuyerProfile"','public."BuyerReport"','public.nexus_contacts',
 'buyer_writer.dispatches','buyer_writer.receipts','buyer_writer.sales'];
const digest=s=>createHash('sha256').update(s).digest('hex');
// No network, credential discovery, provisioning or production execution. The
// caller must obtain provider execution evidence and the remaining release gates.
export function prepareBuyerMigrationPackage({releaseSha,providerManifest}){
 if(!/^[a-f0-9]{40}$/.test(releaseSha??''))throw new Error('Release SHA rejected');
 const providerCheck=buyerWriterExtensionPostcondition(providerManifest);
 const source=migrations.map(([file,sha256])=>{
  const bytes=readFileSync(new URL('../../frontend/supabase/migrations/'+file,import.meta.url));
  if(digest(bytes)!==sha256)throw new Error('Reviewed migration drift');
  return bytes.toString('utf8');
 }).join('\n');
 // Exact row multisets, not counts/hashes. Only temporary transaction-local
 // copies are made. Table locks prevent concurrent writers during comparison.
 const snapshots=tables.map((t,i)=>`CREATE TEMP TABLE zola_rows_${i} ON COMMIT DROP AS SELECT to_jsonb(t) AS row FROM ${t} t;`).join('\n');
 const preservation=tables.map((t,i)=>`IF EXISTS((SELECT row FROM pg_temp.zola_rows_${i} EXCEPT ALL SELECT to_jsonb(t) FROM ${t} t)
  UNION ALL (SELECT to_jsonb(t) FROM ${t} t EXCEPT ALL SELECT row FROM pg_temp.zola_rows_${i})) THEN
  RAISE EXCEPTION 'Migration row preservation failed';END IF;`).join('\n');
 const writerAcl=`SELECT jsonb_build_object(
 'classes',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relowner,c.relacl) ORDER BY c.oid) FROM pg_class c WHERE c.relnamespace='buyer_writer'::regnamespace),
 'functions',(SELECT jsonb_agg(jsonb_build_array(p.oid,p.proowner,p.proacl,p.proconfig,md5(pg_get_functiondef(p.oid))) ORDER BY p.oid) FROM pg_proc p WHERE p.pronamespace='buyer_writer'::regnamespace),
 'columns',(SELECT jsonb_agg(jsonb_build_array(a.attrelid,a.attnum,a.attacl) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a WHERE a.attrelid IN (${tables.slice(0,5).map(t=>`'${t}'::regclass`).join(',')}) AND a.attnum>0 AND NOT a.attisdropped)
 ) AS value`;
 const browserCheck=`DO $zola_browser$
 DECLARE r text;t text;
 BEGIN
 FOR r IN SELECT unnest(ARRAY['anon','authenticated']) LOOP
  FOREACH t IN ARRAY ARRAY['public."RawSale"','public."CleanSale"','public."BuyerProfile"','public."BuyerReport"','public.nexus_contacts'] LOOP
   IF has_table_privilege(r,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') OR has_any_column_privilege(r,t,'SELECT,INSERT,UPDATE,REFERENCES') THEN
    RAISE EXCEPTION 'Browser authority remains';END IF;
  END LOOP;
 END LOOP;
 IF has_table_privilege('anon','public."SearchJob"','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
  OR has_any_column_privilege('anon','public."SearchJob"','SELECT,INSERT,UPDATE,REFERENCES')
  OR has_table_privilege('authenticated','public."SearchJob"','TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')
  OR has_any_column_privilege('authenticated','public."SearchJob"','REFERENCES') THEN
  RAISE EXCEPTION 'SearchJob browser write authority remains';END IF;
 IF NOT has_table_privilege('authenticated','public."SearchJob"','SELECT')
  OR NOT (SELECT relrowsecurity FROM pg_class WHERE oid='public."SearchJob"'::regclass)
  OR NOT EXISTS(SELECT FROM pg_policies WHERE schemaname='public' AND tablename='SearchJob' AND policyname='user_read_own_search_jobs' AND cmd='SELECT' AND roles=ARRAY['authenticated']::name[] AND qual IN ('(user_id = auth.uid())','(auth.uid() = user_id)')) THEN
  RAISE EXCEPTION 'SearchJob own-read policy missing';END IF;
 IF EXISTS(SELECT FROM pg_policies p WHERE schemaname='public' AND tablename='SearchJob'
  AND policyname<>'user_read_own_search_jobs' AND EXISTS(SELECT FROM unnest(p.roles) AS role_entry(role_name) WHERE CASE WHEN role_entry.role_name='public' THEN true ELSE pg_has_role('authenticated',role_entry.role_name,'USAGE') END)) THEN
  RAISE EXCEPTION 'Unexpected SearchJob browser policy';END IF;
 END $zola_browser$;`;
 const body=`SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
SET LOCAL transaction_timeout='120s';
SET LOCAL idle_in_transaction_session_timeout='10s';
${providerCheck}
LOCK TABLE ${tables.join(',')} IN ACCESS EXCLUSIVE MODE;
${snapshots}
CREATE TEMP TABLE zola_writer_acl ON COMMIT DROP AS ${writerAcl};
${source}
DO $zola_rows$
DECLARE observed jsonb;
BEGIN
${preservation}
${writerAcl.replace(' AS value',' INTO observed')};
IF observed IS DISTINCT FROM (SELECT value FROM pg_temp.zola_writer_acl) THEN
 RAISE EXCEPTION 'Private writer authority changed';END IF;
END $zola_rows$;
${browserCheck}
${providerCheck}
`;
 const sql=`-- Guarded application migrations. Provider ACL changes are never executed here.
-- Require a coordinated window excluding concurrent role/ACL/extension changes.
BEGIN;
${body}COMMIT;
`;
 const manifest={version:1,status:'prepared-not-applied',releaseSha,providerManifestSha256:digest(JSON.stringify(providerManifest)),
  preparationEnvironment:'clean release source checkout only; not executable from sealed runtime archive',
  migrationSources:migrations.map(([file,sha256])=>({file,sha256})),sqlSha256:digest(sql),bodySha256:digest(body),
  migrationHistory:'execute_sql/psql does not record Supabase migration history; apply_migration records the actual invocation version, not these source versions',
  rollback:'Abort restores the entire transaction. After commit retain read restrictions on code rollback; never restore unsafe browser or PUBLIC grants.',
  requiredExternalGates:['verified-provider-execution-and-exclusive-window','live-n8n-scoped-continuity','writer-e2e','functional-rollback','six-reads-before'],
  productionApplied:false};
 return {sql,body,manifest,manifestBytes:JSON.stringify(manifest,null,2)+'\n'};
}
