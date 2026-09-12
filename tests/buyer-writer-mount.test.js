import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {createBuyerWriterRequestHandler} from '../packages/buyer-writer/http.js';

const credential=randomBytes(32).toString('base64url'),permit=randomBytes(32).toString('base64url');
const job='00000000-0000-4000-8000-000000000001';
const route=`/api/internal/buyer-writer/v1/jobs/${job}/operations`;
const operation={version:1,dispatchId:'00000000-0000-4000-8000-000000000002',generation:1,operation:'start',chunkIndex:0,chunkCount:1,payload:{}};
const receipt={rows:[{result:{ok:true,operation:'start',chunkIndex:0}}]};
async function fixture(t,{query=async()=>receipt,isAvailable=()=>true}={}){
  const writer=createBuyerWriterRequestHandler({credential,workspace:'isolated',query,isAvailable});
  const server=http.createServer((req,res)=>{
    if(req.url.startsWith('/api/internal/buyer-writer/v1/'))return writer.handleRequest(req,res);
    res.end('ordinary route');
  });
  t.after(()=>new Promise(resolve=>{writer.stopAdmission();server.closeAllConnections();server.close(resolve);}));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const send=(options={})=>fetch(`http://127.0.0.1:${server.address().port}${options.path??route}`,{
    method:'POST',headers:{'content-type':'application/json','x-buyer-writer-key':credential,'x-buyer-job-permit':permit,...options.headers},
    body:JSON.stringify(operation),signal:options.signal??AbortSignal.timeout(3000),
  });
  return {writer,send,server};
}
test('mounted writer preserves authentication and leaves unrelated routes available',async t=>{
  let calls=0,observations=0;
  const {send}=await fixture(t,{query:async()=>{calls++;return receipt;},isAvailable:()=>{observations++;return true;}});
  assert.equal((await send({headers:{'x-buyer-writer-key':'invalid'}})).status,401);
  assert.equal(calls,0);assert.equal(observations,0);
  assert.equal((await send()).status,200);assert.equal(calls,1);
  const ordinary=await send({path:'/ordinary'});assert.equal(await ordinary.text(),'ordinary route');
});
test('admission shutdown prevents new work while an admitted query settles',async t=>{
  let resolveQuery,enteredResolve;
  const entered=new Promise(resolve=>{enteredResolve=resolve;});
  const {writer,send}=await fixture(t,{query:()=>{enteredResolve();return new Promise(resolve=>{resolveQuery=resolve;});}});
  const pending=send();await entered;
  assert.equal(writer.isDrained(),false);writer.stopAdmission();
  assert.equal((await send()).status,503);
  resolveQuery(receipt);assert.equal((await pending).status,200);
  assert.equal(writer.isDrained(),true);writer.stopAdmission();
  assert.equal((await send({path:'/ordinary'})).status,200);
});
test('disconnected mounted queries retain admission slots until database settlement',async t=>{
  const resolvers=[];let block=true;
  const {writer,send}=await fixture(t,{query:()=>block?new Promise(resolve=>resolvers.push(resolve)):Promise.resolve(receipt)});
  const controllers=Array.from({length:32},()=>new AbortController());
  const pending=controllers.map(controller=>send({signal:controller.signal}).catch(()=>null));
  try {
    const deadline=Date.now()+2500;
    while(resolvers.length<32&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(resolvers.length,32);
    for(const controller of controllers)controller.abort();await Promise.all(pending);
    assert.equal(writer.isDrained(),false);assert.equal((await send()).status,503);
    block=false;for(const resolve of resolvers)resolve(receipt);
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(writer.isDrained(),true);assert.equal((await send()).status,200);
  }finally{block=false;for(const resolve of resolvers)resolve(receipt);}
});

test('shutdown during the final authority observation prevents dispatch',async t=>{
  let release,observedResolve,count=0;
  const observed=new Promise(resolve=>{observedResolve=resolve;});
  const {writer,send}=await fixture(t,{query:()=>assert.fail('must not dispatch after shutdown'),isAvailable:()=>{
    if(++count===1)return true;
    observedResolve();return new Promise(resolve=>{release=resolve;});
  }});
  const pending=send();await observed;writer.stopAdmission();release(true);
  assert.equal((await pending).status,503);assert.equal(writer.isDrained(),true);
});
