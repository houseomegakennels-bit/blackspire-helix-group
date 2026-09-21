import {randomBytes} from 'node:crypto';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import {ACCEPTANCE_PREPARATION_SQL,validateBuyerAcceptanceCatalog} from '../packages/buyer-writer/acceptance-target-preparation.js';
assert.equal(process.versions.node, '22.23.1');
const image = process.env.BUYER_WRITER_TEST_IMAGE;
assert.match(image ?? '', /^postgres@sha256:[a-f0-9]{64}$/);
const runId=randomBytes(16).toString('hex');
assert.match(runId??'',/^[a-f0-9]{32}$/);
const name = `zola-acceptance-preparation-${runId}`;
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
  const bootstrap=run(['exec','-i',containerId,'psql','-X','-qAt','-U','fixture_admin','-d','postgres','-v','ON_ERROR_STOP=1'],'CREATE ROLE postgres SUPERUSER BYPASSRLS LOGIN; ALTER DATABASE postgres OWNER TO postgres;');
  assert.equal(bootstrap.status,0,bootstrap.stderr?.slice(0,500));
  assert.match(sql('show server_version'),/^17\.6/);
  const owner='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222';
  const job='33333333-3333-4333-8333-333333333333';
  sql(`create schema auth;
   create table auth.users(id uuid primary key,created_at timestamptz,deleted_at timestamptz,
    banned_until timestamptz,email_confirmed_at timestamptz,raw_app_meta_data jsonb);
   create table public."SearchJob"(id uuid primary key,user_id uuid not null,
    state text not null,county text not null,property_type text not null,
    date_range_start date,date_range_end date,min_purchases integer,cash_buyers_only boolean,llc_buyers_only boolean,
    status text check(status=any(array['pending'::text,'processing'::text,'completed'::text,'failed'::text])),total_sales_analyzed integer,total_buyers_found integer,error_message text,
    created_at timestamptz,updated_at timestamptz);
   insert into auth.users values
    ('${owner}','2026-01-01T00:00:00Z',null,null,now(),'{}'),
    ('${second}','2026-01-02T00:00:00Z',null,null,now(),'{}');`);
  const verifyOwner=id=>sql(`prepare owner(uuid) as ${ACCEPTANCE_PREPARATION_SQL.owner};execute owner(${literal(id)});`);
  assert.equal(verifyOwner(owner),owner);assert.equal(verifyOwner(second),'');
  for(const role of ['admin','beta_tester']){
   sql(`update auth.users set raw_app_meta_data=jsonb_build_object('blackspire_role',${literal(role)}) where id='${second}'`);
   assert.equal(verifyOwner(second),second);
  }
  for(const role of ['demo_viewer','client_only']){
   sql(`update auth.users set raw_app_meta_data=jsonb_build_object('blackspire_role',${literal(role)}) where id='${owner}'`);
   assert.equal(verifyOwner(owner),'');
  }
  sql(`update auth.users set raw_app_meta_data='{}';update auth.users set created_at='2026-01-01T00:00:00.000999Z' where id='${second}'`);
  assert.equal(verifyOwner(owner),'');assert.equal(verifyOwner(second),'');
  sql(`update auth.users set created_at='2026-01-02T00:00:00Z' where id='${second}'`);
  for(const [field,value] of [['deleted_at','now()'],['banned_until',"now()+interval '1 day'"],['email_confirmed_at','null']]){
   sql(`update auth.users set ${field}=${value} where id='${owner}'`);assert.equal(verifyOwner(owner),'');
   sql(`update auth.users set ${field}=${field==='email_confirmed_at'?'now()':'null'} where id='${owner}'`);
  }
  assert.equal(sql(ACCEPTANCE_PREPARATION_SQL.identity),'t');
  sql(`begin;select pg_advisory_xact_lock(206994,128);
   prepare insert_job(uuid,uuid,text,text,text,date,date,integer,boolean,boolean,timestamptz) as ${ACCEPTANCE_PREPARATION_SQL.insert};
   execute insert_job('${job}','${owner}','NC','Zola Acceptance','acceptance','2026-01-01','2026-01-02',1,false,false,'2026-09-21T10:20:30.123456Z');commit;`);
  const catalog=()=>JSON.parse(sql(ACCEPTANCE_PREPARATION_SQL.catalog));
  validateBuyerAcceptanceCatalog(catalog());
  sql(`create function public.fixture_effect() returns trigger language plpgsql as 'begin return NEW;end';
   create trigger fixture_effect before insert on public."SearchJob" for each row execute function public.fixture_effect()`);
  assert.throws(()=>validateBuyerAcceptanceCatalog(catalog()));sql('drop trigger fixture_effect on public."SearchJob"');
  sql('create index fixture_expression on public."SearchJob" ((lower(county)))');
  assert.throws(()=>validateBuyerAcceptanceCatalog(catalog()));sql('drop index fixture_expression');
  sql('alter table public."SearchJob" add constraint fixture_check check(length(county)>0)');
  assert.throws(()=>validateBuyerAcceptanceCatalog(catalog()));sql('alter table public."SearchJob" drop constraint fixture_check');
  validateBuyerAcceptanceCatalog(catalog());
  const observed=sql(`prepare read_job(uuid) as ${ACCEPTANCE_PREPARATION_SQL.read};execute read_job('${job}');`).split('|');
  assert.equal(observed[0],job);assert.equal(observed[1],owner);
  assert.deepEqual(JSON.parse(observed[2]),{state:'NC',county:'Zola Acceptance',property_type:'acceptance',date_range_start:'2026-01-01',date_range_end:'2026-01-02',min_purchases:1,cash_buyers_only:false,llc_buyers_only:false});
  assert.deepEqual(observed.slice(3),['2026-09-21T10:20:30.123456Z','2026-09-21T10:20:30.123456Z','pending','','','']);
  assert.equal(sql('select count(*) from public."SearchJob"'),'1');
  console.log('PASS: PostgreSQL 17.6 fixed acceptance SQL, explicit and legacy operator authority, tie refusal, inactive-owner refusal, dedicated insertion and six-digit revision');
}finally{cleanup();}
