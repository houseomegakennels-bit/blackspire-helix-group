import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {EventEmitter} from 'node:events';
import {randomBytes} from 'node:crypto';
import {
 ADMISSION_TEMPLATE1_IDENTITY_SQL,BUYER_WRITER_ADMISSION_LOGIN,BUYER_WRITER_ADMISSION_ROLE,createBuyerWriterAdmissionPostgres,
} from '../packages/buyer-writer/admission-postgres.js';
import {
 ADMISSION_FENCE_SQL,createAttestedAdmissionExecutor,executeAdmission,
} from '../packages/buyer-writer/admission-executor.js';

const ca=fs.readFileSync(new URL('./fixtures/buyer-writer/supabase-production-ca.crt',import.meta.url),'utf8');
const connection=()=>({
 host:'database.invalid',port:5432,database:'writer_test',
 user:BUYER_WRITER_ADMISSION_LOGIN,
 password:randomBytes(32).toString('base64url'),ca,
});
function pools(){
 const instances=[];
 class Pool extends EventEmitter{
  constructor(config){super();this.config=config;this.clients=[];this.ended=false;instances.push(this);}
  async connect(){
   const pool=this;
   const client={
    calls:[],
    async query(config){
     this.calls.push(config);
     if(config.text===ADMISSION_TEMPLATE1_IDENTITY_SQL)return {rows:[{safe:true}]};
     if(config.text==='begin'||config.text==='commit'||config.text==='rollback')return {};
     if(config.text===ADMISSION_FENCE_SQL)return {rows:[{safe:true,locked:true}]};
     return {rows:[{safe:true,accepted:true}]};
    },
    release(destroy){this.destroyed=Boolean(destroy);},
   };
   pool.clients.push(client);return client;
  }
  async end(){this.ended=true;}
 }
 return {Pool,instances};
}

test('pins the admission login, TLS CA and fixed session limits',async()=>{
 const {Pool,instances}=pools();
 const database=await createBuyerWriterAdmissionPostgres({connection:connection(),expectedCreatorOid:16384,Pool});
 try{
  assert.equal(instances.length,2);
  const config=instances[0].config,templateConfig=instances[1].config;
  assert.equal(templateConfig.database,'template1');
  assert.equal(templateConfig.user,BUYER_WRITER_ADMISSION_LOGIN);
  assert.equal(templateConfig.application_name,'blackspire-buyer-writer-admission-template-attestation');
  assert.match(templateConfig.options,new RegExp(`role=${BUYER_WRITER_ADMISSION_ROLE}`));
  assert.equal(instances[1].clients[0].calls[0].text,ADMISSION_TEMPLATE1_IDENTITY_SQL);
  assert.deepEqual(instances[1].clients[0].calls[0].values,[BUYER_WRITER_ADMISSION_LOGIN]);
  assert.equal(config.user,BUYER_WRITER_ADMISSION_LOGIN);
  assert.deepEqual(config.ssl,{rejectUnauthorized:true,ca});
  assert.equal(config.application_name,'blackspire-buyer-writer-admission');
  assert.equal(config.client_encoding,'UTF8');
  assert.match(config.options,new RegExp(`role=${BUYER_WRITER_ADMISSION_ROLE}`));
  assert.match(config.options,/statement_timeout=10000/);
  assert.match(config.options,/lock_timeout=5000/);
  assert.match(config.options,/search_path=pg_catalog/);
  assert.match(config.options,/idle_in_transaction_session_timeout=10000/);
  assert.equal(config.connectionString,undefined);
  assert.equal(config.max,2);
  const result=await executeAdmission(database.executor,'reserve',[
   'issuer','00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000002','a'.repeat(64),
   '2030-01-01T00:00:00Z',
  ]);
  assert.deepEqual(result,{rows:[{accepted:true}]});
  const client=instances[0].clients[0];
  assert.equal(client.calls.length,4);
  assert.equal(client.calls[0].text,'begin');
  assert.equal(client.calls[1].text,ADMISSION_FENCE_SQL);
  assert.equal(client.calls[1].values[0],BUYER_WRITER_ADMISSION_LOGIN);
  assert.equal(client.calls[1].values.length,4);
  assert.equal(client.calls[1].values[1].includes('buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb)'),true);
  assert.equal(typeof client.calls[1].values[2],'string');
  assert.equal(client.calls[1].values[3],16384);
  assert.match(client.calls[2].text,/reserve_operation/);
  assert.equal(client.calls[3].text,'commit');
  assert.equal(client.destroyed,false);
  assert.equal(instances[1].clients.length,2);
  assert.equal(instances[1].clients[1].calls[0].text,ADMISSION_TEMPLATE1_IDENTITY_SQL);
  assert.deepEqual(Object.keys(database).sort(),['close','executor','isHealthy','ready']);
 }finally{await database.close();}
 assert.equal(instances[0].ended,true);assert.equal(instances[1].ended,true);
});

test('abort during identity prevents any late reserve statement',async()=>{
 let operationCalls=0,client;
 class Pool extends EventEmitter{
  on(...args){return super.on(...args);}
  async connect(){
   client={
    async query(config){
     if(config.text===ADMISSION_TEMPLATE1_IDENTITY_SQL)return {rows:[{safe:true}]};
     if(config.text==='begin'||config.text==='rollback')return {};
     if(config.text===ADMISSION_FENCE_SQL){
      await new Promise(resolve=>setTimeout(resolve,30));
      return {rows:[{safe:true,locked:true}]};
     }
     operationCalls++;
     return {rows:[{safe:true,accepted:true}]};
    },
    release(destroy){this.destroyed=Boolean(destroy);},
   };
   return client;
  }
  async end(){}
 }
 const database=await createBuyerWriterAdmissionPostgres({connection:connection(),expectedCreatorOid:16384,Pool});
 try{
  const controller=new AbortController();
  setTimeout(()=>controller.abort(),5);
  await assert.rejects(executeAdmission(database.executor,'reserve',[
   'issuer','00000000-0000-4000-8000-000000000001',
   '00000000-0000-4000-8000-000000000002','a'.repeat(64),
   '2030-01-01T00:00:00Z',
  ],{signal:controller.signal}),/unavailable/);
  assert.equal(operationCalls,0);
  assert.equal(client.destroyed,true);
 }finally{await database.close();}
});

test('transaction failures roll back and destroy, including lost commit acknowledgement',async()=>{
 const values=['issuer','00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002','a'.repeat(64),'2030-01-01T00:00:00Z'];
 for(const failure of ['fence','operation','commit']){
  const calls=[];let destroyed,committed=false;
  const client={async query(config){
   calls.push(config.text);
   if(config.text==='begin'||config.text==='rollback')return {};
   if(config.text===ADMISSION_FENCE_SQL)return failure==='fence'
    ?{rows:[{safe:false,locked:false}]}:{rows:[{safe:true,locked:true}]};
   if(config.text==='commit'){
    committed=true;if(failure==='commit')throw new Error('lost commit acknowledgement');return {};
   }
   if(failure==='operation')return {rows:[{safe:false,accepted:null}]};
   return {rows:[{safe:true,accepted:true}]};
  },release(value){destroyed=value;}};
  const executor=createAttestedAdmissionExecutor({expectedLogin:BUYER_WRITER_ADMISSION_LOGIN,
   expectedCreatorOid:16384,connect:async()=>client});
  await assert.rejects(executeAdmission(executor,'reserve',values),/unavailable|lost commit acknowledgement/);
  assert.equal(destroyed,true);
  assert.equal(calls.at(-1),'rollback');
  assert.equal(calls.includes('commit'),failure==='commit');
  assert.equal(committed,failure==='commit');
 }
});

test('template1 admission-role startup proof is fixed and fails closed',async()=>{
 assert.match(ADMISSION_TEMPLATE1_IDENTITY_SQL,/session_user=\$1 and current_user='buyer_writer_admission'/);
 assert.match(ADMISSION_TEMPLATE1_IDENTITY_SQL,/current_database\(\)='template1'/);
 assert.match(ADMISSION_TEMPLATE1_IDENTITY_SQL,/has_database_privilege\(current_user,d\.oid,'CONNECT'\)/);
 assert.match(ADMISSION_TEMPLATE1_IDENTITY_SQL,/has_schema_privilege\(current_user,n\.oid,'CREATE'\)/);
 assert.match(ADMISSION_TEMPLATE1_IDENTITY_SQL,/has_function_privilege\(current_user,p\.oid,'EXECUTE'\)/);
 for(const failure of ['connect','query','unsafe','shape']){
  const instances=[];let templateClient;
  class Pool extends EventEmitter{
   constructor(config){super();this.config=config;this.ended=false;instances.push(this);}
   async connect(){
    if(this.config.database==='template1'&&failure==='connect')throw new Error('PRIVATE TEMPLATE DETAIL');
    const client={async query(config){
     if(config.text!==ADMISSION_TEMPLATE1_IDENTITY_SQL)return {rows:[{accepted:true}]};
     if(failure==='query')throw new Error('PRIVATE TEMPLATE DETAIL');
     if(failure==='shape')return {rows:[{safe:true,extra:true}]};
     return {rows:[{safe:false}]};
    },release(destroy){this.destroyed=Boolean(destroy);}};
    if(this.config.database==='template1')templateClient=client;
    return client;
   }
   async end(){this.ended=true;}
  }
  await assert.rejects(createBuyerWriterAdmissionPostgres({connection:connection(),expectedCreatorOid:16384,Pool}),
   error=>error.message==='Buyer admission unavailable'&&!error.message.includes('PRIVATE'));
  assert.equal(instances.length,2);assert.equal(instances.every(instance=>instance.ended),true);
  if(templateClient)assert.equal(templateClient.destroyed,true);
 }
});

test('rejects missing, ambient, alternate-login and injectable connection configuration',async()=>{
 const original={DATABASE_URL:process.env.DATABASE_URL,PGHOST:process.env.PGHOST};
 process.env.DATABASE_URL='postgresql://postgres:secret@live.invalid/postgres';
 process.env.PGHOST='live.invalid';
 try{
  for(const mutate of [
   value=>{delete value.ca;},
   value=>{value.ca='';},
   value=>{value.ca='not a certificate';},
   value=>{value.user='postgres';},
   value=>{value.user='buyer_writer_admission';},
   value=>{value.connectionString='postgresql://invalid';},
   value=>{value.ssl=false;},
   value=>{value.host='';},
   value=>{value.port=0;},
   value=>{value.database='writer/test';},
   value=>{value.password='';},
  ]){
   const value=connection();mutate(value);
   const {Pool,instances}=pools();
   await assert.rejects(createBuyerWriterAdmissionPostgres({connection:value,Pool}),/unavailable/);
   assert.equal(instances.length,0);
  }
  const {Pool,instances}=pools();
  await assert.rejects(createBuyerWriterAdmissionPostgres({Pool}),/unavailable/);
  assert.equal(instances.length,0);
 }finally{
  if(original.DATABASE_URL===undefined)delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL=original.DATABASE_URL;
  if(original.PGHOST===undefined)delete process.env.PGHOST;
  else process.env.PGHOST=original.PGHOST;
 }
});

test('idle pool failure fences future checkout and close is idempotent',async()=>{
 const {Pool,instances}=pools();
 const database=await createBuyerWriterAdmissionPostgres({connection:connection(),expectedCreatorOid:16384,Pool});
 assert.equal(database.isHealthy(),true);
 instances[0].emit('error',new Error('PRIVATE SOCKET DETAIL'));
 assert.equal(database.isHealthy(),false);
 await assert.rejects(executeAdmission(database.executor,'reserve',[
  'issuer','00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002','a'.repeat(64),
  '2030-01-01T00:00:00Z',
 ]),error=>/unavailable/.test(String(error))&&!String(error).includes('PRIVATE'));
 const closing=database.close();
 assert.equal(database.close(),closing);
 await closing;
 assert.equal(database.isHealthy(),false);
 assert.equal(instances[0].ended,true);
});

test('close destroys a checked-out session and exposes no generic SQL surface',async()=>{
 const {Pool,instances}=pools();
 const database=await createBuyerWriterAdmissionPostgres({connection:connection(),expectedCreatorOid:16384,Pool});
 let resolveIdentity;
 instances[0].connect=async()=>{
  const client={
   query:()=>new Promise(resolve=>{resolveIdentity=resolve;}),
   release(destroy){this.destroyed=Boolean(destroy);},
  };
  instances[0].clients.push(client);return client;
 };
 const pending=executeAdmission(database.executor,'reserve',[
  'issuer','00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002','a'.repeat(64),
  '2030-01-01T00:00:00Z',
 ]);
 await new Promise(resolve=>setImmediate(resolve));
 await database.close();
 assert.equal(instances[0].clients[0].destroyed,true);
 resolveIdentity({rows:[{safe:true}]});
 await assert.rejects(pending,/unavailable/);
 assert.equal(database.query,undefined);
});

test('eager template attestation bounds query time, aborts it and closes both pools',async()=>{
 const instances=[];let templateClient,querySignal;
 class Pool extends EventEmitter{
  constructor(config){super();this.config=config;this.ended=false;instances.push(this);}
  async connect(){
   const client={
    query(config){querySignal=config.signal;return new Promise(()=>{});},
    release(destroy){this.destroyed=Boolean(destroy);},
   };
   if(this.config.database==='template1')templateClient=client;
   return client;
  }
  async end(){this.ended=true;}
 }
 const started=Date.now();
 await assert.rejects(
  createBuyerWriterAdmissionPostgres({connection:connection(),expectedCreatorOid:16384,Pool}),
  error=>error.message==='Buyer admission unavailable'&&!String(error).includes('PRIVATE'));
 const elapsed=Date.now()-started;
 assert.ok(elapsed>=1900&&elapsed<3500,`unexpected eager query deadline: ${elapsed}ms`);
 assert.equal(querySignal instanceof AbortSignal,true);
 assert.equal(querySignal.aborted,true);
 assert.equal(templateClient.destroyed,true);
 assert.equal(instances.length,2);
 assert.equal(instances.every(pool=>pool.ended),true);
});

test('eager template checkout deadline closes pools and destroys a late checkout',async()=>{
 const instances=[];let resolveConnect,lateClient,queries=0;
 class Pool extends EventEmitter{
  constructor(config){super();this.config=config;this.ended=false;instances.push(this);}
  connect(){
   if(this.config.database!=='template1')throw new Error('unexpected current database checkout');
   return new Promise(resolve=>{resolveConnect=resolve;});
  }
  async end(){this.ended=true;}
 }
 const pending=createBuyerWriterAdmissionPostgres({connection:connection(),expectedCreatorOid:16384,Pool});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(typeof resolveConnect,'function');
 const started=Date.now();
 await assert.rejects(pending,error=>error.message==='Buyer admission unavailable');
 assert.ok(Date.now()-started>=1900);
 assert.equal(instances.length,2);
 assert.equal(instances.every(pool=>pool.ended),true);
 lateClient={
  query(){queries++;return {rows:[{safe:true}]};},
  release(destroy){this.destroyed=Boolean(destroy);},
 };
 resolveConnect(lateClient);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(lateClient.destroyed,true);
 assert.equal(queries,0);
});
