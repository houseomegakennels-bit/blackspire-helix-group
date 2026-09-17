import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {ADMISSION_IDENTITY_SQL,createAttestedAdmissionExecutor,executeAdmission} from '../packages/buyer-writer/admission-executor.js';

const image=process.env.BUYER_WRITER_TEST_IMAGE
 ??'postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94';
const name=`zola-admission-executor-${process.pid}-${Date.now()}`;
const password='disposable-admission-fixture';
const login='buyer_writer_admission_login';
const creator='fixture_database_owner';
const database='admission_test';
const run=args=>execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60_000}).trim();
const admin=(statement,target='postgres')=>run(['exec',name,'psql','-X','-qAt','-U','postgres','-d',target,'-v','ON_ERROR_STOP=1','-c',statement]);
const literal=value=>`'${String(value).replaceAll("'","''")}'`;
let container=false,checks=0;
const check=(value,message)=>{assert.equal(value,true,message);checks++;};
try{
 run(['run','--detach','--rm','--name',name,'-e',`POSTGRES_PASSWORD=${password}`,image]);
 container=true;
 let consecutiveReady=0;
 for(let i=0;i<120;i++){
  const ready=spawnSync('docker',['exec',name,'sh','-c',
   'grep -qx postgres /proc/1/comm && pg_isready -U postgres >/dev/null'],{stdio:'ignore'});
  consecutiveReady=ready.status===0?consecutiveReady+1:0;
  if(consecutiveReady>=3)break;
  if(i===119)assert.fail('final disposable PostgreSQL server did not become ready');
  await delay(250);
 }
 admin(`
  create role ${creator} nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  create role buyer_writer_admission nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  create role ${login} login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '${password}';
  grant buyer_writer_admission to ${creator} with admin true, inherit false, set false;
  grant buyer_writer_admission to ${login} with admin false, inherit false, set true;
 `);
 admin(`create database ${database} owner ${creator}`);
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
  create function buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text)
   returns jsonb language sql security definer set search_path=pg_catalog
   as 'select jsonb_build_object(''state'',''reserved'',''automaticRetry'',false)';
  revoke all on schema buyer_writer from public;
  grant usage on schema buyer_writer to buyer_writer_admission;
  revoke all on function buyer_writer.lock_scope() from public;
  revoke all on function buyer_writer.reserve_operation(text,uuid,uuid,text,timestamptz) from public;
  revoke all on function buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb) from public;
  revoke all on function buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text) from public;
  grant execute on function buyer_writer.lock_scope(),
   buyer_writer.reserve_operation(text,uuid,uuid,text,timestamptz),
   buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb),
   buyer_writer.correlate_admission(text,uuid,uuid,text,uuid,text,uuid,uuid,text) to buyer_writer_admission;
 `,database);
 const query=async config=>{
  let statement=config.text;
  for(let i=config.values.length;i>0;i--)statement=statement.replaceAll(`$${i}`,literal(config.values[i-1]));
  const output=run(['exec','-e',`PGPASSWORD=${password}`,'-e','PGOPTIONS=-c role=buyer_writer_admission -c search_path=pg_catalog',
   name,'psql','-X','-qAt','-U',login,'-d',database,'-v','ON_ERROR_STOP=1','-c',statement]);
  const value=output.split('\n').filter(Boolean).at(-1);
  if(config.text===ADMISSION_IDENTITY_SQL)return {rows:[{safe:value==='t'}]};
  if(config.text.includes('reserve_operation'))return {rows:[{accepted:value==='t'}]};
  throw new Error('unexpected statement');
 };
 const creatorOid=Number(admin(`select oid from pg_roles where rolname='${creator}'`));
 const grantorOid=Number(admin(`select m.grantor from pg_auth_members m where m.roleid='buyer_writer_admission'::regrole and m.member='${creator}'::regrole`));
 check(Number.isInteger(creatorOid)&&creatorOid>10,'fixture creator must model a non-bootstrap database owner');
 check(Number.isInteger(grantorOid)&&grantorOid!==creatorOid,'fixture must separate trusted member from bootstrap grantor');
 const executor=createAttestedAdmissionExecutor({expectedLogin:login,expectedCreatorOid:creatorOid,connect:async()=>({query,release:()=>{}})});
 const ids=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'];
 const args=['https://issuer.example',ids[0],ids[1],'a'.repeat(64),new Date(Date.now()+30_000).toISOString()];
 const reserve=()=>executeAdmission(executor,'reserve',args);
 check((await reserve()).rows[0].accepted===true,'valid admission identity rejected');
 const wrongCreator=createAttestedAdmissionExecutor({expectedLogin:login,expectedCreatorOid:10,connect:async()=>({query,release:()=>{}})});
 await assert.rejects(executeAdmission(wrongCreator,'reserve',args),/unavailable/);checks++;
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
 await assert.rejects(executeAdmission(executor,'arbitrary',[]),/unavailable/);checks++;
 process.stdout.write(JSON.stringify({ok:true,checks,postgres:'disposable',supabaseShaped:true,creatorOid,grantorOid,productionTouched:false})+'\n');
}finally{
 if(container)try{run(['rm','-f',name]);}catch{}
}
