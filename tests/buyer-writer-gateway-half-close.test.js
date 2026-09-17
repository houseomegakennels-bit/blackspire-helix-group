// Local filesystem-socket regressions. Synthetic configuration, no database.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import {once} from 'node:events';
import {randomUUID,randomBytes} from 'node:crypto';
import {createBuyerWriterLocalGateway} from '../packages/buyer-writer/local-gateway-server.js';
const bounded=async promise=>{
 let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Fixture did not close promptly')),1000);})]);}
 finally{clearTimeout(timer);}
};
const fixture=async(maxConnections=32)=>{
 const root=fs.mkdtempSync('/tmp/zola-empty-peer-');fs.chmodSync(root,0o700);
 const socketPath=root+'/writer.sock',authority={releaseSha:'a'.repeat(40),operationId:randomUUID(),attemptId:randomUUID(),workspace:'fixture',gatewayIdentity:'blackspire-writer'};
 let calls=0;
 const gateway=createBuyerWriterLocalGateway({socketPath,capability:randomBytes(32).toString('base64url'),authority,gatewayIdentityVerified:true,maxConnections,timeoutMs:30000,
  runtimeQuery:async()=>{calls++;throw new Error('No accepted request');},issuerQuery:async()=>{calls++;throw new Error('No accepted request');}});
 await gateway.listen();return{gateway,root,socketPath,calls:()=>calls};
};
test('EOF without a frame promptly frees every occupied admission slot',async()=>{
 const f=await fixture(4),sockets=[];
 try{
  for(let i=0;i<4;i++){const s=net.createConnection(f.socketPath);s.on('error',()=>{});sockets.push(s);await once(s,'connect');}
  const closed=sockets.map(s=>once(s,'close'));for(const s of sockets){s.resume();s.end();}
  await bounded(Promise.all(closed));assert.equal(f.gateway.isDrained(),true);assert.equal(f.calls(),0);
 }finally{for(const s of sockets)s.destroy();await f.gateway.close();fs.rmSync(f.root,{recursive:true,force:true});}
});
test('an EOF after a partial frame does not hold shutdown until idle timeout',async()=>{
 const f=await fixture(),s=net.createConnection(f.socketPath);s.on('error',()=>{});let closing;
 try{
  await once(s,'connect');const closed=once(s,'close');s.resume();s.end('{');
  await bounded(closed);closing=f.gateway.close();await bounded(closing);assert.equal(f.calls(),0);assert.equal(f.gateway.isDrained(),true);
 }finally{s.destroy();if(closing)await closing;else await f.gateway.close();fs.rmSync(f.root,{recursive:true,force:true});}
});
test('shutdown closes an idle peer without discarding an accepted operation',async()=>{
 const f=await fixture(),s=net.createConnection(f.socketPath);s.on('error',()=>{});let closing;
 try{
  await once(s,'connect');s.resume();closing=f.gateway.close();await bounded(closing);
  assert.equal(f.calls(),0);assert.equal(f.gateway.isDrained(),true);assert.equal(f.gateway.isReady(),false);
 }finally{s.destroy();if(closing)await closing;else await f.gateway.close();fs.rmSync(f.root,{recursive:true,force:true});}
});
