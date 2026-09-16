import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import net from 'node:net';
import {createBuyerWriterLocalGateway,BUYER_WRITER_LOCAL_STATEMENTS} from '../packages/buyer-writer/local-gateway-server.js';
import {createBuyerWriterLocalClient} from '../packages/buyer-writer/local-gateway-client.js';
import {resolveBuyerWriterGatewayIdentity} from '../packages/buyer-writer/gateway-entry.js';
import {waitForBuyerWriterGateway} from '../packages/buyer-writer/gateway-readiness.js';
import {BUYER_WRITER_LOCAL_MAX_BYTES,decodeLocalGatewayJson,signLocalGatewayRequest,validateLocalGatewayRequest} from '../packages/buyer-writer/local-gateway-protocol.js';

const releaseSha='a'.repeat(40),workspace='isolated',capability=randomBytes(32).toString('base64url');
const id=()=>randomUUID();
const authority={releaseSha,operationId:id(),attemptId:id(),workspace,gatewayIdentity:'blackspire-writer'};
const sendFrame=(socketPath,request)=>new Promise((resolve,reject)=>{
  const socket=net.createConnection({path:socketPath});let data='';socket.on('error',reject);
  socket.on('connect',()=>socket.end(JSON.stringify(request)+'\n'));socket.on('data',chunk=>{
    data+=chunk;if(data.includes('\n')){socket.destroy();resolve(JSON.parse(data.trim()));}
  });
});
const fixedRequest=()=>{const dispatchId=id();const value={version:1,requestId:id(),operation:'apply',binding:{releaseSha,operationId:authority.operationId,attemptId:authority.attemptId,
  inputDigest:'c'.repeat(64),checkOutputDigest:'d'.repeat(64),workspace,principal:'buyer-writer-runtime',dispatchId,generation:1,
  mutation:{operation:'apply',dispatchId,generation:1}},payload:{permitDigest:'b'.repeat(64),jobId:id(),request:{version:1,dispatchId,generation:1,
  operation:'start',chunkIndex:0,chunkCount:1,payload:{}}},auth:{timestamp:Date.now(),nonce:randomBytes(16).toString('hex'),mac:''}};
  value.auth.mac=signLocalGatewayRequest(value,capability);return value;};

test('local gateway accepts only the fixed apply routine over a filesystem socket',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-writer-gateway-'));fs.chmodSync(root,0o700);
  const socketPath=path.join(root,'buyer-writer.sock'),jobId=id(),dispatchId=id(),calls=[];
  const gateway=createBuyerWriterLocalGateway({socketPath,capability,authority,gatewayIdentityVerified:true,runtimeQuery:async(text,values)=>{
    calls.push([text,values]);return {rows:[{result:{ok:true,operation:'start',chunkIndex:0}}]};
  },issuerQuery:async()=>assert.fail('issuer must not run')});
  await gateway.listen();
  const client=createBuyerWriterLocalClient({socketPath,capability,authority});
  try{
    const result=await client.runtimeQuery(BUYER_WRITER_LOCAL_STATEMENTS.apply,['b'.repeat(64),workspace,JSON.stringify({jobId,version:1,dispatchId,generation:1,operation:'start',chunkIndex:0,chunkCount:1,payload:{}})]);
    assert.deepEqual(result.rows,[{result:{ok:true,operation:'start',chunkIndex:0}}]);
    assert.equal(calls.length,1);assert.equal(calls[0][0],BUYER_WRITER_LOCAL_STATEMENTS.apply);
    assert.equal(fs.lstatSync(socketPath).isSocket(),true);assert.equal(fs.lstatSync(socketPath).mode&0o777,0o660);
    assert.equal(await client.checkAvailability(),true);
    await assert.rejects(client.runtimeQuery('select now()',[]),/unavailable/);
  }finally{await gateway.close();assert.equal(await client.checkAvailability(),false);await client.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('authenticated readiness returns bounded evidence and performs zero queries or mutations',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-writer-gateway-ready-'));fs.chmodSync(root,0o700);
  const socketPath=path.join(root,'buyer-writer.sock');let runtimeQueries=0,issuerQueries=0;
  const gateway=createBuyerWriterLocalGateway({socketPath,capability,authority,gatewayIdentityVerified:true,
    runtimeQuery:async()=>{runtimeQueries++;throw new Error('query forbidden');},
    issuerQuery:async()=>{issuerQueries++;throw new Error('query forbidden');}});
  const client=createBuyerWriterLocalClient({socketPath,capability,authority});
  try{
    await gateway.listen();
    assert.deepEqual(await client.readiness(),{status:'ready',protocolVersion:1,releaseShaMatch:true,workspaceMatch:true,
      authorityBindingLoaded:true,databaseConfigurationPresent:true,gatewayIdentityMatch:true});
    assert.equal(await client.checkAvailability(),true);
    assert.deepEqual({runtimeQueries,issuerQueries,businessMutations:0,providerCalls:0},{runtimeQueries:0,issuerQueries:0,businessMutations:0,providerCalls:0});
  }finally{await gateway.close();await client.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('readiness requires verified runtime identity, private supplementary group, socket metadata and authenticated protocol',async()=>{
  const lookup=(_file,args)=>({
    'passwd:blackspire-writer':'blackspire-writer:x:61001:61003:Blackspire:/nonexistent:/usr/sbin/nologin\n',
    'group:blackspire-writer':'blackspire-writer:x:61003:\n','group:blackspire-api':'blackspire-api:x:61002:\n',
    'group:blackspire':'blackspire:x:61004:\n',
  })[`${args[0]}:${args[1]}`];
  const identity=resolveBuyerWriterGatewayIdentity({userInfo:()=>({username:'blackspire-writer',uid:61001}),getuid:()=>61001,getgid:()=>61002,
    getgroups:()=>[61002,61003],lookup});
  const config={version:2,workspace,socketPath:'/run/blackspire/buyer-writer.sock',gatewayCapability:capability,creatorOid:16384,authority,runtime:{},issuer:{}};
  let authenticated=0,closed=0;
  const result=await waitForBuyerWriterGateway({configurationFile:'/etc/blackspire-buyer-writer-gateway/gateway.json',timeoutMs:1000,
    resolveIdentity:()=>identity,readConfiguration:(_filename,options)=>{assert.equal(options.identity,identity);return config;},
    io:{lstatSync:()=>({isSocket:()=>true,isSymbolicLink:()=>false,uid:61001,gid:61002,mode:0o140660})},
    createClient:options=>{assert.deepEqual(options.authority,authority);return{readiness:async()=>{authenticated++;return{status:'ready',protocolVersion:1,
      releaseShaMatch:true,workspaceMatch:true,authorityBindingLoaded:true,databaseConfigurationPresent:true,gatewayIdentityMatch:true};},close:async()=>{closed++;}};}});
  assert.equal(result.socketVerified,true);assert.equal(authenticated,1);assert.equal(closed,1);
  assert.throws(()=>resolveBuyerWriterGatewayIdentity({userInfo:()=>({username:'blackspire-writer',uid:61001}),getuid:()=>61001,getgid:()=>61002,
    getgroups:()=>[61002,61003,61004],lookup}),/startup rejected/);
  assert.throws(()=>createBuyerWriterLocalGateway({socketPath:'/tmp/missing.sock',capability,authority,gatewayIdentityVerified:false,
    runtimeQuery:async()=>{},issuerQuery:async()=>{}}),/configuration rejected/);
});

test('valid MAC cannot substitute server-owned operation, attempt, release or workspace authority',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-writer-gateway-authority-'));fs.chmodSync(root,0o700);
  const socketPath=path.join(root,'buyer-writer.sock');let queries=0;
  const gateway=createBuyerWriterLocalGateway({socketPath,capability,authority,gatewayIdentityVerified:true,
    runtimeQuery:async()=>{queries++;},issuerQuery:async()=>{queries++;}});
  try{
    await gateway.listen();
    for(const mutate of [
      value=>{value.binding.operationId=id();},value=>{value.binding.attemptId=id();},
      value=>{value.binding.releaseSha='e'.repeat(40);},value=>{value.binding.workspace='wrong-workspace';},
    ]){
      const value=fixedRequest();mutate(value);value.auth.nonce=randomBytes(16).toString('hex');value.auth.mac=signLocalGatewayRequest(value,capability);
      const result=await sendFrame(socketPath,value);assert.equal(result.ok,false);assert.equal(result.code,'BINDING_REJECTED');
    }
    assert.equal(queries,0);
  }finally{await gateway.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('local protocol rejects malformed, oversized, forbidden, substituted and extra fields',()=>{
  assert.throws(()=>decodeLocalGatewayJson(Buffer.from('{"a":1,"a":2}')),/rejected/);
  assert.throws(()=>decodeLocalGatewayJson(Buffer.from('{"key":1,"\\u006bey":2}')),/rejected/);
  assert.throws(()=>decodeLocalGatewayJson(Buffer.alloc(BUYER_WRITER_LOCAL_MAX_BYTES+1,0x20)),/rejected/);
  for(const key of ['sql','query','schema','function','procedure','rpc','url','endpoint','method','host','port','database','username','password'])
    assert.throws(()=>decodeLocalGatewayJson(Buffer.from(JSON.stringify({[key]:'x'}))),/rejected/,key);
  for(const content of ['net.http_post','net.http_patch','ftp://attacker.invalid/file'])
    assert.throws(()=>decodeLocalGatewayJson(Buffer.from(JSON.stringify({dispatch:content}))),/rejected/,content);
  const options={capability,authority,now:()=>fixed.auth.timestamp,consumeNonce:()=>true};
  let fixed=fixedRequest();assert.equal(validateLocalGatewayRequest(fixed,{...options,now:()=>fixed.auth.timestamp}),fixed);
  for(const mutate of [
    value=>{value.extra=true;},value=>{value.operation='unknown';},value=>{value.binding.releaseSha='e'.repeat(40);},
    value=>{value.binding.workspace='wrong';},value=>{value.binding.operationId=id();},value=>{value.binding.attemptId=id();},
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
  assert.throws(()=>validateLocalGatewayRequest(value,{capability,authority,now:()=>value.auth.timestamp,consumeNonce:()=>true}),/rejected/);
});

test('local gateway rejects wrong capability, forbidden keys, unknown operations, and replays',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-writer-gateway-'));fs.chmodSync(root,0o700);
  const socketPath=path.join(root,'buyer-writer.sock'),jobId=id(),dispatchId=id();let calls=0;
  const gateway=createBuyerWriterLocalGateway({socketPath,capability,authority,gatewayIdentityVerified:true,runtimeQuery:async()=>{calls++;return {rows:[{result:{ok:true,operation:'start',chunkIndex:0}}]};},issuerQuery:async()=>{calls++;}});
  await gateway.listen();
  const payload={permitDigest:'b'.repeat(64),jobId,request:{version:1,dispatchId,generation:1,operation:'start',chunkIndex:0,chunkCount:1,payload:{}}};
  try{
    const wrong=createBuyerWriterLocalClient({socketPath,capability:randomBytes(32).toString('base64url'),authority});
    await assert.rejects(wrong.request('apply',payload,{dispatchId,generation:1}),/unavailable/);
    const client=createBuyerWriterLocalClient({socketPath,capability,authority});
    await assert.rejects(client.request('unknown',payload,{dispatchId,generation:1}),/unavailable/);
    await assert.rejects(client.request('apply',{...payload,sql:'select 1'},{dispatchId,generation:1}),/unavailable/);
    assert.equal(calls,0);await client.close();await wrong.close();
    const request={version:1,requestId:id(),operation:'apply',binding:{releaseSha,operationId:authority.operationId,attemptId:authority.attemptId,inputDigest:'c'.repeat(64),
      checkOutputDigest:'d'.repeat(64),workspace,principal:'buyer-writer-runtime',dispatchId,generation:1,mutation:{operation:'apply',dispatchId,generation:1}},
      payload,auth:{timestamp:Date.now(),nonce:randomBytes(16).toString('hex'),mac:''}};
    request.auth.mac=signLocalGatewayRequest(request,capability);
    assert.equal((await sendFrame(socketPath,request)).ok,true);assert.equal((await sendFrame(socketPath,request)).code,'AUTH_REJECTED');assert.equal(calls,1);
  }finally{await gateway.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('gateway restart preserves database mutation idempotence for the same bound dispatch',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-writer-gateway-'));fs.chmodSync(root,0o700);
  const socketPath=path.join(root,'buyer-writer.sock'),jobId=id(),dispatchId=id(),seen=new Set();let mutations=0,gateway;
  const runtimeQuery=async(text,values)=>{
    assert.equal(text,BUYER_WRITER_LOCAL_STATEMENTS.apply);
    const request=JSON.parse(values[2]),key=`${request.dispatchId}:${request.operation}:${request.chunkIndex}`;
    if(!seen.has(key)){seen.add(key);mutations++;}
    return {rows:[{result:{ok:true,operation:request.operation,chunkIndex:request.chunkIndex}}]};
  };
  const start=async()=>{gateway=createBuyerWriterLocalGateway({socketPath,capability,authority,gatewayIdentityVerified:true,runtimeQuery,
    issuerQuery:async()=>assert.fail('issuer must not run')});await gateway.listen();};
  const payload={permitDigest:'b'.repeat(64),jobId,request:{version:1,dispatchId,generation:1,operation:'start',chunkIndex:0,chunkCount:1,payload:{}}};
  const request={version:1,requestId:id(),operation:'apply',binding:{releaseSha,operationId:authority.operationId,attemptId:authority.attemptId,inputDigest:'c'.repeat(64),
    checkOutputDigest:'d'.repeat(64),workspace,principal:'buyer-writer-runtime',dispatchId,generation:1,mutation:{operation:'apply',dispatchId,generation:1}},
    payload,auth:{timestamp:Date.now(),nonce:randomBytes(16).toString('hex'),mac:''}};
  request.auth.mac=signLocalGatewayRequest(request,capability);
  try{
    await start();assert.equal((await sendFrame(socketPath,request)).ok,true);await gateway.close();
    await start();assert.equal((await sendFrame(socketPath,request)).ok,true);
    assert.equal(mutations,1);assert.equal(seen.size,1);
  }finally{await gateway?.close();fs.rmSync(root,{recursive:true,force:true});}
});
