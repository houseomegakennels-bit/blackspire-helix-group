import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createBuyerWriterPostgres, WRITER_IDENTITY_SQL } from '../packages/buyer-writer/postgres.js';

const connection = () => ({host:'database.invalid',port:5432,database:'writer_test',password:randomBytes(32).toString('base64url')});
const apply='select buyer_writer.apply($1,$2,$3::jsonb) as result';
const issue='select buyer_writer.issue($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::timestamptz,$8::uuid) as result';
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
        return {rows:[{result:{ok:true}}]};
      },release:destroy=>pool.destroyed.push(Boolean(destroy))};
    }
    async end(){this.ended=true;}
  }
  return {Pool,instances};
}
test('dedicated pools pin TLS, roles, timeouts and validate every checkout',async()=>{
  const {Pool,instances}=pools();
  const db=await createBuyerWriterPostgres({runtime:connection(),issuer:connection(),Pool});
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
    assert.equal(instances[0].calls.filter(c=>c.text===WRITER_IDENTITY_SQL).length,3);
    assert.equal(instances[1].calls.filter(c=>c.text===WRITER_IDENTITY_SQL).length,2);
  } finally {await db.close();}
  assert.ok(instances.every(p=>p.ended));
  await assert.rejects(db.runtimeQuery(apply,[]),/unavailable/);
});
test('config cannot inject an admin role, connection string, ambient default or disabled TLS',async()=>{
  for(const bad of [{user:'postgres'},{connectionString:'postgres://invalid'},{ssl:false},{host:''},{password:''},{port:0}]) {
    const {Pool,instances}=pools();
    await assert.rejects(createBuyerWriterPostgres({runtime:{...connection(),...bad},issuer:connection(),Pool}),/unavailable/);
    assert.equal(instances.length,0);
  }
  const {Pool,instances}=pools();
  await assert.rejects(createBuyerWriterPostgres({runtime:connection(),issuer:{...connection(),database:'different'},Pool}),/unavailable/);
  assert.equal(instances.length,0);
});
test('idle pool errors stop admission without exposing driver details',async()=>{
  const {Pool,instances}=pools();const db=await createBuyerWriterPostgres({runtime:connection(),issuer:connection(),Pool});
  assert.equal(db.isHealthy(),true);instances[0].emit('error',new Error('PRIVATE SOCKET DETAILS'));
  assert.equal(db.isHealthy(),false);
  await assert.rejects(db.runtimeQuery(apply,[]),/unavailable/);await db.close();
});
test('capacity saturation rejects without driver work and close fences an in-flight result',async()=>{
  const {Pool,instances}=pools();const db=await createBuyerWriterPostgres({runtime:connection(),issuer:connection(),Pool});
  const original=instances[0].connect.bind(instances[0]);const releases=[];
  instances[0].connect=async()=>{
    const client=await original();const query=client.query;
    client.query=(text,values)=>text===apply?new Promise(resolve=>releases.push(()=>resolve({rows:[{result:{ok:true}}]}))):query(text,values);
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
  await assert.rejects(createBuyerWriterPostgres({runtime:connection(),issuer:connection(),Pool}),/unavailable/);
  assert.ok(instances.every(p=>p.ended));assert.equal(instances[0].destroyed[0],true);
});
test('statement injection and opposite-role statements never reach the driver',async()=>{
  const {Pool,instances}=pools();const db=await createBuyerWriterPostgres({runtime:connection(),issuer:connection(),Pool});
  try {
    const count=instances.reduce((n,p)=>n+p.calls.length,0);
    for(const text of [issue,'select * from public."SearchJob"',apply+';select 1'])await assert.rejects(db.runtimeQuery(text,[]),/unavailable/);
    await assert.rejects(db.issuerQuery(apply,[]),/unavailable/);
    assert.equal(instances.reduce((n,p)=>n+p.calls.length,0),count);
  } finally {await db.close();}
});
test('database errors destroy the connection without replay or private error disclosure',async()=>{
  const {Pool,instances}=pools({fail:true});const db=await createBuyerWriterPostgres({runtime:connection(),issuer:connection(),Pool});
  try {
    await assert.rejects(db.runtimeQuery(apply,['digest','workspace','{}']),error=>error.code==='42501'&&!String(error).includes('PRIVATE'));
    assert.equal(instances[0].calls.filter(c=>c.text===apply).length,1);assert.equal(instances[0].destroyed.at(-1),true);
  } finally {await db.close();}
});
test('malformed identity results destroy the connection before a write',async()=>{
  for(const rows of [[],[{}],[{safe:'true'}],[{safe:true},{safe:true}]]) {
    const {Pool,instances}=pools();const db=await createBuyerWriterPostgres({runtime:connection(),issuer:connection(),Pool});
    instances[0].connect=async()=>({query:async text=>{assert.equal(text,WRITER_IDENTITY_SQL);return {rows};},release:destroy=>assert.equal(destroy,true)});
    await assert.rejects(db.runtimeQuery(apply,[]),/unavailable/);await db.close();
  }
});
test('timed-out checkout is destroyed on late arrival without executing SQL',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {Pool,instances}=pools();const db=await createBuyerWriterPostgres({runtime:connection(),issuer:connection(),Pool});
  let arrived;instances[0].connect=()=>new Promise(resolve=>{arrived=resolve;});
  const rejection=assert.rejects(db.runtimeQuery(apply,[]),/unavailable/);
  t.mock.timers.tick(14000);await rejection;
  let destroyed=false;
  arrived({query:()=>assert.fail('late checkout must not query'),release:value=>{destroyed=value;}});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(destroyed,true);await db.close();
});
test('a stalled driver shutdown cannot hang the component indefinitely',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const {Pool,instances}=pools();const db=await createBuyerWriterPostgres({runtime:connection(),issuer:connection(),Pool});
  instances[0].end=()=>new Promise(()=>{});
  const closing=db.close();const rejection=assert.rejects(closing,/unavailable/);
  assert.equal(db.close(),closing);t.mock.timers.tick(2000);await rejection;assert.equal(db.isHealthy(),false);
});
