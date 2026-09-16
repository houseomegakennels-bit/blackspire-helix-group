import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createBuyerWriterPostgres, WRITER_IDENTITY_SQL } from '../packages/buyer-writer/postgres.js';

const connection = () => ({host:'database.invalid',port:5432,database:'writer_test',password:randomBytes(32).toString('base64url')});
const create = options => createBuyerWriterPostgres({creatorOid:16384,...options});
const apply='select buyer_writer.apply($1,$2,$3::jsonb) as result';
const issue='select buyer_writer.issue($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::timestamptz,$8::uuid) as result';
test('identity probe treats inherited and PUBLIC authority as capability only when its schema is reachable',()=>{
  assert.match(WRITER_IDENTITY_SQL,/role\.rolname in\('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer'\)[\s\S]*member\.rolname='postgres'/);
  assert.match(WRITER_IDENTITY_SQL,/member\.oid=\$4::oid[\s\S]*member\.oid=\(select datdba from pg_database where datname=current_database\(\)\)/);
  assert.match(WRITER_IDENTITY_SQL,/blackspire-buyer-writer:v1:creator-oid=/);
  assert.match(WRITER_IDENTITY_SQL,/pg_get_userbyid\([^)]*\)='postgres'/);
  assert.match(WRITER_IDENTITY_SQL,/sha256\(convert_to\(p\.prosrc,'UTF8'\)\)/);
  assert.match(WRITER_IDENTITY_SQL,/values\(current_user\),\('buyer_writer_owner'\)[\s\S]*has_schema_privilege\(w\.role_name,n\.oid,'USAGE'\)[\s\S]*has_function_privilege\(w\.role_name,p\.oid,'EXECUTE'\)/);
  assert.match(WRITER_IDENTITY_SQL,/w\.role_name='buyer_writer_owner'[\s\S]*jsonb_to_recordset\(\$3::jsonb\)/);
  assert.match(WRITER_IDENTITY_SQL,/pg_database[\s\S]*datname<>current_database\(\)[\s\S]*datallowconn[\s\S]*has_database_privilege\([^)]*'CONNECT'\)/);
  assert.match(WRITER_IDENTITY_SQL,/pg_trigger[\s\S]*not t\.tgisinternal[\s\S]*SearchJob[\s\S]*dispatches/);
});
function pools({unsafe=false,fail=false}={}) {
  const instances=[];
  class Pool extends EventEmitter {
    constructor(config){super();this.config=config;this.calls=[];this.destroyed=[];this.ended=false;instances.push(this);}
    async connect(){
      const pool=this;
      return {query:async(text,values)=>{
        pool.calls.push({text,values});
        if(text===WRITER_IDENTITY_SQL)return {rows:[{safe:!unsafe}]};
        if(fail)throw Object.assign(new Error('PRIVATE DATABASE DETAILS'),{code:'42501'});
        if(text.includes('buyer_writer.lock_scope()'))return {rows:[{safe:!unsafe,locked:!unsafe}]};
        if(text.includes('with checked as materialized')&&text.includes('buyer_writer.'))return {rows:[{safe:!unsafe,result:{ok:true}}]};
        return {rows:[{result:{ok:true}}]};
      },release:destroy=>pool.destroyed.push(Boolean(destroy))};
    }
    async end(){this.ended=true;}
  }
  return {Pool,instances};
}
test('dedicated pools pin TLS, roles, timeouts and validate every checkout',async()=>{
  const {Pool,instances}=pools();
  const db=await create({runtime:connection(),issuer:connection(),Pool});
  try {
    assert.deepEqual(instances.map(p=>p.config.user),['buyer_writer_runtime','buyer_writer_issuer']);
    for(const pool of instances){
      assert.equal(pool.config.ssl.rejectUnauthorized,true);assert.equal(pool.config.connectionTimeoutMillis,2000);
      assert.match(pool.config.options,/statement_timeout=10000/);assert.match(pool.config.options,/lock_timeout=5000/);
      assert.equal(pool.config.connectionString,undefined);
    }
    await db.runtimeQuery(apply,['digest','workspace','{}']);
    await db.runtimeQuery(apply,['digest','workspace','{}']);
    await db.issuerQuery(issue,Array(8).fill(null));
    assert.equal(instances[0].calls.filter(c=>c.text===WRITER_IDENTITY_SQL).length,1);
    assert.equal(instances[1].calls.filter(c=>c.text===WRITER_IDENTITY_SQL).length,1);
    assert.equal(instances[0].calls.filter(c=>c.text==='begin').length,2);
    assert.equal(instances[0].calls.filter(c=>c.text.includes('buyer_writer.lock_scope()')).length,2);
    assert.equal(instances[0].calls.filter(c=>c.text.includes('buyer_writer.apply(')&&c.text!==apply).length,2);
    assert.equal(instances[0].calls.filter(c=>c.text==='commit').length,2);
    assert.equal(instances[0].calls.filter(c=>c.text===apply).length,0);
    const firstOperation=instances[0].calls.find(c=>c.text.includes('buyer_writer.apply(')&&c.text!==apply);
    assert.match(firstOperation.text,/pg_database[\s\S]*pg_trigger[\s\S]*case when checked\.safe then operation\.result/);
    assert.equal(firstOperation.values.length,7);
    assert.deepEqual(instances[0].calls.slice(1,5).map(c=>c.text==='begin'||c.text==='commit'?c.text:c.text.includes('lock_scope')?'fence':'operation'),['begin','fence','operation','commit']);
    for(const call of instances.flatMap(pool=>pool.calls.filter(c=>c.text===WRITER_IDENTITY_SQL))){
      assert.equal(call.values.length,4);assert.equal(JSON.parse(call.values[2]).length,13);assert.equal(call.values[3],16384);
    }
  } finally {await db.close();}
  assert.ok(instances.every(p=>p.ended));
  await assert.rejects(db.runtimeQuery(apply,[]),/unavailable/);
});
test('config cannot inject an admin role, connection string, ambient default or disabled TLS',async()=>{
  for(const bad of [{user:'postgres'},{connectionString:'postgres://invalid'},{ssl:false},{host:''},{password:''},{port:0}]) {
    const {Pool,instances}=pools();
    await assert.rejects(create({runtime:{...connection(),...bad},issuer:connection(),Pool}),/unavailable/);
    assert.equal(instances.length,0);
  }
  const {Pool,instances}=pools();
  await assert.rejects(create({runtime:connection(),issuer:{...connection(),database:'different'},Pool}),/unavailable/);
  assert.equal(instances.length,0);
  for(const creatorOid of [undefined,0,'16384',4294967296]){
    const {Pool,instances}=pools();await assert.rejects(createBuyerWriterPostgres({creatorOid,runtime:connection(),issuer:connection(),Pool}),/unavailable/);assert.equal(instances.length,0);
  }
});
test('idle pool errors stop admission without exposing driver details',async()=>{
  const {Pool,instances}=pools();const db=await create({runtime:connection(),issuer:connection(),Pool});
  assert.equal(db.isHealthy(),true);instances[0].emit('error',new Error('PRIVATE SOCKET DETAILS'));
  assert.equal(db.isHealthy(),false);
  await assert.rejects(db.runtimeQuery(apply,[]),/unavailable/);await db.close();
});
test('capacity saturation rejects without driver work and close fences an in-flight result',async()=>{
  const {Pool,instances}=pools();const db=await create({runtime:connection(),issuer:connection(),Pool});
  const original=instances[0].connect.bind(instances[0]);const releases=[];
  instances[0].connect=async()=>{
    const client=await original();const query=client.query;
    client.query=(text,values)=>text.includes('with checked as materialized')&&text.includes('buyer_writer.apply(')?new Promise(resolve=>releases.push(()=>resolve({rows:[{safe:true,result:{ok:true}}]}))):query(text,values);
    return client;
  };
  const requests=Array.from({length:4},()=>db.runtimeQuery(apply,[]));
  const observed=requests.map(request=>assert.rejects(request,/unavailable/));
  await new Promise(resolve=>setImmediate(resolve));assert.equal(releases.length,4);
  await assert.rejects(db.runtimeQuery(apply,[]),/unavailable/);
  await db.close();releases.forEach(release=>release());await Promise.all(observed);
  assert.equal(instances[0].destroyed.filter(Boolean).length,4);
});
test('unsafe identity fails startup and closes every partially initialized pool',async()=>{
  const {Pool,instances}=pools({unsafe:true});
  await assert.rejects(create({runtime:connection(),issuer:connection(),Pool}),/unavailable/);
  assert.ok(instances.every(p=>p.ended));assert.equal(instances[0].destroyed[0],true);
});
test('statement injection and opposite-role statements never reach the driver',async()=>{
  const {Pool,instances}=pools();const db=await create({runtime:connection(),issuer:connection(),Pool});
  try {
    const count=instances.reduce((n,p)=>n+p.calls.length,0);
    for(const text of [issue,'select * from public."SearchJob"',apply+';select 1'])await assert.rejects(db.runtimeQuery(text,[]),/unavailable/);
    await assert.rejects(db.issuerQuery(apply,[]),/unavailable/);
    assert.equal(instances.reduce((n,p)=>n+p.calls.length,0),count);
  } finally {await db.close();}
});
test('database errors destroy the connection without replay or private error disclosure',async()=>{
  const {Pool,instances}=pools({fail:true});const db=await create({runtime:connection(),issuer:connection(),Pool});
  try {
    await assert.rejects(db.runtimeQuery(apply,['digest','workspace','{}']),error=>error.code==='42501'&&!String(error).includes('PRIVATE'));
    assert.equal(instances[0].calls.filter(c=>c.text==='begin').length,1);assert.equal(instances[0].destroyed.at(-1),true);
  } finally {await db.close();}
});
test('malformed identity results destroy the connection before a write',async()=>{
  for(const rows of [[],[{}],[{safe:'true'}],[{safe:true},{safe:true}]]) {
    const {Pool,instances}=pools();const db=await create({runtime:connection(),issuer:connection(),Pool});
    instances[0].connect=async()=>({query:async text=>{assert.equal(text,WRITER_IDENTITY_SQL);return {rows};},release:destroy=>assert.equal(destroy,true)});
    await assert.rejects(db.runtimeQuery(apply,[]),/unavailable/);await db.close();
  }
});
test('final in-transaction identity drift rolls back without committing the fixed operation',async()=>{
  const {Pool,instances}=pools();const db=await create({runtime:connection(),issuer:connection(),Pool});
  const calls=[];
  instances[0].connect=async()=>({query:async(text)=>{
    calls.push(text);
    if(text==='begin'||text==='rollback')return {rows:[]};
    if(text.includes('buyer_writer.lock_scope()'))return {rows:[{safe:true,locked:true}]};
    if(text.includes('buyer_writer.apply('))return {rows:[{safe:false,result:null}]};
    assert.fail('unexpected transaction statement');
  },release:destroy=>assert.equal(destroy,true)});
  await assert.rejects(db.runtimeQuery(apply,['digest','workspace','{}']),/unavailable/);
  assert.deepEqual(calls.map(text=>text==='begin'||text==='rollback'?text:text.includes('lock_scope')?'fence':'operation'),['begin','fence','operation','rollback']);
  assert.ok(!calls.includes('commit'));await db.close();
});
test('timed-out checkout is destroyed on late arrival without executing SQL',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {Pool,instances}=pools();const db=await create({runtime:connection(),issuer:connection(),Pool});
  let arrived;instances[0].connect=()=>new Promise(resolve=>{arrived=resolve;});
  const rejection=assert.rejects(db.runtimeQuery(apply,[]),/unavailable/);
  t.mock.timers.tick(14000);await rejection;
  let destroyed=false;
  arrived({query:()=>assert.fail('late checkout must not query'),release:value=>{destroyed=value;}});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(destroyed,true);await db.close();
});
test('a stalled driver shutdown cannot hang the component indefinitely',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {Pool,instances}=pools();const db=await create({runtime:connection(),issuer:connection(),Pool});
  instances[0].end=()=>new Promise(()=>{});
  const closing=db.close();const rejection=assert.rejects(closing,/unavailable/);
  assert.equal(db.close(),closing);t.mock.timers.tick(2000);await rejection;assert.equal(db.isHealthy(),false);
});
