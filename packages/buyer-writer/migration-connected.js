import {createHash} from 'node:crypto';
import {prepareBuyerMigrationPackage} from './migration-package.js';

const digest=value=>createHash('sha256').update(value).digest('hex');
const literal=value=>"'"+value.replaceAll("'","''")+"'";
const plans=new WeakSet();
const refuse=()=>{throw new Error('Connected migration package or observation rejected');};
export const ZOLA_SUPABASE_PROJECT='kchtrvfcixnimvxxctkj';

// The connected apply_migration endpoint owns BEGIN/history/COMMIT. Never send
// the native executor's transaction wrapper through it. One DO statement also
// keeps the guarded body atomic if an endpoint changes its batching behavior.
// This prepares a request, not permission to bypass the enclosing release gates.
export function prepareConnectedBuyerMigration({releaseSha,providerManifest,manifestBytes,body,expectedManifestSha256}){
 try{
  const regenerated=prepareBuyerMigrationPackage({releaseSha,providerManifest});
  if(regenerated.manifestBytes!==manifestBytes||regenerated.body!==body||digest(manifestBytes)!==expectedManifestSha256)refuse();
  const name=`zola_guarded_connected_${releaseSha}`;
  // Both delimiters are chosen from the exact bytes, and explicitly checked.
  const bodyTag=`$zola_body_${digest(body)}$`,outer='$zola_connected$';
  if(body.includes(bodyTag)||body.includes(outer))refuse();
  const query=`SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='5s';
SET LOCAL transaction_timeout='120s';
SET LOCAL idle_in_transaction_session_timeout='10s';
DO ${outer}
BEGIN
 IF current_setting('statement_timeout') <> '30s' OR current_setting('lock_timeout') <> '5s'
  OR current_setting('transaction_timeout') <> '2min' OR current_setting('idle_in_transaction_session_timeout') <> '10s' THEN
  RAISE EXCEPTION 'Connected migration requires one API-owned transaction';
 END IF;
 IF current_user <> 'postgres' OR current_database() <> 'postgres'
  OR (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user) IS DISTINCT FROM false
  OR current_setting('server_version_num')::int NOT BETWEEN 170000 AND 179999 THEN
  RAISE EXCEPTION 'Connected migration execution identity rejected';
 END IF;
 PERFORM pg_catalog.set_config('search_path','pg_catalog',true);
 PERFORM pg_catalog.set_config('lock_timeout','5s',true);
 PERFORM pg_catalog.set_config('statement_timeout','30s',true);
 PERFORM pg_catalog.set_config('transaction_timeout','120s',true);
 PERFORM pg_catalog.set_config('idle_in_transaction_session_timeout','10s',true);
 IF NOT pg_catalog.pg_try_advisory_xact_lock(206994,125) THEN
  RAISE EXCEPTION 'Connected migration competing execution';
 END IF;
 IF EXISTS(SELECT FROM supabase_migrations.schema_migrations WHERE name=${literal(name)}
  OR name=${literal(`zola_guarded_application_${releaseSha}`)}) THEN
  RAISE EXCEPTION 'Connected migration already recorded; reconcile only';
 END IF;
 EXECUTE ${bodyTag}${body}${bodyTag};
END ${outer};\n`;
  // The history payload must be byte-identical. An endpoint which splits or
  // rewrites it is not silently accepted: observe its contract before release.
  const reconciliationQuery=`BEGIN READ ONLY;
SET LOCAL search_path=pg_catalog;
SET LOCAL statement_timeout='5s';
SELECT current_user AS actor,current_database() AS database,
 (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser,
 pg_try_advisory_xact_lock(206994,125) AS acquired,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('version',version,'name',name,
  'statementCount',cardinality(statements),
  'querySha256',encode(sha256(convert_to(statements[1],'UTF8')),'hex')) ORDER BY version),'[]'::jsonb)
 FROM supabase_migrations.schema_migrations WHERE name IN (${literal(name)},${literal(`zola_guarded_application_${releaseSha}`)})) AS history;
COMMIT;`;
  const plan=Object.freeze({version:1,releaseSha,bodySha256:digest(body),manifestSha256:expectedManifestSha256,
   request:Object.freeze({project_id:ZOLA_SUPABASE_PROJECT,name,query}),querySha256:digest(query),reconciliationQuery,
   productionAcceptance:false});
  plans.add(plan);return plan;
 }catch{refuse();}
}

export function reconcileConnectedBuyerMigration(plan,rows){
 try{
  if(!plans.has(plan)||!Array.isArray(rows)||rows.length!==1)refuse();
  const row=rows[0];
  if(Object.keys(row).sort().join(',')!=='acquired,actor,database,history,superuser'
   ||row.actor!=='postgres'||row.database!=='postgres'||row.superuser!==false||row.acquired!==true
   ||!Array.isArray(row.history)||row.history.length>1)refuse();
  if(row.history.length===0)return Object.freeze({status:'not-recorded-retry-not-authorized',releaseSha:plan.releaseSha,productionAcceptance:false});
  const entry=row.history[0];
  if(Object.keys(entry).sort().join(',')!=='name,querySha256,statementCount,version'
   ||typeof entry.version!=='string'||!/^\d{14}$/.test(entry.version)||entry.name!==plan.request.name||entry.statementCount!==1||entry.querySha256!==plan.querySha256)refuse();
  return Object.freeze({status:'committed-history-verified',releaseSha:plan.releaseSha,migrationVersion:entry.version,
   querySha256:plan.querySha256,productionAcceptance:false});
 }catch{refuse();}
}
