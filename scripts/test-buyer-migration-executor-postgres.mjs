import {randomBytes} from 'node:crypto';
import { readFileSync,readlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { EXTENSION_ACL_CATALOG_SQL } from '../packages/buyer-writer/extension-acl-catalog.js';
import { prepareBuyerWriterExtensionAcl } from '../packages/buyer-writer/extension-acl.js';
assert.equal(process.versions.node, '22.23.1');
const image = process.env.BUYER_WRITER_TEST_IMAGE;
assert.match(image ?? '', /^postgres@sha256:[a-f0-9]{64}$/);
const runId=randomBytes(16).toString('hex');
assert.match(runId??'',/^[a-f0-9]{32}$/);
const name = `zola-migration-executor-${runId}`;
let owned = false;
let creationAttempted = false;
let containerId;
const ownership=randomBytes(16).toString('hex');
assert.match(ownership??'',/^[a-f0-9]{32}$/);
const run = (args, input) => spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
const sql = (statement, { fail = false } = {}) => {
  const r = run(['exec','-i',containerId,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'], 'set client_min_messages=warning;'+statement);
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
try {
  creationAttempted=true;
  const created = run(['create','--name',name,'--label','blackspire.disposable=buyer-writer-test','--label',`blackspire.test-owner=${ownership}`,'--network','none','--read-only','--memory','512m','--cpus','1','--pids-limit','128','--tmpfs','/var/lib/postgresql/data:rw,size=192m','--tmpfs','/var/run/postgresql:rw,size=8m','--tmpfs','/tmp:rw,size=16m','-e','POSTGRES_USER=fixture_admin','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=postgres',image]);
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
    if (run(['exec',containerId,'sh','-c','test "$(cat /proc/1/comm)" = postgres && pg_isready -U postgres -d postgres']).status===0) { ready=true;break; }
    await new Promise(r=>setTimeout(r,500));
  }
  assert.ok(ready,'isolated PostgreSQL readiness timed out');
  const bootstrap=run(['exec','-i',containerId,'psql','-X','-qAt','-U','fixture_admin','-d','postgres','-v','ON_ERROR_STOP=1'],'CREATE ROLE postgres SUPERUSER LOGIN; ALTER DATABASE postgres OWNER TO postgres;');
  assert.equal(bootstrap.status,0,bootstrap.stderr?.slice(0,500));
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
  sql(readFileSync(new URL('../tests/fixtures/buyer-writer/schema.sql',import.meta.url),'utf8'));
  sql(readFileSync(new URL('../tests/fixtures/buyer-writer/nexus.sql',import.meta.url),'utf8'));
  const demote=run(['exec','-i',containerId,'psql','-X','-qAt','-U','fixture_admin','-d','postgres','-v','ON_ERROR_STOP=1'],'ALTER ROLE postgres NOSUPERUSER CREATEROLE;');
  assert.equal(demote.status,0,demote.stderr?.slice(0,500));
  const provider=makePlan();
  const apply=run(['exec','-i',containerId,'psql','-X','-qAt','-U','fixture_admin','-d','postgres','-v','ON_ERROR_STOP=1'],provider.applySql);
  assert.equal(apply.status,0,apply.stderr?.slice(0,500));
  sql(readFileSync(new URL('../packages/buyer-writer/sql/install.sql',import.meta.url),'utf8'));
  sql('CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,statements text[],name text,created_by text,idempotency_key text,rollback text[]);');
  const pid=JSON.parse(run(['inspect',containerId]).stdout)[0].State.Pid;
  assert.ok(Number.isSafeInteger(pid)&&pid>1);
  const proof=spawnSync('/usr/bin/nsenter',['--target',String(pid),'--net',process.execPath,'--max-old-space-size=256',new URL('./test-buyer-migration-executor-session.mjs',import.meta.url).pathname],{
    input:JSON.stringify(provider.manifest),encoding:'utf8',timeout:90000,maxBuffer:1024*1024,
    env:{PATH:'/usr/bin:/bin',ZOLA_DISPOSABLE_EXECUTOR:'1',ZOLA_DISPOSABLE_NETNS:readlinkSync(`/proc/${pid}/ns/net`)},killSignal:'SIGKILL'});
  assert.equal(proof.status,0,proof.stderr?.slice(0,1200));
  console.log(proof.stdout.trim());
}finally{cleanup();}
