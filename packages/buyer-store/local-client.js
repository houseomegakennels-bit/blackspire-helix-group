import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {BUYER_STORE_SOCKET,BUYER_STORE_MAX_BYTES,BUYER_STORE_TIMEOUT_MS,validateClientConfiguration,mac,equalMac,exact,fail} from './local-protocol.js';
export function createBuyerStoreLocalClient({configuration,connect=net.createConnection,now=Date.now}={}){
 const config=validateClientConfiguration(configuration);
 const request=(lane,body)=>new Promise((resolve,reject)=>{
  const unsigned={version:1,releaseSha:config.releaseSha,profileDigest:config.profileDigest,id:randomBytes(16).toString('hex'),timestamp:now(),lane,body};
  const bytes=Buffer.from(JSON.stringify({...unsigned,mac:mac(unsigned,config.key)})+'\n');
  if(bytes.length>BUYER_STORE_MAX_BYTES)return reject(new Error('BUYER_STORE_UNAVAILABLE'));
  let socket,settled=false,total=0;const chunks=[];
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);socket?.destroy();error?reject(new Error('BUYER_STORE_UNAVAILABLE')):resolve(result);};
  const timer=setTimeout(()=>finish(true),BUYER_STORE_TIMEOUT_MS);timer.unref();
  try{socket=connect({path:BUYER_STORE_SOCKET});socket.once('error',()=>finish(true));socket.once('connect',()=>socket.end(bytes));
   socket.on('data',chunk=>{total+=chunk.length;if(total>BUYER_STORE_MAX_BYTES)return finish(true);chunks.push(chunk);});
   socket.once('end',()=>{try{
    const data=Buffer.concat(chunks);if(data.at(-1)!==10||data.subarray(0,-1).includes(10))fail();
    const value=JSON.parse(data.toString('utf8')), {mac:signature,...response}=value;
    if(!exact(value,['version','id','ok','result','mac'])||value.version!==1||value.id!==unsigned.id||value.ok!==true||!equalMac(signature,mac(response,config.key)))fail();
    finish(false,value.result);
   }catch{finish(true);}});
   socket.once('close',()=>{if(!settled)finish(true);});
  }catch{finish(true);}
 });
 const readiness=async()=>{const result=await request('ready',{});if(!exact(result,['status','releaseSha','profileDigest','rolesVerified'])||result.status!=='ready'||result.releaseSha!==config.releaseSha||result.profileDigest!==config.profileDigest||result.rolesVerified!==true)fail();return result;};
 return Object.freeze({readiness,checkAvailability:async()=>{try{await readiness();return true;}catch{return false;}},userRequest:body=>request('user',body),readCapabilityProfiles:input=>request('profiles-read',{input})});
}
