import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import pg from 'pg';
import {ADMISSION_FENCE_SQL,createAttestedAdmissionExecutor,executeAdmission} from '../packages/buyer-writer/admission-executor.js';

const image=process.env.BUYER_WRITER_TEST_IMAGE
 ??'postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94';
const name=`zola-admission-executor-${process.pid}-${Date.now()}`;
const password='disposable-admission-fixture';
const login='buyer_writer_admission_login';
const creator='postgres';
const database='admission_test';
const {Pool}=pg;
const run=(args,input)=>execFileSync('docker',args,{input,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:60_000,maxBuffer:2**20}).trim();
const psql=(user,target,statement)=>run(['exec','-i',name,'psql','-X','-qAt','-U',user,'-d',target,'-v','ON_ERROR_STOP=1'],statement);
const admin=(statement,target=database)=>psql('fixture_admin',target,statement);
const literal=value=>`'${String(value).replaceAll("'","''")}'`;
let container=false,checks=0,pool,client;
const check=(value,message)=>{assert.equal(value,true,message);checks++;};
try{
 run(['run','--detach','--rm','--name',name,'-p','127.0.0.1::5432',
  '-e','POSTGRES_USER=fixture_admin','-e','POSTGRES_HOST_AUTH_METHOD=trust',
  '-e',`POSTGRES_DB=${database}`,image]);
 container=true;
 let consecutiveReady=0;
 for(let i=0;i<120;i++){
  const ready=spawnSync('docker',['exec',name,'sh','-c',
   `grep -qx postgres /proc/1/comm && pg_isready -U fixture_admin -d ${database} >/dev/null`],{stdio:'ignore'});
  consecutiveReady=ready.status===0?consecutiveReady+1:0;
  if(consecutiveReady>=3)break;
  if(i===119)assert.fail('final disposable PostgreSQL server did not become ready');
  await delay(250);
 }
 admin(`
  create role ${creator} login noinherit superuser createdb createrole replication bypassrls;
  create role buyer_writer_admission nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  create role ${login} login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '${password}';
  grant buyer_writer_admission to ${creator} with admin true, inherit false, set false;
  set role ${creator};
  grant buyer_writer_admission to ${login} with admin false, inherit false, set true;
  reset role;
 `);
 admin(`alter database ${database} owner to ${creator}`);
 admin(`revoke connect,create,temp on database postgres from public; revoke connect,create,temp on database template0 from public; revoke connect,create,temp on database template1 from public; grant connect on database template1 to public`);
 admin(`
  revoke temp on database ${database} from public;
  revoke create on schema public from public;
  create schema buyer_writer authorization ${creator};
  create function buyer_writer.lock_scope() returns boolean language sql security definer
   set search_path=pg_catalog as 'select true';
  create function buyer_writer.reserve_operation(text,uuid,uuid,text,timestamptz) returns boolean language sql security definer
   set search_path=pg_catalog as 'select true';
  create function buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb)
   returns jsonb language sql security definer set search_path=pg_catalog
   as 'select jsonb_build_object(''ok'',true,''operation'',''start'',''chunkIndex'',0)';
  create function buyer_writer.execute_admitted_issue(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,text,jsonb,jsonb,timestamptz,uuid)
   returns jsonb language sql security definer set search_path=pg_catalog
   as 'select jsonb_build_object(''dispatchId'',$15,''generation'',1)';
  create function buyer_writer.execute_admitted_cancel(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid)
   returns jsonb language sql security definer set search_path=pg_catalog
   as 'select jsonb_build_object(''cancelled'',true,''jobId'',$10)';
  create function buyer_writer.execute_admitted_reconcile(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,uuid,timestamptz)
   returns jsonb language sql security definer set search_path=pg_catalog
   as 'select jsonb_build_object(''dispatchId'',$11,''generation'',null,''state'',''absent'')';
  create function buyer_writer.execute_admitted_receipt(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,bigint,text,integer)
   returns jsonb language sql security definer set search_path=pg_catalog
   as 'select jsonb_build_object(''found'',false,''receipt'',null)';
  create function buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text)
   returns jsonb language sql security definer set search_path=pg_catalog
   as 'select jsonb_build_object(''state'',''reserved'',''automaticRetry'',false)';
  create function buyer_writer.recover_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text)
   returns jsonb language sql security definer set search_path=pg_catalog
   as 'select jsonb_build_object(''state'',''reserved'',''automaticRetry'',false)';
  revoke all on schema buyer_writer from public;
  grant usage on schema buyer_writer to buyer_writer_admission;
  revoke all on function buyer_writer.lock_scope() from public;
  revoke all on function buyer_writer.reserve_operation(text,uuid,uuid,text,timestamptz) from public;
  revoke all on function buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb) from public;
  revoke all on function buyer_writer.execute_admitted_issue(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,text,jsonb,jsonb,timestamptz,uuid) from public;
  revoke all on function buyer_writer.execute_admitted_cancel(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid) from public;
  revoke all on function buyer_writer.execute_admitted_reconcile(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,uuid,timestamptz) from public;
  revoke all on function buyer_writer.execute_admitted_receipt(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,bigint,text,integer) from public;
  revoke all on function buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text) from public;
  revoke all on function buyer_writer.recover_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text) from public;
  grant execute on function buyer_writer.lock_scope(),
   buyer_writer.reserve_operation(text,uuid,uuid,text,timestamptz),
   buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb),
   buyer_writer.execute_admitted_issue(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,text,jsonb,jsonb,timestamptz,uuid),
   buyer_writer.execute_admitted_cancel(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid),
   buyer_writer.execute_admitted_reconcile(text,uuid,uuid,text,uuid,text,uuid,uuid,text,uuid,uuid,timestamptz),
   buyer_writer.execute_admitted_receipt(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,bigint,text,integer),
   buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text),
   buyer_writer.recover_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,uuid,uuid,text,text) to buyer_writer_admission;
 `,database);
 admin(`revoke buyer_writer_admission from ${login},${creator};drop schema buyer_writer cascade;
  drop role ${login};drop role buyer_writer_admission`);
 psql(creator,database,readFileSync(new URL('../tests/fixtures/buyer-writer/schema.sql',import.meta.url),'utf8'));
 psql(creator,database,readFileSync(new URL('../tests/fixtures/buyer-writer/nexus.sql',import.meta.url),'utf8'));
 const migrations=['20260904201014_nexus_read_security.sql','20260904223151_buyer_browser_security.sql']
  .map(file=>readFileSync(new URL('../frontend/supabase/migrations/'+file,import.meta.url),'utf8')).join('\n');
 psql(creator,database,`begin;${migrations}commit;`);
 const creatorOid=Number(admin(`select oid from pg_roles where rolname='${creator}'`));
 admin(`alter role ${creator} nosuperuser createrole`);
 const installer=readFileSync(new URL('../packages/buyer-writer/sql/install.sql',import.meta.url),'utf8');
 psql(creator,database,`set blackspire.buyer_writer_creator_oid=${literal(creatorOid)};${installer}`);
 psql(creator,database,`create role ${login} login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password ${literal(password)};
  grant buyer_writer_admission to ${login} with admin false,inherit false,set true granted by ${creator}`);
 const portText=run(['port',name,'5432/tcp']);
 const portMatch=portText.match(/127\.0\.0\.1:(\d+)/);assert.ok(portMatch,'published disposable port unavailable');
 pool=new Pool({host:'127.0.0.1',port:Number(portMatch[1]),database,user:login,password,
  options:'-c role=buyer_writer_admission -c search_path=pg_catalog -c statement_timeout=10000 -c lock_timeout=5000',max:1});
 client=await pool.connect();const calls=[],releases=[];
 const query=async config=>{calls.push(config);return client.query(config);};

 const adminGrantorOid=Number(admin(`select m.grantor from pg_auth_members m where m.roleid='buyer_writer_admission'::regrole and m.member='${creator}'::regrole`));
 const loginGrantorOid=Number(admin(`select m.grantor from pg_auth_members m where m.roleid='buyer_writer_admission'::regrole and m.member='${login}'::regrole`));
 check(Number.isInteger(creatorOid)&&creatorOid>10,'fixture creator must model a non-bootstrap database owner');
 check(Number.isInteger(adminGrantorOid)&&adminGrantorOid!==creatorOid,'creator admin edge must originate at bootstrap');
 check(loginGrantorOid===creatorOid,'login SET edge must originate at trusted creator');
 const executor=createAttestedAdmissionExecutor({expectedLogin:login,expectedCreatorOid:creatorOid,
  connect:async()=>({query,release:value=>releases.push(value)})});
 const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 const admit=async(operation,values)=>{
  const start=calls.length,result=await executeAdmission(executor,operation,values);
  const transaction=calls.slice(start);
  check(transaction.length===4,'admission did not use one four-statement transaction');
  check(transaction[0].text==='begin'&&transaction[1].text===ADMISSION_FENCE_SQL,
   'admission did not begin with the fixed fence');
  check(transaction[2].text.includes(`buyer_writer.${operation==='reserve'?'reserve_operation':operation==='correlate'?'correlate_admission':operation==='recover'?'recover_admission':`execute_admitted_${operation}`}(`),
   'admission did not use its guarded fixed operation');
  check(transaction[3].text==='commit','admission did not commit after its guarded operation');
  return result;
 };
 const rejectAdmit=async(operation,values)=>{
  const start=calls.length,releaseStart=releases.length;
  await assert.rejects(executeAdmission(executor,operation,values));
  const transaction=calls.slice(start);
  check(transaction.length===4&&transaction[0].text==='begin'&&transaction[1].text===ADMISSION_FENCE_SQL,
   'rejected admission did not begin with the fixed fence');
  const routine=operation==='correlate'?'correlate_admission':operation==='recover'?'recover_admission'
   :`execute_admitted_${operation}`;
  check(transaction[2].text.includes(`case when admission.safe and checked.safe then buyer_writer.${routine}(`),
   'rejected admission did not reach only its guarded fixed operation');
  check(transaction[3].text==='rollback','rejected admission did not roll back');
  check(releases.length===releaseStart+1&&releases.at(-1)===true,'rejected admission did not destroy its session');
 };
 const args=['https://issuer.example',uid(1),uid(2),'a'.repeat(64),new Date(Date.now()+30_000).toISOString()];
 let reserveSequence=0;
 const reserve=()=>{
  const offset=reserveSequence++*20;
  return admit('reserve',['https://issuer.example',uid(1+offset),uid(2+offset),'a'.repeat(64),
   new Date(Date.now()+30_000).toISOString()]);
 };
 check((await reserve()).rows[0].accepted===true,'valid admission identity rejected');
 const base=['https://issuer.example',uid(1),uid(2),'a'.repeat(64),uid(3),'b'.repeat(40),uid(4),uid(5),'isolated'];
 await rejectAdmit('apply',[...base,'c'.repeat(64),JSON.stringify({})]);
 await rejectAdmit('issue',[...base,uid(6),'c'.repeat(64),JSON.stringify({}),JSON.stringify({}),'2026-09-17T20:00:00Z',uid(5)]);
 await rejectAdmit('cancel',[...base,uid(6)]);
 await rejectAdmit('reconcile',[...base,uid(6),uid(7),'2026-09-17T20:00:00Z']);
 await rejectAdmit('receipt',[...base,'c'.repeat(64),uid(6),uid(7),1,'start',0]);
 check((await admit('correlate',base)).rows[0].result.state==='reserved','correlation wrapper unavailable');
 await rejectAdmit('recover',[...base,'https://issuer.example',uid(8),uid(9),'d'.repeat(64),'apply']);
 const wrongCreator=createAttestedAdmissionExecutor({expectedLogin:login,expectedCreatorOid:10,connect:async()=>({query,release:()=>{}})});
 await assert.rejects(executeAdmission(wrongCreator,'reserve',args),/unavailable/);checks++;
 admin(`revoke buyer_writer_admission from ${login}; grant buyer_writer_admission to ${login} with admin false, inherit false, set true`);
 await assert.rejects(reserve(),/unavailable/);checks++;
 admin(`revoke buyer_writer_admission from ${login}; set role ${creator}; grant buyer_writer_admission to ${login} with admin false, inherit false, set true; reset role`);
 check((await reserve()).rows[0].accepted===true,'creator-granted login edge was not restored');
 admin('create table public.direct_leak(id integer); grant select on public.direct_leak to '+login,database);
 await assert.rejects(reserve(),/unavailable/);checks++;
 admin('revoke select on public.direct_leak from '+login+'; drop table public.direct_leak',database);
 admin('create role unexpected_parent; grant unexpected_parent to buyer_writer_admission with admin false, inherit false, set true');
 await assert.rejects(reserve(),/unavailable/);checks++;
 admin('revoke unexpected_parent from buyer_writer_admission');
 admin("create function public.unexpected() returns integer language sql as 'select 1'",database);
 await assert.rejects(reserve(),/unavailable/);checks++;
 admin('drop function public.unexpected()',database);
 admin('grant unexpected_parent to '+login+' with admin false, inherit false, set true');
 await assert.rejects(reserve(),/unavailable/);checks++;
 admin('revoke unexpected_parent from '+login);
 admin('revoke connect on database template1 from public');
 await assert.rejects(reserve(),/unavailable/);checks++;
 admin('grant connect on database template1 to public');
 check((await reserve()).rows[0].accepted===true,'required inert template1 CONNECT was not restored');
 admin('grant temp on database template1 to public');
 await assert.rejects(reserve(),/unavailable/);checks++;
 admin('revoke temp on database template1 from public');
 check((await reserve()).rows[0].accepted===true,'template1 TEMP revocation was not restored');
 admin('grant connect on database template0 to public');
 await assert.rejects(reserve(),/unavailable/);checks++;
 admin('revoke connect on database template0 from public');
 check((await reserve()).rows[0].accepted===true,'template0 CONNECT revocation was not restored');
 admin('grant connect on database postgres to public');
 await assert.rejects(reserve(),/unavailable/);checks++;
 admin('revoke connect on database postgres from public');
 check((await reserve()).rows[0].accepted===true,'cross-database CONNECT revocation was not restored');
 await assert.rejects(executeAdmission(executor,'arbitrary',[]),/unavailable/);checks++;
 process.stdout.write(JSON.stringify({ok:true,checks,postgres:'disposable',supabaseShaped:true,creatorOid,adminGrantorOid,loginGrantorOid,productionTouched:false})+'\n');
}finally{
 try{client?.release();}catch{}
 try{await pool?.end();}catch{}
 if(container)try{run(['rm','-f',name]);}catch{}
}
