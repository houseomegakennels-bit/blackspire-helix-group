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
    await gateway.close();
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
