import {planBuyerWrites} from '../packages/buyer-writer/plan.js';
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
const name = `zola-acl-test-${runId}`;
let owned = false;
let creationAttempted = false;
let containerId;
const ownership = process.env.BUYER_WRITER_ACL_OWNER;
assert.match(ownership??'',/^[a-f0-9]{32}$/);
const run = (args, input) => spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
let sqlUser='fixture_admin';
const sql = (statement, { fail = false } = {}) => {
  const r = run(['exec','-i',containerId,'psql','-X','-qAt','-U',sqlUser,'-d','writer_test','-v','ON_ERROR_STOP=1'], 'set client_min_messages=warning;'+statement);
  if (fail) { assert.ok(r.error===undefined||r.error?.code==='EPIPE');assert.equal(r.status,3,'expected psql SQL denial');assert.match(r.stderr,fail);return; }
  assert.equal(r.status, 0, `isolated SQL failed: ${(r.stderr ?? '').replace(/DETAIL:[\s\S]*/, '').slice(0, 600)}`);
  return r.stdout.trim();
};
const adminSql = (statement,{fail=false}={}) => {
  const r = run(['exec','-i',containerId,'psql','-X','-qAt','-U','fixture_admin','-d','writer_test','-v','ON_ERROR_STOP=1'], statement);
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
  const created = run(['create','--name',name,'--label','blackspire.disposable=buyer-writer-test','--label',`blackspire.test-owner=${ownership}`,'--network','none','--read-only','--memory','512m','--cpus','1','--pids-limit','128','--tmpfs','/var/lib/postgresql/data:rw,size=192m','--tmpfs','/var/run/postgresql:rw,size=8m','--tmpfs','/tmp:rw,size=16m','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_USER=fixture_admin','-e','POSTGRES_DB=writer_test',image]);
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
    if (run(['exec',containerId,'sh','-c','test "$(cat /proc/1/comm)" = postgres && pg_isready -U fixture_admin -d writer_test']).status===0) { ready=true;break; }
    await new Promise(r=>setTimeout(r,500));
  }
  assert.ok(ready,'isolated PostgreSQL readiness timed out');
  assert.match(sql('show server_version'),/^17\.6/);
  sql(`create role fixture_oid_padding_1;create role fixture_oid_padding_2;create role fixture_oid_padding_3;
   create role postgres superuser createdb createrole replication bypassrls login;alter database writer_test owner to postgres`);
  sqlUser='postgres';
  sql('create database writer_other');
  sql('revoke connect on database postgres,writer_other from public');

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
  sql(`alter table net._http_response rename column id to "column$zola_acl$\\'";`);
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
  const plan=makePlan(),baseline=capture();
  const same=(a,b)=>assert.deepEqual(a,b);
  sql('set standard_conforming_strings=off;'+plan.applySql);const applied=capture();checks.push('apply preserves complete consumer privilege and grant-option matrix');
  assert.equal(applied.objects.some(o=>o.edges.some(e=>e.grantee==='PUBLIC')),false);
  sql(plan.applySql);same(capture(),applied);checks.push('reapplication is an exact no-op');
  sql(plan.rollbackSql);same(capture(),baseline);checks.push('rollback restores original grantors, grant options and downstream grants');
  sql(plan.rollbackSql);same(capture(),baseline);checks.push('rollback reapplication is an exact no-op');
  sql('create role buyer_writer_runtime login noinherit;');
  sql(plan.rollbackSql,{fail:/Writer identities must be disabled and drained/});checks.push('rollback refuses enabled writer even when ACL is already original');
  sql(plan.applySql,{fail:/All scoped writer roles required/});checks.push('provider transaction rejects a partial scoped-role installation');
  sql('alter role buyer_writer_runtime nologin;');
  sql('drop role buyer_writer_runtime;');same(capture(),baseline);
  sql(`grant select("column$zola_acl$\\'") on net._http_response to consumer;`);const columnDrift=capture();
  sql(plan.applySql,{fail:/ACL catalog preconditions changed/});same(capture(),columnDrift);checks.push('column ACL drift fails before mutation');
  sql(`revoke select("column$zola_acl$\\'") on net._http_response from consumer;`);same(capture(),baseline);
  // Inject a post-mutation failure into the rehearsal-only transaction to prove atomic abort.
  const fault=plan.applySql.replace("ELSIF NOT (CASE WHEN rollback_mode", "ELSIF phase=1 THEN RAISE EXCEPTION 'isolated post-mutation fault';\n  ELSIF NOT (CASE WHEN rollback_mode");
  assert.notEqual(fault,plan.applySql);sql(fault,{fail:/isolated post-mutation fault/});same(capture(),baseline);checks.push('post-mutation exception atomically restores all ACLs');
  sql('create role unrelated_drift nologin;');const drift=capture();sql(plan.applySql,{fail:/ACL catalog preconditions changed/});same(capture(),drift);
  sql('drop role unrelated_drift;');same(capture(),baseline);checks.push('unexpected role drift fails without mutation');
  // Application package proof uses the exact canonical-shaped fixtures and
  // inert provider objects. No provider credentials or extension functions run.
  sql(readFileSync(new URL('../tests/fixtures/buyer-writer/schema.sql',import.meta.url),'utf8'));
  sql(readFileSync(new URL('../tests/fixtures/buyer-writer/nexus.sql',import.meta.url),'utf8'));
  // Preserve the provider-owned PUBLIC object ACLs. Removing schema reachability
  // is sufficient isolation and is already the observed production shape.
  sql('revoke usage on schema net,extensions from public');
  adminSql('alter role postgres nosuperuser createrole');
  const applicationAcl=makePlan();
  const trustedCreatorOid=sql("select oid from pg_roles where rolname='postgres'");
  const postcondition=buyerWriterExtensionPostcondition(applicationAcl.manifest,Number(trustedCreatorOid));
  sql('begin;'+postcondition+'commit;',{fail:/All scoped writer roles required/});
  // Sequence privileges remain OID-addressable without schema USAGE. Apply the
  // reviewed provider ACL closure before enabling the Buyer Writer identities.
  sqlUser='fixture_admin';sql(applicationAcl.applySql);sqlUser='postgres';
  const installSql=`set blackspire.buyer_writer_creator_oid=${literal(trustedCreatorOid)};`+readFileSync(new URL('../packages/buyer-writer/sql/install.sql',import.meta.url),'utf8');
  sql(installSql);
  sql(`insert into public."SearchJob"(id,user_id,state,county,property_type) values
   ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','NC','Wake','land');
   insert into public."RawSale"(search_job_id,buyer_name) values ('00000000-0000-4000-8000-000000000010','PRESERVE');
   insert into public."CleanSale"(search_job_id,buyer_name) values ('00000000-0000-4000-8000-000000000010','PRESERVE');
   insert into public."BuyerProfile"(id,buyer_name) values ('00000000-0000-4000-8000-000000000011','PRESERVE');
   insert into public."BuyerReport"(search_job_id,buyer_profile_id) values ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011');`);
  const prepared=prepareBuyerMigrationPackage({releaseSha:'a'.repeat(40),providerManifest:applicationAcl.manifest,creatorOid:Number(trustedCreatorOid)});
  const appState=()=>sql(`select jsonb_agg(jsonb_build_array(c.oid,c.relacl,
   (select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where p.schemaname='public' and p.tablename=c.relname)) order by c.oid)
   from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'`);
  const initialApp=appState();
  const injected=prepared.sql.replace('DO $zola_rows$',"DO $$BEGIN RAISE EXCEPTION 'expected application abort';END$$;DO $zola_rows$");
  sql(injected,{fail:/expected application abort/});same(appState(),initialApp);
  checks.push('application package abort restores all application ACLs and policies');
  sql(prepared.sql);const appliedApp=appState();sql(prepared.sql);same(appState(),appliedApp);
  checks.push('reviewed provider ACL closure precedes Buyer Writer installation and remains idempotent');
  checks.push('exact application package preserves six tables/private ledgers and reapplies safely');
  adminSql('grant usage on schema net to public;set role supabase_admin;grant execute on function net.http_post() to public;reset role');
  sql(installSql,{fail:/Unexpected writer role privileges/});
  adminSql('revoke usage on schema net from public;set role supabase_admin;revoke execute on function net.http_post() from public;reset role');
  sql(prepared.sql);
  checks.push('PUBLIC network functions become a blocker when schema reachability appears');
  adminSql('grant consumer to buyer_writer_runtime with inherit true,set true');
  sql(prepared.sql,{fail:/Trusted writer bootstrap relationship required/});
  adminSql('revoke consumer from buyer_writer_runtime');
  checks.push('inherited and SET-capable membership paths fail before application mutation');
  adminSql(`revoke buyer_writer_owner from postgres granted by postgres;
   revoke buyer_writer_owner,buyer_writer_runtime,buyer_writer_issuer,buyer_writer_admission from postgres;
   grant buyer_writer_owner,buyer_writer_runtime,buyer_writer_issuer,buyer_writer_admission to consumer with admin true,set false,inherit false;
   set role consumer;
   grant buyer_writer_owner to consumer with admin false,set true,inherit false granted by consumer;
   reset role;`);
  sql(prepared.sql,{fail:/Trusted writer bootstrap relationship required/});
  adminSql(`revoke buyer_writer_owner from consumer granted by consumer;
   revoke buyer_writer_owner,buyer_writer_runtime,buyer_writer_issuer,buyer_writer_admission from consumer granted by fixture_admin;
   grant buyer_writer_owner,buyer_writer_runtime,buyer_writer_issuer,buyer_writer_admission to postgres with admin true,set false,inherit false granted by fixture_admin;
   set role postgres;grant buyer_writer_owner to postgres with admin false,set true,inherit false granted by postgres;reset role`);
  checks.push('application preflight rejects creator and owner SET ROLE substitution');
  sql(prepared.sql);
  for(const [grant,revoke,failure,label] of [
    ['grant create on schema public to buyer_writer_runtime','revoke create on schema public from buyer_writer_runtime','Unexpected writer schema CREATE privilege','schema CREATE'],
    ['grant create on database writer_test to buyer_writer_runtime','revoke create on database writer_test from buyer_writer_runtime','Unexpected writer database CREATE privilege','database CREATE'],
    ['grant maintain on public."RawSale" to buyer_writer_runtime','revoke maintain on public."RawSale" from buyer_writer_runtime','Unexpected writer relation privilege','relation MAINTAIN'],
    ['grant select(buyer_name) on public."BuyerProfile" to buyer_writer_runtime','revoke select(buyer_name) on public."BuyerProfile" from buyer_writer_runtime','Unexpected writer relation privilege','column privilege'],
    ['grant usage on sequence buyer_writer.sales_ordinal_seq to buyer_writer_runtime','revoke usage on sequence buyer_writer.sales_ordinal_seq from buyer_writer_runtime','Unexpected writer sequence privilege','sequence privilege'],
    ['grant create on schema public to buyer_writer_owner','revoke create on schema public from buyer_writer_owner','Unexpected writer schema CREATE privilege','owner schema CREATE'],
    ['grant create on database writer_test to buyer_writer_owner','revoke create on database writer_test from buyer_writer_owner','Unexpected writer database CREATE privilege','owner database CREATE'],
    ['grant select on public."RawSale" to buyer_writer_owner','revoke select on public."RawSale" from buyer_writer_owner','Unexpected writer relation privilege','owner relation privilege'],
    ['grant select(error_message) on public."SearchJob" to buyer_writer_owner','revoke select(error_message) on public."SearchJob" from buyer_writer_owner','Unexpected writer relation privilege','owner column privilege'],
    ['grant execute on function buyer_writer.valid_sale(jsonb) to buyer_writer_runtime','revoke execute on function buyer_writer.valid_sale(jsonb) from buyer_writer_runtime','Writer schema or routine ACL drift','non-entrypoint Buyer Writer routine ACL'],
  ]){
    adminSql(grant);sql(prepared.sql,{fail:new RegExp(failure)});adminSql(revoke);checks.push(`application preflight rejects ${label}`);
  }
  sql(prepared.sql);
  sql('grant connect on database writer_other to public');
  sql(prepared.sql,{fail:/Unexpected writer cross-database CONNECT privilege/});
  sql(installSql,{fail:/Unexpected writer cross-database CONNECT privilege/});
  sql('revoke connect on database writer_other from public');
  checks.push('application and installer reject effective PUBLIC CONNECT to a non-target database');
  sql(`create function public.hidden_trigger() returns trigger language plpgsql security definer as 'begin return new;end';
   create trigger hidden_trigger before insert on public."RawSale" for each row execute function public.hidden_trigger();
   revoke execute on function public.hidden_trigger() from public,buyer_writer_owner,buyer_writer_runtime,buyer_writer_issuer,buyer_writer_admission;`);
  sql(prepared.sql,{fail:/Writer relation inheritance drift|Unexpected Buyer Writer relation trigger/});
  sql(installSql,{fail:/Writer relation identity drift|Unexpected Buyer Writer relation trigger/});
  sql('drop trigger hidden_trigger on public."RawSale";drop function public.hidden_trigger()');
  checks.push('application and installer reject a hidden SECURITY DEFINER trigger on a touched relation');
  sql('create role writer_entrypoint_outsider nologin');
  adminSql(`grant usage on schema buyer_writer to writer_entrypoint_outsider;
   grant execute on function buyer_writer.apply(text,text,jsonb) to writer_entrypoint_outsider`);
  sql(prepared.sql,{fail:/Writer schema or routine ACL drift/});
  sql(installSql,{fail:/Unexpected existing writer namespace|Writer schema or routine ACL drift/});
  adminSql(`revoke execute on function buyer_writer.apply(text,text,jsonb) from writer_entrypoint_outsider;
   revoke usage on schema buyer_writer from writer_entrypoint_outsider`);
  adminSql(`grant usage on schema buyer_writer to public;
   grant execute on function buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid) to public`);
  sql(prepared.sql,{fail:/Writer schema or routine ACL drift/});
  sql(installSql,{fail:/Unexpected existing writer namespace|Writer schema or routine ACL drift/});
  adminSql(`revoke execute on function buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid) from public;
   revoke usage on schema buyer_writer from public`);
  sql('grant buyer_writer_runtime to writer_entrypoint_outsider');
  sql(prepared.sql,{fail:/Trusted writer bootstrap relationship required/});
  sql('revoke buyer_writer_runtime from writer_entrypoint_outsider;drop role writer_entrypoint_outsider');
  checks.push('application and installer reject outsider, PUBLIC and inherited reachability to approved SECURITY DEFINER entrypoints');
  sql(prepared.sql);
  sql(`create table public."RawSale_hook_child"() inherits (public."RawSale");
   create function public.child_hidden_trigger() returns trigger language plpgsql security definer as 'begin return new;end';
   create trigger child_hidden_trigger before insert on public."RawSale_hook_child" for each row execute function public.child_hidden_trigger();
   revoke execute on function public.child_hidden_trigger() from public,buyer_writer_owner,buyer_writer_runtime,buyer_writer_issuer,buyer_writer_admission;`);
  sql(prepared.sql,{fail:/Writer relation inheritance drift|Unexpected Buyer Writer relation trigger/});
  sql(installSql,{fail:/Writer relation identity drift|Unexpected Buyer Writer relation trigger/});
  sql('drop table public."RawSale_hook_child";drop function public.child_hidden_trigger()');
  sql('create rule raw_sale_rewrite_guard as on insert to public."RawSale" do also notify zola_rule_witness');
  sql(prepared.sql,{fail:/Unexpected Buyer Writer relation rewrite rule/});
  sql(installSql,{fail:/Unexpected Buyer Writer relation rewrite rule/});
  sql('drop rule raw_sale_rewrite_guard on public."RawSale"');
  sql(`create schema hidden_bridge;create table hidden_bridge.witness(id integer);
   create function hidden_bridge.bridge() returns boolean language plpgsql security definer set search_path=pg_catalog as
    'begin insert into hidden_bridge.witness values (1);return true;end';
   revoke usage on schema hidden_bridge from public,buyer_writer_owner,buyer_writer_runtime,buyer_writer_issuer,buyer_writer_admission;
   alter table public."SearchJob" add constraint hidden_bridge_guard check(hidden_bridge.bridge()) not valid;`);
  sql(prepared.sql,{fail:/Unexpected protected expression routine/});
  sql(installSql,{fail:/Unexpected protected expression routine/});
  assert.equal(sql('select count(*) from hidden_bridge.witness'),'0');
  sql('alter table public."SearchJob" drop constraint hidden_bridge_guard;drop schema hidden_bridge cascade');
  sql(`create schema hidden_domain;create table hidden_domain.witness(id integer);
   create function hidden_domain.bridge() returns boolean language plpgsql security definer set search_path=pg_catalog as
    'begin insert into hidden_domain.witness values (1);return true;end';
   create domain hidden_domain.guarded as text check(hidden_domain.bridge());
   alter table public."RawSale" add column hidden_guard hidden_domain.guarded;
   truncate hidden_domain.witness;
   revoke usage on schema hidden_domain from public,buyer_writer_owner,buyer_writer_runtime,buyer_writer_issuer,buyer_writer_admission;`);
  sql(prepared.sql,{fail:/Unexpected protected column type/});
  sql(installSql,{fail:/Unexpected protected column type/});
  assert.equal(sql('select count(*) from hidden_domain.witness'),'0');
  sql('alter table public."RawSale" drop column hidden_guard;drop schema hidden_domain cascade');
  checks.push('application and installer reject descendant hooks, rewrite rules, hidden executable relation expressions and custom column types');
  adminSql('alter table public."RawSale" owner to consumer');
  sql(prepared.sql,{fail:/Writer relation identity drift/});
  sql(installSql,{fail:/Unexpected existing writer namespace/});
  adminSql('alter table public."RawSale" owner to postgres');
  sql('alter table public."RawSale" rename to "RawSale_bound"');
  sql(prepared.sql,{fail:/Writer relation identity drift/});
  sql(installSql,{fail:/Unexpected existing writer namespace/});
  sql('alter table public."RawSale_bound" rename to "RawSale"');
  sql(`alter table public."RawSale" rename to "RawSale_bound";
   create table public."RawSale" (like public."RawSale_bound" including defaults including constraints)`);
  sql(prepared.sql,{fail:/Writer relation identity drift/});
  sql(installSql,{fail:/Unexpected existing writer namespace/});
  sql('drop table public."RawSale";alter table public."RawSale_bound" rename to "RawSale"');
  sql(`alter table public."RawSale" rename to "RawSale_bound";
  create table public."RawSale" (like public."RawSale_bound" including defaults including constraints) partition by list(search_job_id)`);
  sql(prepared.sql,{fail:/Writer relation identity drift/});
  sql(installSql,{fail:/Unexpected existing writer namespace/});
  sql('drop table public."RawSale";alter table public."RawSale_bound" rename to "RawSale"');
  sql(prepared.sql);
  checks.push('application preflight binds protected OIDs, owners and non-partitioned relation shape across rename, replacement and partition substitution');
  sql('create sequence public.fixture_writer_sequence;grant usage on sequence public.fixture_writer_sequence to buyer_writer_owner');
  sql(prepared.sql,{fail:/Unexpected writer sequence privilege/});sql('drop sequence public.fixture_writer_sequence');
  checks.push('application preflight rejects owner sequence privilege');
  for(const schema of ['extensions','public','other_reachable']){
    if(schema==='extensions')sql('grant usage on schema extensions to public');
    if(schema==='other_reachable')sql(`create schema ${schema};grant usage on schema ${schema} to public`);
    sql(`create function ${schema}.public_invoker() returns integer language sql as 'select 1'`);
    sql(prepared.sql,{fail:/Unexpected reachable writer routine/});
    sql(`drop function ${schema}.public_invoker()`);
    if(schema==='extensions')sql('revoke usage on schema extensions from public');
    if(schema==='other_reachable')sql(`drop schema ${schema}`);
  }
  checks.push('application preflight rejects reachable PUBLIC SECURITY INVOKER routines in extensions, public and another schema');
  const contextDefinition=adminSql("select pg_get_functiondef('buyer_writer.context(text,text,uuid,uuid,bigint)'::regprocedure)");
  adminSql('create trusted procedural language plpgsql_alias handler pg_catalog.plpgsql_call_handler inline pg_catalog.plpgsql_inline_handler validator pg_catalog.plpgsql_validator');
  const languageDrift=contextDefinition.replace('LANGUAGE plpgsql','LANGUAGE plpgsql_alias');assert.notEqual(languageDrift,contextDefinition);
  adminSql(languageDrift);sql(prepared.sql,{fail:/Writer routine definition drift/});sql(installSql,{fail:/Writer routine definition drift/});
  adminSql(contextDefinition);adminSql('drop language plpgsql_alias');
  checks.push('application and installer preflight reject allowlisted function language drift with unchanged body');
  adminSql(`create or replace function buyer_writer.context(p_digest text,p_workspace text,p_job uuid,p_dispatch uuid,p_generation bigint)
    returns jsonb language plpgsql security definer set search_path=pg_catalog set lock_timeout='5s' as $$begin return '{}'::jsonb;end$$;`);
  sql(prepared.sql,{fail:/Writer routine definition drift/});
  sql(installSql,{fail:/Writer routine definition drift/});
  adminSql(contextDefinition);
  checks.push('application preflight rejects allowlisted function body drift');
  sql(prepared.sql);
  adminSql('grant select on net.http_request_queue to buyer_writer_runtime');const driftedApp=appState();sql('begin;'+prepared.sql,
   {fail:/Partial or unexpected ACL state/});same(appState(),driftedApp);
  adminSql('revoke select on net.http_request_queue from buyer_writer_runtime');
  checks.push('application package rejects provider ACL drift before application mutation');
  const unsafeApp=appState();sql('begin;grant select on public."RawSale" to public;'+prepared.sql,
   {fail:/Unexpected target PUBLIC privileges|Unexpected writer relation privilege/});same(appState(),unsafeApp);
  checks.push('application preflight detects PUBLIC relation authority and atomically aborts before browser postconditions');
  sql('create policy unexpected_browser on public."SearchJob" for select to authenticated using(true)');
  const badPolicy=appState();sql(prepared.sql,{fail:/Unexpected SearchJob browser policy/});same(appState(),badPolicy);
  sql('drop policy unexpected_browser on public."SearchJob"');
  checks.push('application postconditions reject cross-owner browser policy');
  const job='00000000-0000-4000-8000-000000000010';
  const owner='00000000-0000-4000-8000-000000000001';
  const other='00000000-0000-4000-8000-000000000002';
  for(const user of [owner,other]){
   assert.equal(adminSql(`set session authorization authenticated;set fixture.user_id=${literal(user)};select count(*) from public."SearchJob" where id=${literal(job)}`),user===owner?'1':'0');
   assert.equal(adminSql(`set session authorization authenticated;set fixture.user_id=${literal(user)};with changed as(update public."SearchJob" set county='UNSAFE' where id=${literal(job)} returning id) select count(*) from changed`),'0');
  }
  checks.push('own-job visibility, cross-owner denial and browser updates remain RLS-denied');
  sql(`update public."SearchJob" set date_range_start='2026-01-01',date_range_end='2026-12-31' where id=${literal(job)}`);
  const criteria=JSON.parse(adminSql(`select buyer_writer.criteria(to_jsonb(j)) from public."SearchJob" j where id=${literal(job)}`));
  const context={version:1,mode:'county_fetch',sources:[{sourceId:'00000000-0000-4000-8000-000000000003',sourceType:'arcgis',endpointId:'isolated',endpointConfigDigest:'b'.repeat(64),cashDisabled:false}],budgets:{maxRequests:500,maxRows:50000,maxBytes:67108864},rawPayload:null};
  const revision=sql(`select updated_at from public."SearchJob" where id=${literal(job)}`);
  const d=JSON.parse(adminSql(`set session authorization buyer_writer_issuer;select buyer_writer.issue(${literal(job)},${literal(owner)},'isolated',${literal('b'.repeat(64))},${literal(JSON.stringify(context))}::jsonb,${literal(JSON.stringify(criteria))}::jsonb,${literal(revision)}::timestamptz,'00000000-0000-4000-8000-000000000020')`));
  const sale={buyer_name:'ISOLATED NEW LLC',seller_name:'SYNTHETIC',property_address:'TEST ONLY',mailing_address:'TEST, NC',sale_price:120000,sale_date:'2026-08-01',property_type:'land',parcel_id:'SYNTHETIC-1',deed_type:'TEST',lender_name:'UNKNOWN'};
  const normalized={raw:[sale],clean:[sale]};
  const writes=[{version:1,dispatchId:d.dispatchId,generation:d.generation,operation:'start',chunkIndex:0,chunkCount:1,payload:{}},...planBuyerWrites({...d,jobId:job,criteria,...normalized})];
  let admissionOrdinal=100;
  const nextAdmissionUuid=()=>`00000000-0000-4000-8000-${(admissionOrdinal++).toString(16).padStart(12,'0')}`;
  const admissions=new Map();
  const write=q=>{
   const args=['acl-reviewer',nextAdmissionUuid(),nextAdmissionUuid(),'c'.repeat(64),owner,'a'.repeat(40),nextAdmissionUuid(),nextAdmissionUuid(),'isolated'];
   const key=`${q.operation}:${q.chunkIndex}`;admissions.set(key,args);
   assert.equal(adminSql(`set session authorization buyer_writer_admission;select buyer_writer.reserve_operation(${args.slice(0,4).map(literal).join(',')},clock_timestamp()+interval '1 minute')`),'t');
   return JSON.parse(adminSql(`set session authorization buyer_writer_admission;select buyer_writer.execute_admitted_apply(${args.map(literal).join(',')},${literal('b'.repeat(64))},${literal(JSON.stringify({jobId:job,...q}))}::jsonb)`));
  };
  for(const q of writes)assert.equal(write(q).ok,true);
  const completedState=sql(`select jsonb_build_array((select count(*) from public."RawSale"),(select count(*) from public."CleanSale"),(select count(*) from public."BuyerProfile"),(select count(*) from public."BuyerReport"),(select status from public."SearchJob" where id=${literal(job)}))`);
  for(const q of writes){
   const args=admissions.get(`${q.operation}:${q.chunkIndex}`);
   adminSql(`set session authorization buyer_writer_admission;select buyer_writer.execute_admitted_apply(${args.map(literal).join(',')},${literal('b'.repeat(64))},${literal(JSON.stringify({jobId:job,...q}))}::jsonb)`,{fail:/Buyer writer admission rejected/});
   const correlated=JSON.parse(adminSql(`set session authorization buyer_writer_admission;select buyer_writer.correlate_admission(${args.map(literal).join(',')})`));
   assert.equal(correlated.state,'succeeded');assert.equal(correlated.result.ok,true);
  }
  assert.equal(sql(`select jsonb_build_array((select count(*) from public."RawSale"),(select count(*) from public."CleanSale"),(select count(*) from public."BuyerProfile"),(select count(*) from public."BuyerReport"),(select status from public."SearchJob" where id=${literal(job)}))`),completedState);
  assert.deepEqual(JSON.parse(completedState),[2,2,2,2,'completed']);
  const ledgerState=()=>adminSql(`select jsonb_build_array((select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from buyer_writer.dispatches t),(select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from buyer_writer.receipts t),(select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from buyer_writer.sales t))`);
  const nonempty=ledgerState();assert.ok(JSON.parse(nonempty).every(rows=>Array.isArray(rows)&&rows.length>0));
  sql(prepared.sql);assert.equal(ledgerState(),nonempty);
  checks.push('package reapplication preserves nonempty dispatch, receipt and sale ledgers');
  checks.push('dedicated scoped writer succeeds across all five tables after packaged migrations, duplicate replay creates no rows');
  assert.equal(sql("select has_schema_privilege('consumer','buyer_writer','USAGE')"),'f');
  adminSql('begin;set local role consumer;'+postcondition+'commit;');
  checks.push('provider postcondition requires neither superuser nor Buyer Writer schema reachability and performs no grant or revoke');
  const writerMarkerPrefix='blackspire-buyer-writer:v2:';
  const trustedWriterMetadata=JSON.parse(sql(`select substring(obj_description((select oid from pg_namespace where nspname='buyer_writer'),'pg_namespace') from ${writerMarkerPrefix.length+1})`));
  assert.equal(trustedWriterMetadata.creatorOid,trustedCreatorOid);
  assert.equal(trustedWriterMetadata.relations.length,9);
  sql('revoke buyer_writer_owner,buyer_writer_runtime,buyer_writer_issuer,buyer_writer_admission from postgres granted by postgres');
  adminSql(`alter role postgres rename to original_creator;
   create role postgres superuser login;
   alter database writer_test owner to postgres;
   set role original_creator;
   grant buyer_writer_owner,buyer_writer_runtime,buyer_writer_issuer,buyer_writer_admission to postgres with admin true,set false,inherit false granted by original_creator;
   reset role;`);
  assert.equal(sql("select oid from pg_roles where rolname='original_creator'"),trustedCreatorOid);
  assert.equal(sql(`select count(*) from pg_auth_members m join pg_roles r on r.oid=m.roleid join pg_roles u on u.oid=m.member
   where r.rolname in('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission') and u.rolname='postgres'
    and m.grantor=${trustedCreatorOid}::oid and m.admin_option and not m.inherit_option and not m.set_option`),'4');
  const replacementCreatorOid=sql("select oid from pg_roles where rolname='postgres'");
  assert.notEqual(replacementCreatorOid,trustedCreatorOid);
  const replacementWriterMetadata={...trustedWriterMetadata,creatorOid:replacementCreatorOid};
  assert.deepEqual(replacementWriterMetadata.relations,trustedWriterMetadata.relations);
  sql(`grant buyer_writer_owner to postgres with admin false,set true,inherit false granted by postgres;
   set role buyer_writer_owner;
   comment on schema buyer_writer is ${literal(writerMarkerPrefix+JSON.stringify(replacementWriterMetadata))};
   reset role;`);
  const substitutedWriterMetadata=JSON.parse(sql(`select substring(obj_description((select oid from pg_namespace where nspname='buyer_writer'),'pg_namespace') from ${writerMarkerPrefix.length+1})`));
  assert.equal(substitutedWriterMetadata.creatorOid,replacementCreatorOid);
  assert.deepEqual(substitutedWriterMetadata,replacementWriterMetadata);
  sql(prepared.sql,{fail:/Writer relation identity drift/});
  checks.push('replacement-creator v2 metadata substitution with exact protected relation metadata is rejected by Writer relation identity drift');
  sql(`set role buyer_writer_owner;
   comment on schema buyer_writer is ${literal(writerMarkerPrefix+JSON.stringify(trustedWriterMetadata))};
   reset role;`);
  const restoredWriterMetadata=JSON.parse(sql(`select substring(obj_description((select oid from pg_namespace where nspname='buyer_writer'),'pg_namespace') from ${writerMarkerPrefix.length+1})`));
  assert.deepEqual(restoredWriterMetadata,trustedWriterMetadata);
  sql(prepared.sql,{fail:/Trusted writer bootstrap relationship required/});
  checks.push('original exact v2 metadata leaves the substituted postgres graph to the Trusted writer bootstrap relationship gate');
  console.log(JSON.stringify({status:'PASS',checks,objects:17,paidProviderCalls:0,productionMutations:0,environment:'isolated PostgreSQL 17.6; inert extension stand-ins'},null,2));
} finally { cleanup(); }
