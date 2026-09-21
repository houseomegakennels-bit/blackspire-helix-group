import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createBuyerDealContextClient} from '../packages/buyer-store/deal-context-client.js';
import {signBuyerDealContextResponse} from '../packages/buyer-store/deal-context-contract.js';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-store-api-'));
process.env.BLACKSPIRE_RUNTIME_MODE='test';process.env.BLACKSPIRE_DATA_DIR=temp;process.env.BLACKSPIRE_DB_PATH=path.join(temp,'command.sqlite');
const {handleBuyerStoreRequest}=await import('../apps/api/server.js');
const sha='a'.repeat(40),key=Buffer.alloc(32,7).toString('base64url'),clock=1700000000000;
const configuration={version:1,releaseSha:sha,origin:'https://blackspirehelix.com',key};
const authority={releaseSha:sha,capabilityId:'buyer.matches.search',expiresAt:clock+15000,taskId:'task-1'};
const bindingDigest='b'.repeat(64),deal={city:'Winston-Salem',county:'Forsyth',property_address:'synthetic',property_type:'house'};
const observation={requests:1,responseBytes:100,latencyMs:2};
test('deal lookup accepts only fixed origin and exact authenticated response',async()=>{
 let calls=0;
 const lookup=createBuyerDealContextClient({configuration,now:()=>clock,fetchImpl:async(url,options)=>{
  calls++;assert.equal(String(url),'https://blackspirehelix.com/api/internal/buyer-store/deal-context');assert.equal(options.redirect,'error');
  const request=JSON.parse(options.body);assert.equal(request.bindingDigest,bindingDigest);assert.equal(request.dealId,'DE-0001');
  return Response.json(signBuyerDealContextResponse(request,deal,observation,key,clock));
 }});
 assert.deepEqual(await lookup('DE-0001',{authority,bindingDigest}),{deal,observation});assert.equal(calls,1);
 for(const origin of ['https://example.com','http://blackspirehelix.com','https://blackspirehelix.com/path'])assert.throws(()=>createBuyerDealContextClient({configuration:{...configuration,origin}}));
 await assert.rejects(lookup('DE-0001',{authority:{...authority,releaseSha:'c'.repeat(40)},bindingDigest}));assert.equal(calls,1);
});
test('deal lookup refuses tampered, oversized and expired responses without retry',async()=>{
 for(const mode of ['tamper','oversize','expired']){
  let now=clock,calls=0;
  const lookup=createBuyerDealContextClient({configuration,now:()=>now,fetchImpl:async(_url,options)=>{
   calls++;const request=JSON.parse(options.body),response=signBuyerDealContextResponse(request,deal,observation,key,clock);
   if(mode==='tamper')response.deal={...deal,county:'changed'};
   if(mode==='expired')now=request.expiresAt;
   return mode==='oversize'?new Response('x'.repeat(65537)):Response.json(response);
  }});
  await assert.rejects(lookup('DE-0001',{authority,bindingDigest}),/unavailable/);assert.equal(calls,1);
 }
});
async function userRequest({url='/api/internal/buyer-store/v1/jobs-list',method='POST',body='{}',authorization='Bearer synthetic-user-token',store}={}){
 const req=Readable.from([Buffer.from(body)]);req.url=url;req.method=method;req.headers={'content-type':'application/json',authorization};
 const res={writeHead(status){this.status=status;},end(body){this.body=JSON.parse(body);}};
 await handleBuyerStoreRequest(req,res,{store});return res;
}
test('user HTTP boundary delegates bearer verification and rejects alternate paths before IPC',async()=>{
 const calls=[],store={userRequest:async value=>{calls.push(value);return{ok:true,data:[]};}};
 assert.equal((await userRequest({store})).status,200);
 assert.deepEqual(calls,[{operation:'jobs-list',accessToken:'synthetic-user-token',input:{}}]);
 for(const change of [{url:'/api/internal/buyer-store/v1/jobs-list?owner=other'},{method:'GET'},{authorization:''},{body:'[]'},{body:'x'.repeat(32769)}])assert.equal((await userRequest({...change,store})).status,404);
 assert.equal(calls.length,1);
 assert.equal((await userRequest({store:{userRequest:async()=>{throw new Error('credential error');}}})).status,404);
});
