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
  const r = run(['exec','-i',containerId,'psql','-X','-qAt','-U','postgres','-d','writer_test','-v','ON_ERROR_STOP=1'], statement);
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
  const plan=prepareBuyerWriterExtensionAcl({inventory:baseline,columns:baseline,effective:{effective,schemaEffective}});
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
  console.log(JSON.stringify({status:'PASS',checks,objects:17,paidProviderCalls:0,productionMutations:0,environment:'isolated PostgreSQL 17.6; inert extension stand-ins'},null,2));
} finally { cleanup(); }
