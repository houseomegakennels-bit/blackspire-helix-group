import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {EventEmitter} from 'node:events';
import {randomBytes} from 'node:crypto';
import {
 ADMISSION_TEMPLATE1_IDENTITY_SQL,BUYER_WRITER_ADMISSION_LOGIN,
 createBuyerWriterAdmissionPostgres,
} from '../packages/buyer-writer/admission-postgres.js';
import {ADMISSION_READINESS_SQL} from '../packages/buyer-writer/admission-executor.js';

const ca=fs.readFileSync(new URL('./fixtures/buyer-writer/supabase-production-ca.crt',import.meta.url),'utf8');
const connection=()=>({
 host:'database.invalid',port:5432,database:'writer_test',
 user:BUYER_WRITER_ADMISSION_LOGIN,
 password:randomBytes(32).toString('base64url'),ca,
});

function harness(respond){
 const instances=[],queries=[];
 class Pool extends EventEmitter{
  constructor(config){super();this.config=config;this.clients=[];this.ended=false;instances.push(this);}
  async connect(){
   const pool=this;
   const client={calls:[],async query(config){
    this.calls.push(config);queries.push({pool,client,config});return respond({pool,client,config});
   },release(destroy){this.released=true;this.destroyed=Boolean(destroy);}};
   pool.clients.push(client);return client;
  }
  async end(){this.ended=true;}
 }
 return {Pool,instances,queries};
}
const safeResponse=({config})=>{
 if(config.text===ADMISSION_READINESS_SQL||config.text===ADMISSION_TEMPLATE1_IDENTITY_SQL)return {rows:[{safe:true}]};
 throw new Error('unexpected SQL');
};

test('ready proves template1 before the complete current-database identity and returns only sanitized status',async()=>{
 const {Pool,instances,queries}=harness(safeResponse);
 const database=await createBuyerWriterAdmissionPostgres({connection:connection(),expectedCreatorOid:16384,Pool});
 try{
  queries.length=0;
  assert.deepEqual(await database.ready(),{ok:true});
  assert.deepEqual(queries.map(({config})=>config.text),[ADMISSION_TEMPLATE1_IDENTITY_SQL,ADMISSION_READINESS_SQL]);
  assert.deepEqual(Object.keys(await database.ready()),['ok']);
  const current=instances[0].clients;
  const template=instances[1].clients;
  assert.equal(current.length,2);
  assert.equal(current[0].calls[0].text,ADMISSION_READINESS_SQL);
  assert.equal(current[0].calls[0].values.length,4);
  assert.equal(current[0].calls[0].values[0],BUYER_WRITER_ADMISSION_LOGIN);
  assert.equal(current[0].calls[0].values[1].includes('buyer_writer.execute_admitted_apply(text,uuid,uuid,text,uuid,text,uuid,uuid,text,text,jsonb)'),true);
  assert.equal(typeof current[0].calls[0].values[2],'string');
  assert.equal(current[0].calls[0].values[3],16384);
  assert.equal(template.length,3);
  assert.equal(template[1].calls[0].text,ADMISSION_TEMPLATE1_IDENTITY_SQL);
  assert.deepEqual(template[1].calls[0].values,[BUYER_WRITER_ADMISSION_LOGIN]);
  assert.equal(current[0].destroyed,false);
  assert.equal(template[1].destroyed,false);
 }finally{await database.close();}
 assert.equal(instances.every(pool=>pool.ended),true);
 assert.deepEqual(await database.ready(),{ok:false});
});

test('unsafe current or template proof is sanitized and destroys only the unsafe session',async()=>{
 for(const unsafe of ['current','template']){
  let templateProofs=0;
  const {Pool,instances}=harness(({config})=>{
   if(config.text===ADMISSION_TEMPLATE1_IDENTITY_SQL){
    templateProofs++;
    return {rows:[{safe:templateProofs===1||unsafe!=='template'}]};
   }
   if(config.text===ADMISSION_READINESS_SQL)return {rows:[{safe:unsafe!=='current'}]};
   throw new Error('PRIVATE CATALOG DETAIL');
  });
  const database=await createBuyerWriterAdmissionPostgres({connection:connection(),expectedCreatorOid:16384,Pool});
  try{
   const status=await database.ready();
   assert.deepEqual(status,{ok:false});
   assert.equal(JSON.stringify(status).includes('PRIVATE'),false);
   if(unsafe==='template'){
    assert.equal(instances[0].clients.length,0);
    assert.equal(instances[1].clients[1].destroyed,true);
   }else{
    assert.equal(instances[0].clients[0].destroyed,true);
    assert.equal(instances[1].clients[1].destroyed,false);
   }
  }finally{await database.close();}
 }
});

test('aborted probe fails closed quickly and destroys its checked-out session',async()=>{
 let hold;
 const {Pool,instances}=harness(({config})=>{
  if(config.text===ADMISSION_TEMPLATE1_IDENTITY_SQL)return {rows:[{safe:true}]};
  if(config.text===ADMISSION_READINESS_SQL)return new Promise(resolve=>{hold=resolve;});
  throw new Error('unexpected SQL');
 });
 const database=await createBuyerWriterAdmissionPostgres({connection:connection(),expectedCreatorOid:16384,Pool});
 try{
  const controller=new AbortController();
  const pending=database.ready({signal:controller.signal});
  await new Promise(resolve=>setImmediate(resolve));
  controller.abort();
  assert.deepEqual(await pending,{ok:false});
  assert.equal(instances[0].clients[0].destroyed,true);
  hold({rows:[{safe:true}]});
  assert.deepEqual(await database.ready({signal:controller.signal}),{ok:false});
  assert.deepEqual(await database.ready({signal:{}}),{ok:false});
 }finally{await database.close();}
});

test('probe query deadline is bounded, sanitized and destroys the session',async()=>{
 const {Pool,instances}=harness(({config})=>{
  if(config.text===ADMISSION_TEMPLATE1_IDENTITY_SQL)return {rows:[{safe:true}]};
  if(config.text===ADMISSION_READINESS_SQL)return new Promise(()=>{});
  throw new Error('unexpected SQL');
 });
 const database=await createBuyerWriterAdmissionPostgres({connection:connection(),expectedCreatorOid:16384,Pool});
 try{
  const started=Date.now();
  assert.deepEqual(await database.ready(),{ok:false});
  const elapsed=Date.now()-started;
  assert.ok(elapsed>=1900&&elapsed<3500,`unexpected probe deadline: ${elapsed}ms`);
  assert.equal(instances[0].clients[0].destroyed,true);
 }finally{await database.close();}
});

test('close during a probe destroys the health session and closes both pools',async()=>{
 let hold;
 const {Pool,instances}=harness(({config})=>{
  if(config.text===ADMISSION_TEMPLATE1_IDENTITY_SQL)return {rows:[{safe:true}]};
  if(config.text===ADMISSION_READINESS_SQL)return new Promise(resolve=>{hold=resolve;});
  throw new Error('unexpected SQL');
 });
 const database=await createBuyerWriterAdmissionPostgres({connection:connection(),expectedCreatorOid:16384,Pool});
 const pending=database.ready();
 await new Promise(resolve=>setImmediate(resolve));
 await database.close();
 assert.equal(instances[0].clients[0].destroyed,true);
 hold({rows:[{safe:true}]});
 assert.deepEqual(await pending,{ok:false});
 assert.equal(instances.every(pool=>pool.ended),true);
});
