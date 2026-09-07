import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {createBuyerWriterHttpServer} from '../packages/buyer-writer/http.js';

const credential=randomBytes(32).toString('base64url');
const permit=randomBytes(32).toString('base64url');
const job='00000000-0000-4000-8000-000000000001';
const path=`/api/internal/buyer-writer/v1/jobs/${job}/operations`;
const operation={version:1,dispatchId:'00000000-0000-4000-8000-000000000002',generation:1,
  operation:'start',chunkIndex:0,chunkCount:1,payload:{}};
const headers={'content-type':'application/json','x-buyer-writer-key':credential,'x-buyer-job-permit':permit};
async function fixture(t,{query,isAvailable=()=>true}={}) {
  const server=createBuyerWriterHttpServer({credential,workspace:'isolated',isAvailable,
    query:query??(async()=>({rows:[{result:{ok:true,operation:'start',chunkIndex:0}}]}))});
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});
  });
  return (options={})=>new Promise((resolve,reject)=>{
    const request=http.request({hostname:'127.0.0.1',port:server.address().port,path,method:'POST',headers,...options},response=>{
      let body='';response.on('data',chunk=>{body+=chunk;});
      response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,body}));
    });
    request.on('error',reject);
    const body=options.body??JSON.stringify(operation);
    if(options.pauseBody) {
      request.write(body.slice(0,1));
      void options.pauseBody.then(()=>request.end(body.slice(1)),reject);
    } else request.end(body);
  });
}
test('real HTTP transport returns only a matching committed receipt',async t=>{
  let calls=0;const send=await fixture(t,{query:async()=>{calls++;return{rows:[{result:{ok:true,operation:'start',chunkIndex:0}}]};}});
  const response=await send();assert.equal(response.status,200);assert.equal(calls,1);
  assert.deepEqual(JSON.parse(response.body),{ok:true,operation:'start',chunkIndex:0});
  assert.equal(response.headers['cache-control'],'no-store');
  assert.equal(response.body.includes(permit),false);
});
test('wrong route, method, format, oversized body and duplicate credentials never write',async t=>{
  let calls=0;const send=await fixture(t,{query:async()=>{calls++;}});
  for(const [options,status] of [
    [{path:path+'?owner=forged'},404],[{method:'GET',body:''},405],
    [{headers:{...headers,'content-type':'text/plain'}},415],
    [{headers:{...headers,'x-buyer-job-permit':[permit,permit]}},401],
    [{body:' '.repeat(262145)},413],
  ]) assert.equal((await send(options)).status,status);
  assert.equal(calls,0);
});
test('stop, unavailable authority observation and write failure fail closed over HTTP',async t=>{
  for(const isAvailable of [()=>false,()=>{throw new Error('PRIVATE');}]) {
    const send=await fixture(t,{isAvailable,query:()=>assert.fail('must not write')});
    const result=await send();assert.equal(result.status,503);assert.equal(result.body.includes('PRIVATE'),false);
  }
  const send=await fixture(t,{query:async()=>({rows:[{result:{ok:false,code:'WRITE_FAILED'}}]})});
  assert.equal((await send()).status,503);
});

test('invalid credentials are rejected before availability observation',async t=>{
  const send=await fixture(t,{isAvailable:()=>assert.fail('must not observe authority'),query:()=>assert.fail('must not write')});
  assert.equal((await send({headers:{'content-type':'application/json'}})).status,401);
});

test('stop observed after body collection prevents database invocation',async t=>{
  let observations=0;let available=true;let release;let observed;
  const firstObservation=new Promise(resolve=>{observed=resolve;});
  const pauseBody=new Promise(resolve=>{release=resolve;});
  const send=await fixture(t,{isAvailable:()=>{observations++;observed();return available;},query:()=>assert.fail('must not write')});
  const response=send({pauseBody});
  await firstObservation;available=false;release();
  assert.equal((await response).status,503);assert.equal(observations,2);
});

test('disconnected outstanding queries retain all 32 admission slots until settlement',async t=>{
  const resolvers=[];let block=true;
  const receipt={rows:[{result:{ok:true,operation:'start',chunkIndex:0}}]};
  const send=await fixture(t,{query:async()=>block?new Promise(resolve=>resolvers.push(resolve)):receipt});
  const controllers=Array.from({length:32},()=>new AbortController());
  const pending=controllers.map(controller=>send({signal:controller.signal}).catch(error=>error));
  try {
    const deadline=Date.now()+3000;
    while(resolvers.length<32&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(resolvers.length,32);
    for(const controller of controllers)controller.abort();
    await Promise.all(pending);
    assert.equal((await send()).status,503);
    block=false;for(const resolve of resolvers)resolve(receipt);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal((await send()).status,200);
  } finally {
    for(const controller of controllers)controller.abort();
    for(const resolve of resolvers)resolve(receipt);
    await Promise.all(pending);
  }
});
