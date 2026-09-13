import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import net from 'node:net';
import {createBuyerWriterLocalGateway,BUYER_WRITER_LOCAL_STATEMENTS} from '../packages/buyer-writer/local-gateway-server.js';
import {createBuyerWriterLocalClient} from '../packages/buyer-writer/local-gateway-client.js';
import {BUYER_WRITER_LOCAL_MAX_BYTES,decodeLocalGatewayJson,signLocalGatewayRequest,validateLocalGatewayRequest} from '../packages/buyer-writer/local-gateway-protocol.js';

const releaseSha='a'.repeat(40),workspace='isolated',capability=randomBytes(32).toString('base64url');
const id=()=>randomUUID();
const fixedRequest=()=>{const dispatchId=id();const value={version:1,requestId:id(),operation:'apply',binding:{releaseSha,operationId:id(),attemptId:id(),
  inputDigest:'c'.repeat(64),checkOutputDigest:'d'.repeat(64),workspace,principal:'buyer-writer-runtime',dispatchId,generation:1,
  mutation:{operation:'apply',dispatchId,generation:1}},payload:{permitDigest:'b'.repeat(64),jobId:id(),request:{version:1,dispatchId,generation:1,
  operation:'start',chunkIndex:0,chunkCount:1,payload:{}}},auth:{timestamp:Date.now(),nonce:randomBytes(16).toString('hex'),mac:''}};
  value.auth.mac=signLocalGatewayRequest(value,capability);return value;};

test('local gateway accepts only the fixed apply routine over a filesystem socket',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-writer-gateway-'));fs.chmodSync(root,0o700);
  const socketPath=path.join(root,'buyer-writer.sock'),jobId=id(),dispatchId=id(),calls=[];
  const gateway=createBuyerWriterLocalGateway({socketPath,capability,workspace,releaseSha,runtimeQuery:async(text,values)=>{
    calls.push([text,values]);return {rows:[{result:{ok:true,operation:'start',chunkIndex:0}}]};
  },issuerQuery:async()=>assert.fail('issuer must not run')});
  await gateway.listen();
  const client=createBuyerWriterLocalClient({socketPath,capability,workspace,releaseSha});
  try{
    const result=await client.runtimeQuery(BUYER_WRITER_LOCAL_STATEMENTS.apply,['b'.repeat(64),workspace,JSON.stringify({jobId,version:1,dispatchId,generation:1,operation:'start',chunkIndex:0,chunkCount:1,payload:{}})]);
    assert.deepEqual(result.rows,[{result:{ok:true,operation:'start',chunkIndex:0}}]);
    assert.equal(calls.length,1);assert.equal(calls[0][0],BUYER_WRITER_LOCAL_STATEMENTS.apply);
    assert.equal(fs.lstatSync(socketPath).isSocket(),true);assert.equal(fs.lstatSync(socketPath).mode&0o777,0o660);
    await assert.rejects(client.runtimeQuery('select now()',[]),/unavailable/);
  }finally{await client.close();await gateway.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('local protocol rejects malformed, oversized, forbidden, substituted and extra fields',()=>{
  assert.throws(()=>decodeLocalGatewayJson(Buffer.from('{"a":1,"a":2}')),/rejected/);
  assert.throws(()=>decodeLocalGatewayJson(Buffer.alloc(BUYER_WRITER_LOCAL_MAX_BYTES+1,0x20)),/rejected/);
  for(const key of ['sql','query','schema','function','procedure','rpc','url','endpoint','method','host','port','database','username','password'])
    assert.throws(()=>decodeLocalGatewayJson(Buffer.from(JSON.stringify({[key]:'x'}))),/rejected/,key);
  assert.throws(()=>decodeLocalGatewayJson(Buffer.from(JSON.stringify({dispatch:'net.http_post'}))),/rejected/);
  const options={capability,workspace,releaseSha,now:()=>fixed.auth.timestamp,consumeNonce:()=>true};
  let fixed=fixedRequest();assert.equal(validateLocalGatewayRequest(fixed,{...options,now:()=>fixed.auth.timestamp}),fixed);
  for(const mutate of [
    value=>{value.extra=true;},value=>{value.operation='unknown';},value=>{value.binding.releaseSha='e'.repeat(40);},
    value=>{value.binding.workspace='wrong';},value=>{value.binding.operationId='wrong';},value=>{value.binding.attemptId='wrong';},
  ]){
    fixed=fixedRequest();mutate(fixed);fixed.auth.mac=signLocalGatewayRequest(fixed,capability);
    assert.throws(()=>validateLocalGatewayRequest(fixed,{...options,now:()=>fixed.auth.timestamp}),/rejected/);
  }
  fixed=fixedRequest();assert.throws(()=>validateLocalGatewayRequest(fixed,{...options,capability:randomBytes(32).toString('base64url'),now:()=>fixed.auth.timestamp}),/rejected/);
});

test('issue criteria rejects unknown nested fields before database dispatch',()=>{
  const value=fixedRequest(),owner=id(),requestId=id();value.operation='issue';value.binding.principal=owner;value.binding.dispatchId=requestId;value.binding.generation=null;
  value.binding.mutation={operation:'issue',dispatchId:requestId,generation:null};value.payload={jobId:id(),ownerId:owner,requestId,permitDigest:'b'.repeat(64),
    updatedAt:'2026-01-01T00:00:00.000Z',criteria:{state:'NC',county:'Forsyth',property_type:'ALL',date_range_start:'2025-01-01',date_range_end:'2026-01-01',
      min_purchases:1,cash_buyers_only:true,llc_buyers_only:false,extra:true},sourceContext:{}};value.auth.mac=signLocalGatewayRequest(value,capability);
  assert.throws(()=>validateLocalGatewayRequest(value,{capability,workspace,releaseSha,now:()=>value.auth.timestamp,consumeNonce:()=>true}),/rejected/);
});

test('local gateway rejects wrong capability, forbidden keys, unknown operations, and replays',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-writer-gateway-'));fs.chmodSync(root,0o700);
  const socketPath=path.join(root,'buyer-writer.sock'),jobId=id(),dispatchId=id();let calls=0;
  const gateway=createBuyerWriterLocalGateway({socketPath,capability,workspace,releaseSha,runtimeQuery:async()=>{calls++;return {rows:[{result:{ok:true,operation:'start',chunkIndex:0}}]};},issuerQuery:async()=>{calls++;}});
  await gateway.listen();
  const payload={permitDigest:'b'.repeat(64),jobId,request:{version:1,dispatchId,generation:1,operation:'start',chunkIndex:0,chunkCount:1,payload:{}}};
  try{
    const wrong=createBuyerWriterLocalClient({socketPath,capability:randomBytes(32).toString('base64url'),workspace,releaseSha});
    await assert.rejects(wrong.request('apply',payload,{dispatchId,generation:1}),/unavailable/);
    const client=createBuyerWriterLocalClient({socketPath,capability,workspace,releaseSha});
    await assert.rejects(client.request('unknown',payload,{dispatchId,generation:1}),/unavailable/);
    await assert.rejects(client.request('apply',{...payload,sql:'select 1'},{dispatchId,generation:1}),/unavailable/);
    assert.equal(calls,0);await client.close();await wrong.close();
    const request={version:1,requestId:id(),operation:'apply',binding:{releaseSha,operationId:id(),attemptId:id(),inputDigest:'c'.repeat(64),
      checkOutputDigest:'d'.repeat(64),workspace,principal:'buyer-writer-runtime',dispatchId,generation:1,mutation:{operation:'apply',dispatchId,generation:1}},
      payload,auth:{timestamp:Date.now(),nonce:randomBytes(16).toString('hex'),mac:''}};
    request.auth.mac=signLocalGatewayRequest(request,capability);
    const send=()=>new Promise((resolve,reject)=>{const socket=net.createConnection({path:socketPath});let data='';socket.on('error',reject);
      socket.on('connect',()=>socket.end(JSON.stringify(request)+'\n'));socket.on('data',chunk=>{data+=chunk;if(data.includes('\n')){socket.destroy();resolve(JSON.parse(data.trim()));}});});
    assert.equal((await send()).ok,true);assert.equal((await send()).code,'AUTH_REJECTED');assert.equal(calls,1);
  }finally{await gateway.close();fs.rmSync(root,{recursive:true,force:true});}
});
