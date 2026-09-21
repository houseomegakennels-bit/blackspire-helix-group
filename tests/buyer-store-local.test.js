import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {mac,validateRequest,BUYER_STORE_SOCKET} from '../packages/buyer-store/local-protocol.js';
import {createBuyerStoreLocalServer} from '../packages/buyer-store/local-server.js';
import {createBuyerStoreLocalClient} from '../packages/buyer-store/local-client.js';
const configuration={version:1,releaseSha:'a'.repeat(40),profileDigest:'b'.repeat(64),key:'c'.repeat(43)};
test('IPC exact authenticated binding and replay denial',()=>{
 const unsigned={version:1,releaseSha:configuration.releaseSha,profileDigest:configuration.profileDigest,id:'d'.repeat(32),timestamp:1000,lane:'profiles-read',body:{input:{}}};
 const value={...unsigned,mac:mac(unsigned,configuration.key)},seen=new Map();
 assert.equal(validateRequest(value,configuration,{now:()=>1000,seen}),value);
 assert.throws(()=>validateRequest(value,configuration,{now:()=>1000,seen}));
 for(const patch of [{releaseSha:'e'.repeat(40)},{profileDigest:'e'.repeat(64)},{lane:'sql'},{timestamp:-20000},{body:{input:{},owner:'arbitrary'}}]){
  const unsigned2={...unsigned,...patch},v={...unsigned2,mac:mac(unsigned2,configuration.key)};
  assert.throws(()=>validateRequest(v,configuration,{now:()=>1000,seen:new Map()}));
 }
});
test('actual Unix socket only dispatches validated user and readonly capability operations',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'bs-')),socket=path.join(dir,'s');
 const calls=[];
 const server=createBuyerStoreLocalServer({configuration,validateInput:(operation,input)=>{if(operation!=='profiles-list'&&operation!=='counts'||Object.keys(input).length)throw new Error();return input;},
  userHandler:async body=>{calls.push(body);return {ok:true,data:3};},readCapabilityProfiles:async input=>{calls.push(input);return {rows:[],count:0};}});
 await new Promise(resolve=>server.listen(socket,resolve));
 const connect=options=>{assert.equal(options.path,BUYER_STORE_SOCKET);return net.createConnection({path:socket});};
 const client=createBuyerStoreLocalClient({configuration,connect});
 try{
  assert.deepEqual(await client.userRequest({operation:'counts',accessToken:'synthetic-token',input:{}}),{ok:true,data:3});
  assert.deepEqual(await client.readCapabilityProfiles({}),{rows:[],count:0});
  await assert.rejects(client.userRequest({operation:'sql',accessToken:'synthetic-token',input:{sql:'select'}}));
  await assert.rejects(client.readCapabilityProfiles({owner:'foreign'}));
  const wrong=createBuyerStoreLocalClient({configuration:{...configuration,key:'x'.repeat(43)},connect});
  await assert.rejects(wrong.readCapabilityProfiles({}));
  assert.equal(calls.length,2);
 }finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true});}
});
