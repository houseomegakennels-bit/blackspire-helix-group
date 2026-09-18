import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {createBuyerWriterLocalGateway} from '../packages/buyer-writer/local-gateway-server.js';

const authority=Object.freeze({releaseSha:'a'.repeat(40),operationId:randomUUID(),attemptId:randomUUID(),
  workspace:'isolated',gatewayIdentity:'blackspire-writer'});
const capability=randomBytes(32).toString('base64url');
const fixture=()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-writer-service-'));fs.chmodSync(root,0o700);
  const socketPath=path.join(root,'gateway.sock');
  const gateway=()=>createBuyerWriterLocalGateway({socketPath,capability,authority,gatewayIdentityVerified:true,
    runtimeQuery:async()=>assert.fail('runtime query forbidden'),issuerQuery:async()=>assert.fail('issuer query forbidden')});
  return {root,socketPath,gateway,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
};
const listen=server=>new Promise((resolve,reject)=>{
  server.once('error',reject);server.listen(server.__path,()=>{server.removeListener('error',reject);resolve();});
});
const connect=socketPath=>new Promise((resolve,reject)=>{
  const socket=net.createConnection({path:socketPath});socket.once('error',reject);
  socket.once('connect',()=>{socket.destroy();resolve();});
});
const close=server=>new Promise(resolve=>server.close(resolve));
test('startup preserves an active same-owner listener and refuses split brain',async()=>{
  const f=fixture(),active=net.createServer(socket=>socket.end());active.__path=f.socketPath;
  try{
    await listen(active);const before=fs.lstatSync(f.socketPath),candidate=f.gateway();
    await assert.rejects(candidate.listen(),/stale socket rejected/);
    const after=fs.lstatSync(f.socketPath);assert.equal(after.ino,before.ino);assert.equal(after.dev,before.dev);
    await connect(f.socketPath);assert.equal(active.listening,true);await candidate.close();
  }finally{await close(active);f.cleanup();}
});

test('startup reclaims a proven stale socket and shutdown supports a clean restart',async()=>{
  const f=fixture();
  const child=spawn(process.execPath,['-e',
    "const net=require('node:net');const s=net.createServer();s.listen(process.argv[1],()=>process.send('ready'));setInterval(()=>{},1000)",
    f.socketPath],{stdio:['ignore','ignore','ignore','ipc']});
  try{
    await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);});
    child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));
    assert.equal(fs.lstatSync(f.socketPath).isSocket(),true);
    const first=f.gateway();await first.listen();assert.equal(first.isReady(),true);
    assert.equal(fs.lstatSync(f.socketPath).mode&0o777,0o660);
    await assert.rejects(first.listen(),/listen rejected/);
    await first.close();assert.equal(fs.existsSync(f.socketPath),false);
    const second=f.gateway();await second.listen();assert.equal(second.isReady(),true);await second.close();
  }finally{if(child.exitCode===null)child.kill('SIGKILL');f.cleanup();}
});
test('shutdown never removes a pathname that no longer names its socket',async()=>{
  const f=fixture(),gateway=f.gateway();
  try{
    await gateway.listen();fs.unlinkSync(f.socketPath);fs.writeFileSync(f.socketPath,'replacement',{mode:0o600});
    assert.equal(gateway.isReady(),false);await gateway.close();
    assert.equal(fs.readFileSync(f.socketPath,'utf8'),'replacement');
    assert.equal(fs.lstatSync(f.socketPath).isFile(),true);
    assert.deepEqual(fs.readdirSync(f.root),['gateway.sock']);
  }finally{await gateway.close().catch(()=>{});f.cleanup();}
});

test('a concurrent stop waits for startup and leaves no listener or socket',async()=>{
  const f=fixture(),gateway=f.gateway();
  try{
    const starting=gateway.listen(),stopping=gateway.close();await Promise.all([starting,stopping]);
    assert.equal(gateway.isReady(),false);assert.equal(gateway.isDrained(),true);
    assert.equal(fs.existsSync(f.socketPath),false);
    await assert.rejects(gateway.listen(),/listen rejected/);
  }finally{await gateway.close();f.cleanup();}
});
test('rejected frames cannot amplify untrusted identifiers into service journals',async()=>{
  const f=fixture(),records=[],gateway=createBuyerWriterLocalGateway({socketPath:f.socketPath,capability,authority,
    gatewayIdentityVerified:true,runtimeQuery:async()=>assert.fail('runtime query forbidden'),
    issuerQuery:async()=>assert.fail('issuer query forbidden'),log:record=>records.push(record)});
  try{
    await gateway.listen();
    const response=await new Promise((resolve,reject)=>{
      const socket=net.createConnection({path:f.socketPath});let bytes='';
      socket.once('error',reject);socket.once('connect',()=>socket.end(JSON.stringify({
        version:1,requestId:'r'.repeat(5000),operation:'x'.repeat(5000)})+'\n'));
      socket.on('data',chunk=>{bytes+=chunk;if(bytes.includes('\n')){socket.destroy();resolve(JSON.parse(bytes));}});
    });
    assert.equal(response.ok,false);assert.equal(records.length,1);
    assert.deepEqual(records[0],{requestId:null,operation:'invalid',outcome:'rejected',durationMs:records[0].durationMs});
    assert.equal(Number.isSafeInteger(records[0].durationMs),true);
    assert.ok(JSON.stringify(records[0]).length<128);
  }finally{await gateway.close();f.cleanup();}
});

test('post-publication replacement fails readiness and preserves an unrelated sentinel',async()=>{
  const f=fixture(),sentinel='do-not-delete';
  const io={...fs,linkSync(source,target){
    fs.linkSync(source,target);fs.unlinkSync(target);fs.writeFileSync(target,sentinel,{mode:0o600});
  }};
  const gateway=createBuyerWriterLocalGateway({socketPath:f.socketPath,capability,authority,gatewayIdentityVerified:true,io,
    runtimeQuery:async()=>assert.fail('runtime query forbidden'),issuerQuery:async()=>assert.fail('issuer query forbidden')});
  try{
    await assert.rejects(gateway.listen(),/listen rejected/);assert.equal(gateway.isReady(),false);
    assert.equal(fs.readFileSync(f.socketPath,'utf8'),sentinel);await gateway.close();
    assert.equal(fs.readFileSync(f.socketPath,'utf8'),sentinel);
    assert.deepEqual(fs.readdirSync(f.root),['gateway.sock']);
  }finally{await gateway.close().catch(()=>{});f.cleanup();}
});

test('a replacement winner remains continuously connectable through candidate failure and close',async()=>{
  const f=fixture(),marker=path.join(f.root,'winner-ready'),waitArray=new Int32Array(new SharedArrayBuffer(4));let winner;
  const io={...fs,linkSync(source,target){
    fs.linkSync(source,target);fs.unlinkSync(target);
    const sourceCode="const fs=require('fs'),net=require('net');const s=net.createServer(c=>c.end('winner'));s.listen(process.argv[1],()=>fs.writeFileSync(process.argv[2],'ready'));process.on('SIGTERM',()=>s.close(()=>process.exit(0)));setInterval(()=>{},1000)";
    winner=spawn(process.execPath,['-e',sourceCode,target,marker],{stdio:'ignore'});
    for(let index=0;index<200&&!fs.existsSync(marker);index++)Atomics.wait(waitArray,0,0,5);
    if(!fs.existsSync(marker))throw new Error('winner did not bind');
  }};
  const gateway=createBuyerWriterLocalGateway({socketPath:f.socketPath,capability,authority,gatewayIdentityVerified:true,io,
    runtimeQuery:async()=>assert.fail('runtime query forbidden'),issuerQuery:async()=>assert.fail('issuer query forbidden')});
  const readWinner=()=>new Promise((resolve,reject)=>{
    const socket=net.createConnection({path:f.socketPath});let value='';socket.once('error',reject);
    socket.on('data',chunk=>value+=chunk);socket.once('close',()=>resolve(value));
  });
  try{
    await assert.rejects(gateway.listen(),/listen rejected/);assert.equal(await readWinner(),'winner');
    await gateway.close();assert.equal(await readWinner(),'winner');
  }finally{
    if(winner?.exitCode===null){winner.kill('SIGTERM');await new Promise(resolve=>winner.once('exit',resolve));}
    f.cleanup();
  }
});

test('sentinel collisions cannot influence shutdown cleanup',async()=>{
  const f=fixture(),gateway=f.gateway(),sentinel=path.join(f.root,'.buyer-writer-preserved-'+process.pid);
  try{
    fs.writeFileSync(sentinel,'sentinel',{mode:0o600});await gateway.listen();await gateway.close();
    assert.equal(fs.readFileSync(sentinel,'utf8'),'sentinel');assert.equal(fs.existsSync(f.socketPath),false);
    assert.deepEqual(fs.readdirSync(f.root),[path.basename(sentinel)]);
  }finally{await gateway.close();f.cleanup();}
});

test('concurrent starters publish exactly one connectable winner and loser cleanup is isolated',async()=>{
  const f=fixture(),first=f.gateway(),second=f.gateway();
  try{
    const outcomes=await Promise.allSettled([first.listen(),second.listen()]);
    assert.equal(outcomes.filter(value=>value.status==='fulfilled').length,1);
    assert.equal(outcomes.filter(value=>value.status==='rejected').length,1);
    await connect(f.socketPath);
    const loser=outcomes[0].status==='rejected'?first:second,winner=loser===first?second:first;
    await loser.close();await connect(f.socketPath);assert.equal(winner.isReady(),true);
    await winner.close();assert.equal(fs.existsSync(f.socketPath),false);
  }finally{await Promise.allSettled([first.close(),second.close()]);f.cleanup();}
});
