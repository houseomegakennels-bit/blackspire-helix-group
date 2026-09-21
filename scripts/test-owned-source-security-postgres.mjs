import {prepareOwnedSourceSecurityPackage,OWNED_SOURCE_FREEZE_CHECK_SQL,OWNED_SOURCE_SNAPSHOT_FENCE_SQL} from '../packages/buyer-writer/owned-source-security.js';
import { readFileSync } from 'node:fs';
import {prepareBuyerMigrationPackage} from '../packages/buyer-writer/migration-package.js';
import {buyerWriterExtensionPostcondition} from '../packages/buyer-writer/extension-acl.js';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { EXTENSION_ACL_CATALOG_SQL } from '../packages/buyer-writer/extension-acl-catalog.js';
import { prepareBuyerWriterExtensionAcl } from '../packages/buyer-writer/extension-acl.js';
assert.equal(process.versions.node, '22.23.1');
const image = process.env.BUYER_WRITER_TEST_IMAGE;
assert.match(image ?? '', /^postgres@sha256:[a-f0-9]{64}$/);
const runId=process.env.BUYER_WRITER_ACL_RUN_ID;
assert.match(runId??'',/^[a-f0-9]{32}$/);
const name = `zola-source-security-test-${runId}`;
let owned = false;
let creationAttempted = false;
let containerId;
const ownership = process.env.BUYER_WRITER_ACL_OWNER;
assert.match(ownership??'',/^[a-f0-9]{32}$/);
const run = (args, input) => spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
let sqlUser='fixture_admin';
const sql = (statement, { fail = false } = {}) => {
  const r = run(['exec','-i',containerId,'psql','-X','-qAt','-U',sqlUser,'-d','postgres','-v','ON_ERROR_STOP=1'], 'set client_min_messages=warning;'+statement);
  if (fail) { assert.ok(r.error===undefined||r.error?.code==='EPIPE');assert.equal(r.status,3,'expected psql SQL denial');assert.match(r.stderr,fail);return; }
  assert.equal(r.status, 0, `isolated SQL failed: ${(r.stderr ?? '').replace(/DETAIL:[\s\S]*/, '').slice(0, 600)}`);
  return r.stdout.trim();
};
const adminSql = (statement,{fail=false}={}) => {
  const r = run(['exec','-i',containerId,'psql','-X','-qAt','-U','fixture_admin','-d','postgres','-v','ON_ERROR_STOP=1'], statement);
  if(fail){assert.ok(r.error===undefined||r.error?.code==='EPIPE');assert.equal(r.status,3,'expected admin psql SQL denial');assert.match(r.stderr,fail);return;}
  assert.equal(r.status,0,`isolated admin SQL failed: ${(r.stderr ?? '').replace(/DETAIL:[\s\S]*/, '').slice(0,600)}`);
  return r.stdout.trim();
};
const cleanup = () => {
  if(!owned && creationAttempted) {
    // A create RPC can time out after daemon-side creation. It has not been
    // started yet. Recover only our unpredictable ownership label, never a name
    // alone; deletion uses the immutable container ID to avoid name reuse races.
    const inspected=run(['inspect',name]);
    if(inspected.status===0) {
      const candidate=JSON.parse(inspected.stdout)[0];
      assert.equal(candidate.Config.Labels['blackspire.test-owner'],ownership,'container ownership mismatch');
      containerId=candidate.Id;owned=true;
    } else {
      assert.match(inspected.stderr??'',/no such (object|container)/i,'ambiguous create cleanup could not be verified');
    }
  }
  if(!owned) return;
  assert.match(containerId,/^[a-f0-9]{64}$/);
  const removed=run(['rm','-f',containerId]);
  assert.equal(removed.status,0,'owned disposable container cleanup failed');
  owned=false;creationAttempted=false;
};
for(const [signal,code] of [['SIGTERM',143],['SIGINT',130]]) process.once(signal,()=>{cleanup();process.exit(code);});
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
const checks=[];
try {
  creationAttempted=true;
  const created = run(['create','--name',name,'--label','blackspire.disposable=buyer-writer-test','--label',`blackspire.test-owner=${ownership}`,'--network','none','--read-only','--memory','512m','--cpus','1','--pids-limit','128','--tmpfs','/var/lib/postgresql/data:rw,size=192m','--tmpfs','/var/run/postgresql:rw,size=8m','--tmpfs','/tmp:rw,size=16m','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_USER=fixture_admin','-e','POSTGRES_DB=postgres',image]);
  assert.equal(created.status,0,'isolated PostgreSQL container creation failed');
  containerId=created.stdout.trim();assert.match(containerId,/^[a-f0-9]{64}$/);
  const container = JSON.parse(run(['inspect',containerId]).stdout)[0];
  assert.equal(container.Config.Labels['blackspire.test-owner'],ownership);
  owned = true;
  assert.equal(container.HostConfig.NetworkMode,'none');assert.equal(container.HostConfig.ReadonlyRootfs,true);
  assert.equal(container.Mounts.some(m=>m.Type==='bind'||m.Type==='volume'),false);
  assert.equal(run(['start',containerId]).status,0,'isolated PostgreSQL container failed to start');
  let ready = false;
  for (let i=0;i<60;i++) {
    if (run(['exec',containerId,'sh','-c','test "$(cat /proc/1/comm)" = postgres && pg_isready -U fixture_admin -d postgres']).status===0) { ready=true;break; }
    await new Promise(r=>setTimeout(r,500));
  }
  assert.ok(ready,'isolated PostgreSQL readiness timed out');
  assert.match(sql('show server_version'),/^17\.6/);
  sql(`create role fixture_oid_padding_1;create role fixture_oid_padding_2;create role fixture_oid_padding_3;
   create role postgres superuser createdb createrole replication bypassrls login;alter database postgres owner to postgres`);
  sqlUser='postgres';


  // Inert stand-ins reproduce ACL semantics; no extension/network function runs.
  sql(`create role supabase_admin nologin;create role consumer nologin;create role observer nologin;
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
   sql(`set role supabase_admin;create function net.${fn}() returns integer language sql as 'select null::integer';`);
  sql(`set role supabase_admin;grant execute on function net.http_get() to consumer with grant option;
   set role consumer;grant execute on function net.http_get() to observer;reset role;
   grant consumer to observer with inherit true,set true;`);
  const capture=()=>JSON.parse(sql(EXTENSION_ACL_CATALOG_SQL));
  sql(`alter table net._http_response rename column id to "column$source_identity$\\'";`);
  const makePlan=()=>{
  const baseline=capture();
  const effective=[];
  // One bounded catalog query for all effective privileges and grant options.
  const rows=sql(`with c as (${EXTENSION_ACL_CATALOG_SQL}), o as (select value from c,jsonb_array_elements(metadata->'objects'))
   select jsonb_agg(jsonb_build_array(r.rolname,o.value->>'schema',o.value->>'name',o.value->>'kind',o.value->'arguments',p,
    case when o.value->>'kind'='function' then has_function_privilege(r.oid,(o.value->>'oid')::oid,p)
     when o.value->>'kind'='S' then has_sequence_privilege(r.oid,(o.value->>'oid')::oid,p) else has_table_privilege(r.oid,(o.value->>'oid')::oid,p) end,
    case when o.value->>'kind'='function' then has_function_privilege(r.oid,(o.value->>'oid')::oid,p||' WITH GRANT OPTION')
     when o.value->>'kind'='S' then has_sequence_privilege(r.oid,(o.value->>'oid')::oid,p||' WITH GRANT OPTION') else has_table_privilege(r.oid,(o.value->>'oid')::oid,p||' WITH GRANT OPTION') end)
    order by r.rolname,o.value->>'schema',o.value->>'name',p)
   from pg_roles r cross join o cross join lateral unnest(case when o.value->>'kind'='function' then array['EXECUTE']
    when o.value->>'kind'='S' then array['SELECT','UPDATE','USAGE'] else array['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE'] end) p;`);
  effective.push(...JSON.parse(rows));
  const schemaEffective=JSON.parse(sql(`select jsonb_agg(jsonb_build_array(rolname,s,has_schema_privilege(rolname,s,'USAGE'),has_schema_privilege(rolname,s,'CREATE')) order by rolname,s) from pg_roles cross join unnest(array['extensions','net']) s;`));
  return prepareBuyerWriterExtensionAcl({inventory:baseline,columns:baseline,effective:{effective,schemaEffective}});
  };

  sql(readFileSync(new URL('../tests/fixtures/buyer-writer/schema.sql',import.meta.url),'utf8'));
  sql(readFileSync(new URL('../tests/fixtures/buyer-writer/nexus.sql',import.meta.url),'utf8'));
  sql(`create table public.exports(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),search_job_id uuid references public."SearchJob"(id),file_name text);
   grant all on public.exports to anon,authenticated,service_role;
   insert into public."SearchJob"(id,user_id,state,county,property_type) values('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','NC','Wake','land');
   insert into public.exports(user_id,search_job_id,file_name) values('00000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','fixture.csv');`);
  adminSql('alter role postgres nosuperuser');
  const input={releaseSha:'a'.repeat(40),operationId:'11111111-1111-4111-8111-111111111111',profileDigest:'b'.repeat(64),sourceSystemIdentifier:sql('select system_identifier::text from pg_control_system()'),sourceCreatorOid:Number(sql("select oid from pg_roles where rolname='postgres'")),providerManifest:makePlan().manifest};
  const prepared=prepareOwnedSourceSecurityPackage(input),before=capture();
  const runPackage=()=>sql('BEGIN;'+prepared.body+'COMMIT;');
  sql('grant insert on public."SearchJob" to PUBLIC');
  sql('BEGIN;'+prepared.body+'COMMIT;',{fail:/Source effective writes remain/});
  assert.equal(sql("select has_table_privilege('anon','public.\"RawSale\"','INSERT')"),'t');
  sql('revoke insert on public."SearchJob" from PUBLIC');checks.push('PUBLIC inherited writes block and entire source security transaction rolls back');
  runPackage();assert.deepEqual(capture(),before);
  assert.equal(sql(`select bool_and(not has_table_privilege(r,format('public.%I',t),'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN') and not has_any_column_privilege(r,format('public.%I',t),'INSERT,UPDATE,REFERENCES')) from unnest(array['anon','authenticated','service_role'])r cross join unnest(array['SearchJob','RawSale','CleanSale','BuyerProfile','BuyerReport','exports'])t`),'t');
  assert.equal(sql(`select has_table_privilege('service_role','public.nexus_contacts','SELECT') and has_table_privilege('service_role','public."BuyerProfile"','SELECT') and has_table_privilege('authenticated','public."SearchJob"','SELECT')`),'t');
  assert.equal(sql('select count(*) from public.exports'),'1');assert.equal(sql('select count(*) from public.nexus_contacts'),'2');
  checks.push('actual reviewed Buyer and Nexus source security and six-table effective-write freeze preserve rows and provider ACLs');
  const observed=JSON.parse(sql('BEGIN READ ONLY;'+OWNED_SOURCE_FREEZE_CHECK_SQL+';ROLLBACK;'));assert.ok(Object.values(observed).every(value=>value===true));
  assert.equal(sql('BEGIN ISOLATION LEVEL REPEATABLE READ;LOCK TABLE public.\"SearchJob\",public.\"RawSale\",public.\"CleanSale\",public.\"BuyerProfile\",public.\"BuyerReport\",public.exports IN SHARE MODE;'+OWNED_SOURCE_SNAPSHOT_FENCE_SQL+';ROLLBACK;'),'t');
  checks.push('actual read-only freeze and same-session snapshot SHARE-lock observations pass');
  runPackage();assert.deepEqual(capture(),before);checks.push('reapplication is exact and retains read permissions');
  console.log(JSON.stringify({ok:true,checks,productionTouched:false}));
}finally{cleanup();}
