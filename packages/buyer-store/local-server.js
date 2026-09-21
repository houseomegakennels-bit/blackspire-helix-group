import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import {BUYER_STORE_SOCKET,BUYER_STORE_MAX_BYTES,BUYER_STORE_TIMEOUT_MS,validateClientConfiguration,validateRequest,mac,fail} from './local-protocol.js';
export function createBuyerStoreLocalServer({configuration,userHandler,readCapabilityProfiles,validateInput,attestation,fence,readiness,now=Date.now}={}){
 const config=validateClientConfiguration(configuration),seen=new Map();
 if(typeof userHandler!=='function'||typeof readCapabilityProfiles!=='function'||typeof validateInput!=='function')fail();
 const server=net.createServer({allowHalfOpen:true},socket=>{
  let total=0,done=false;const chunks=[];
  socket.setTimeout(BUYER_STORE_TIMEOUT_MS,()=>socket.destroy());socket.on('error',()=>{});
  socket.on('data',chunk=>{total+=chunk.length;if(total>BUYER_STORE_MAX_BYTES){done=true;socket.destroy();return;}chunks.push(chunk);});
  socket.once('end',async()=>{
   if(done)return;done=true;
   try{
    const bytes=Buffer.concat(chunks);if(bytes.at(-1)!==10||bytes.subarray(0,-1).includes(10))fail();
    const request=validateRequest(JSON.parse(bytes.toString('utf8')),config,{now,seen});
    const dispatch=async()=>{
    const proof=attestation?await attestation.verify():null;
    const result=request.lane==='ready'
     ?await (typeof readiness==='function'?readiness:fail)()
     :request.lane==='user'
     ?await userHandler({...request.body,input:validateInput(request.body.operation,request.body.input)})
     :await readCapabilityProfiles(validateInput('profiles-list',request.body.input));
    if(attestation)await attestation.verifyUnchanged(proof);
    return result;
    };
    const result=fence?await fence.run(request.lane,dispatch):await dispatch();
    if(socket.destroyed)return;
    const unsigned={version:1,id:request.id,ok:true,result},response=Buffer.from(JSON.stringify({...unsigned,mac:mac(unsigned,config.key)})+'\n');
    if(response.length>BUYER_STORE_MAX_BYTES)fail();socket.end(response);
   }catch{socket.destroy();}
  });
 });
 server.maxConnections=32;
 return server;
}
export async function listenBuyerStore(server,{uid=process.getuid(),ipcGroupId,groups=process.getgroups(),io=fs}={}){
 if(!Number.isInteger(uid)||uid===0||!Number.isInteger(ipcGroupId)||ipcGroupId===process.getgid()||!groups.includes(ipcGroupId))fail();
 const parent=io.lstatSync(path.dirname(BUYER_STORE_SOCKET));
 if(!parent.isDirectory()||parent.isSymbolicLink()||parent.uid!==uid||(parent.mode&0o777)!==0o750)fail();
 // Refuse stale or foreign paths. RuntimeDirectory cleanup is systemd-owned.
 try{io.lstatSync(BUYER_STORE_SOCKET);fail();}catch(error){if(error.code!=='ENOENT')throw error;}
 io.chownSync(path.dirname(BUYER_STORE_SOCKET),uid,ipcGroupId);
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(BUYER_STORE_SOCKET,()=>{io.chownSync(BUYER_STORE_SOCKET,uid,ipcGroupId);io.chmodSync(BUYER_STORE_SOCKET,0o660);resolve();});});
 return server;
}
