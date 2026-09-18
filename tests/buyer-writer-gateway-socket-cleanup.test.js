import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {
 cleanupBuyerWriterGatewaySocket,resolveBuyerWriterSocketIdentity,
} from '../packages/buyer-writer/gateway-socket-cleanup.js';

const publicPath='/run/blackspire/buyer-writer.sock';
const identity=Object.freeze({uid:1001,gid:1002});
function metadata(stat,values){
 return Object.assign(Object.create(Object.getPrototypeOf(stat)),stat,values);
}
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'gateway-supervisor-cleanup-'));
 fs.chmodSync(root,0o750);const socket=path.join(root,'buyer-writer.sock');
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const io={...fs,
  lstatSync(filename){
   const actual=filename==='/run/blackspire'?root:filename===publicPath?socket:
    filename.startsWith('/run/blackspire/')?path.join(root,path.basename(filename)):filename;
   const stat=fs.lstatSync(actual);
   return metadata(stat,filename==='/run/blackspire'
    ?{uid:identity.uid,gid:identity.gid,mode:(stat.mode&~0o7777)|0o750}
    :filename===publicPath?{uid:identity.uid,gid:identity.gid,mode:(stat.mode&~0o7777)|0o660}:{});
  },
  unlinkSync(filename){return fs.unlinkSync(filename===publicPath?socket:filename);},
  readdirSync(filename,...args){return fs.readdirSync(filename==='/run/blackspire'?root:filename,...args);},
  readFileSync(filename,...args){
   const value=fs.readFileSync(filename,...args);
   return filename==='/proc/net/unix'&&typeof value==='string'?value.replaceAll(root,'/run/blackspire'):value;
  },
 };
 const cleanup=(extra={})=>cleanupBuyerWriterGatewaySocket({
  socketPath:publicPath,io,getuid:()=>0,identity,...extra,
 });
 return {root,socket,io,cleanup};
}
const start=socket=>new Promise((resolve,reject)=>{
 const server=net.createServer();server.once('error',reject);
 server.listen(socket,()=>{server.off('error',reject);resolve(server);});
});
const stop=server=>new Promise(resolve=>server.close(resolve));
async function stale(socket){
 const child=spawn(process.execPath,['-e',
  "const net=require('node:net');const s=net.createServer();s.listen(process.argv[1],()=>process.send('ready'));setInterval(()=>{},1000)",
  socket],{stdio:['ignore','ignore','ignore','ipc']});
 await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);});
 child.kill('SIGKILL');await new Promise(resolve=>child.once('exit',resolve));
}

test('supervisor cleanup treats an absent public socket as an idempotent success',t=>{
 const f=fixture(t);
 assert.deepEqual(f.cleanup(),{status:'ABSENT'});
});

test('supervisor cleanup refuses a live listener without changing it',async t=>{
 const f=fixture(t),server=await start(f.socket);
 try{
  assert.throws(()=>f.cleanup(),/cleanup rejected/);
  assert.equal(fs.lstatSync(f.socket).isSocket(),true);
 }finally{await stop(server);}
});
test('supervisor cleanup detects a live listener through its same-inode backing path',async t=>{
 const f=fixture(t),backing=path.join(f.root,'.bw-'+('a'.repeat(24))+'.sock');
 const server=await start(backing);fs.linkSync(backing,f.socket);
 try{
  assert.throws(()=>f.cleanup(),/cleanup rejected/);
  assert.equal(fs.lstatSync(f.socket).isSocket(),true);
 }finally{await stop(server);}
});

test('supervisor cleanup removes only a fully verified stale public socket',async t=>{
 const f=fixture(t);await stale(f.socket);
 assert.equal(fs.lstatSync(f.socket).isSocket(),true);
 assert.deepEqual(f.cleanup(),{status:'STALE_SOCKET_REMOVED'});
 assert.equal(fs.existsSync(f.socket),false);
});

test('wrong path type and a replacement during confirmation are preserved',async t=>{
 const regular=fixture(t);fs.writeFileSync(regular.socket,'sentinel',{mode:0o600});
 assert.throws(()=>regular.cleanup(),/cleanup rejected/);
 assert.equal(fs.readFileSync(regular.socket,'utf8'),'sentinel');

 const raced=fixture(t);await stale(raced.socket);let publicReads=0;
 const io={...raced.io,lstatSync(filename){
  if(filename===publicPath&&++publicReads===2){
   fs.unlinkSync(raced.socket);fs.writeFileSync(raced.socket,'replacement',{mode:0o600});
  }
  return raced.io.lstatSync(filename);
 }};
 assert.throws(()=>raced.cleanup({io}),/cleanup rejected/);
 assert.equal(fs.readFileSync(raced.socket,'utf8'),'replacement');
});

test('identity lookup and CLI surface are fixed and fail closed',()=>{
 const lookup=(_command,args)=>{
  if(args[0]==='passwd')return 'blackspire-writer:x:1001:1003::/nonexistent:/usr/sbin/nologin\n';
  return 'blackspire-api:x:1002:\n';
 };
 assert.deepEqual(resolveBuyerWriterSocketIdentity({lookup}),identity);
 assert.throws(()=>resolveBuyerWriterSocketIdentity({lookup:()=> 'root:x:0:0::/root:/bin/bash\n'}),/cleanup rejected/);
 const source=fs.readFileSync(new URL('../packages/buyer-writer/gateway-socket-cleanup.js',import.meta.url),'utf8');
 assert.match(source,/process\.argv\.length!==2/);
 assert.doesNotMatch(source,/process\.env/);
});
