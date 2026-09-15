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
const sql = (statement, { fail = false } = {}) => {
  const r = run(['exec','-i',containerId,'psql','-X','-qAt','-U','postgres','-d','writer_test','-v','ON_ERROR_STOP=1'], 'set client_min_messages=warning;'+statement);
  if (fail) { assert.equal(r.error,undefined);assert.equal(r.status,3,'expected psql SQL denial');assert.match(r.stderr,fail);return; }
  assert.equal(r.status, 0, `isolated SQL failed: ${(r.stderr ?? '').replace(/DETAIL:[\s\S]*/, '').slice(0, 600)}`);
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
  const created = run(['create','--name',name,'--label','blackspire.disposable=buyer-writer-test','--label',`blackspire.test-owner=${ownership}`,'--network','none','--read-only','--memory','512m','--cpus','1','--pids-limit','128','--tmpfs','/var/lib/postgresql/data:rw,size=192m','--tmpfs','/var/run/postgresql:rw,size=8m','--tmpfs','/tmp:rw,size=16m','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=writer_test',image]);
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
    if (run(['exec',containerId,'sh','-c','test "$(cat /proc/1/comm)" = postgres && pg_isready -U postgres -d writer_test']).status===0) { ready=true;break; }
    await new Promise(r=>setTimeout(r,500));
  }
  assert.ok(ready,'isolated PostgreSQL readiness timed out');
  assert.match(sql('show server_version'),/^17\.6/);

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
  sql(plan.applySql);checks.push('apply denies extension privileges to newly present scoped writer');
  sql(plan.rollbackSql,{fail:/Writer identities must be disabled and drained/});
  sql('alter role buyer_writer_runtime nologin;');sql(plan.rollbackSql);
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
  const applicationAcl=makePlan();sql(applicationAcl.applySql);
  const postcondition=buyerWriterExtensionPostcondition(applicationAcl.manifest);
  sql('begin;'+postcondition+'commit;',{fail:/All scoped writer roles required/});
  sql(readFileSync(new URL('../packages/buyer-writer/sql/install.sql',import.meta.url),'utf8'));
  sql(`insert into public."SearchJob"(id,user_id,state,county,property_type) values
   ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','NC','Wake','land');
   insert into public."RawSale"(search_job_id,buyer_name) values ('00000000-0000-4000-8000-000000000010','PRESERVE');
   insert into public."CleanSale"(search_job_id,buyer_name) values ('00000000-0000-4000-8000-000000000010','PRESERVE');
   insert into public."BuyerProfile"(id,buyer_name) values ('00000000-0000-4000-8000-000000000011','PRESERVE');
   insert into public."BuyerReport"(search_job_id,buyer_profile_id) values ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011');`);
  const prepared=prepareBuyerMigrationPackage({releaseSha:'a'.repeat(40),providerManifest:applicationAcl.manifest});
  const appState=()=>sql(`select jsonb_agg(jsonb_build_array(c.oid,c.relacl,
   (select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where p.schemaname='public' and p.tablename=c.relname)) order by c.oid)
   from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'`);
  const initialApp=appState();
  const injected=prepared.sql.replace('DO $zola_rows$',"DO $$BEGIN RAISE EXCEPTION 'expected application abort';END$$;DO $zola_rows$");
  sql(injected,{fail:/expected application abort/});same(appState(),initialApp);
  checks.push('application package abort restores all application ACLs and policies');
  sql(prepared.sql);const appliedApp=appState();sql(prepared.sql);same(appState(),appliedApp);
  checks.push('exact application package preserves six tables/private ledgers and reapplies safely');
  sql('grant select on net.http_request_queue to buyer_writer_runtime');
  const driftedApp=appState();sql(prepared.sql,{fail:/Partial or unexpected ACL state/});same(appState(),driftedApp);
  sql('revoke select on net.http_request_queue from buyer_writer_runtime');
  checks.push('application package rejects provider ACL drift before application mutation');
  sql('grant select on public."RawSale" to public');
  const unsafeApp=appState();sql(prepared.sql,{fail:/Browser authority remains/});same(appState(),unsafeApp);
  sql('revoke select on public."RawSale" from public');
  checks.push('application postconditions detect inherited browser authority and atomically abort');
  sql('create policy unexpected_browser on public."SearchJob" for select to authenticated using(true)');
  const badPolicy=appState();sql(prepared.sql,{fail:/Unexpected SearchJob browser policy/});same(appState(),badPolicy);
  sql('drop policy unexpected_browser on public."SearchJob"');
  checks.push('application postconditions reject cross-owner browser policy');
  const job='00000000-0000-4000-8000-000000000010';
  const owner='00000000-0000-4000-8000-000000000001';
  const other='00000000-0000-4000-8000-000000000002';
  for(const user of [owner,other]){
   assert.equal(sql(`set session authorization authenticated;set fixture.user_id=${literal(user)};select count(*) from public."SearchJob" where id=${literal(job)}`),user===owner?'1':'0');
   assert.equal(sql(`set session authorization authenticated;set fixture.user_id=${literal(user)};with changed as(update public."SearchJob" set county='UNSAFE' where id=${literal(job)} returning id) select count(*) from changed`),'0');
  }
  checks.push('own-job visibility, cross-owner denial and browser updates remain RLS-denied');
  sql(`update public."SearchJob" set date_range_start='2026-01-01',date_range_end='2026-12-31' where id=${literal(job)}`);
  const criteria=JSON.parse(sql(`select buyer_writer.criteria(to_jsonb(j)) from public."SearchJob" j where id=${literal(job)}`));
  const context={version:1,mode:'county_fetch',sources:[{sourceId:'00000000-0000-4000-8000-000000000003',sourceType:'arcgis',endpointId:'isolated',endpointConfigDigest:'b'.repeat(64),cashDisabled:false}],budgets:{maxRequests:500,maxRows:50000,maxBytes:67108864},rawPayload:null};
  const revision=sql(`select updated_at from public."SearchJob" where id=${literal(job)}`);
  const d=JSON.parse(sql(`set session authorization buyer_writer_issuer;select buyer_writer.issue(${literal(job)},${literal(owner)},'isolated',${literal('b'.repeat(64))},${literal(JSON.stringify(context))}::jsonb,${literal(JSON.stringify(criteria))}::jsonb,${literal(revision)}::timestamptz,'00000000-0000-4000-8000-000000000020')`));
  const sale={buyer_name:'ISOLATED NEW LLC',seller_name:'SYNTHETIC',property_address:'TEST ONLY',mailing_address:'TEST, NC',sale_price:120000,sale_date:'2026-08-01',property_type:'land',parcel_id:'SYNTHETIC-1',deed_type:'TEST',lender_name:'UNKNOWN'};
  const normalized={raw:[sale],clean:[sale]};
  const writes=[{version:1,dispatchId:d.dispatchId,generation:d.generation,operation:'start',chunkIndex:0,chunkCount:1,payload:{}},...planBuyerWrites({...d,jobId:job,criteria,...normalized})];
  const write=q=>JSON.parse(sql(`set session authorization buyer_writer_runtime;select buyer_writer.apply(${literal('b'.repeat(64))},'isolated',${literal(JSON.stringify({jobId:job,...q}))}::jsonb)`));
  for(const q of writes)assert.equal(write(q).ok,true);
  const completedState=sql(`select jsonb_build_array((select count(*) from public."RawSale"),(select count(*) from public."CleanSale"),(select count(*) from public."BuyerProfile"),(select count(*) from public."BuyerReport"),(select status from public."SearchJob" where id=${literal(job)}))`);
  for(const q of writes){
   sql(`set session authorization buyer_writer_runtime;select buyer_writer.apply(${literal('b'.repeat(64))},'isolated',${literal(JSON.stringify({jobId:job,...q}))}::jsonb)`,{fail:/Buyer writer request rejected/});
   const receipt=JSON.parse(sql(`set session authorization buyer_writer_runtime;select buyer_writer.receipt(${literal('b'.repeat(64))},'isolated',${literal(job)},${literal(d.dispatchId)},${d.generation},${literal(q.operation)},${q.chunkIndex})`));
   assert.equal(receipt.found,true);assert.equal(receipt.receipt.ok,true);
  }
  assert.equal(sql(`select jsonb_build_array((select count(*) from public."RawSale"),(select count(*) from public."CleanSale"),(select count(*) from public."BuyerProfile"),(select count(*) from public."BuyerReport"),(select status from public."SearchJob" where id=${literal(job)}))`),completedState);
  assert.deepEqual(JSON.parse(completedState),[2,2,2,2,'completed']);
  const ledgerState=()=>sql(`select jsonb_build_array((select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from buyer_writer.dispatches t),(select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from buyer_writer.receipts t),(select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from buyer_writer.sales t))`);
  const nonempty=ledgerState();assert.ok(JSON.parse(nonempty).every(rows=>Array.isArray(rows)&&rows.length>0));
  sql(prepared.sql);assert.equal(ledgerState(),nonempty);
  checks.push('package reapplication preserves nonempty dispatch, receipt and sale ledgers');
  checks.push('dedicated scoped writer succeeds across all five tables after packaged migrations, duplicate replay creates no rows');
  sql('begin;set local role consumer;'+postcondition+'commit;');
  checks.push('provider postcondition requires no superuser and performs no grant or revoke');
  console.log(JSON.stringify({status:'PASS',checks,objects:17,paidProviderCalls:0,productionMutations:0,environment:'isolated PostgreSQL 17.6; inert extension stand-ins'},null,2));
} finally { cleanup(); }
