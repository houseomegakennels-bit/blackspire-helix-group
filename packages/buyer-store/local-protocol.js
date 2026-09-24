import {createHmac,timingSafeEqual} from 'node:crypto';
export const BUYER_STORE_SOCKET='/run/blackspire-buyer-store/store.sock';
export const BUYER_STORE_MAX_BYTES=600*1024;
export const BUYER_STORE_TIMEOUT_MS=12000;
export const fail=()=>{throw new Error('BUYER_STORE_UNAVAILABLE');};
export const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
export function validateClientConfiguration(v){
 if(!exact(v,['version','releaseSha','profileDigest','key'])||v.version!==1||!/^[a-f0-9]{40}$/.test(v.releaseSha)||!/^[a-f0-9]{64}$/.test(v.profileDigest)||!/^[A-Za-z0-9_-]{43}$/.test(v.key))fail();return Object.freeze({...v});
}
export function mac(value,key){return createHmac('sha256',key).update(JSON.stringify(value)).digest('hex');}
export function equalMac(a,b){return typeof a==='string'&&/^[a-f0-9]{64}$/.test(a)&&timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));}
export function validateRequest(value,configuration,{now=Date.now,seen}={}){
 if(!exact(value,['version','releaseSha','profileDigest','id','timestamp','lane','body','mac']))fail();
 const {mac:signature,...unsigned}=value;
 if(value.version!==1||value.releaseSha!==configuration.releaseSha||value.profileDigest!==configuration.profileDigest||!/^[a-f0-9]{32}$/.test(value.id)||!Number.isSafeInteger(value.timestamp)||Math.abs(now()-value.timestamp)>15000||!equalMac(signature,mac(unsigned,configuration.key)))fail();
 if(value.lane==='user'){
  if(!exact(value.body,['operation','accessToken','input'])||typeof value.body.accessToken!=='string'||value.body.accessToken.length>8192)fail();
 }else if(value.lane==='ready'){
  if(!exact(value.body,[]))fail();
 }else if(value.lane==='profiles-read'){
  if(!exact(value.body,['input']))fail();
 }else fail();
 for(const [id,time] of seen)if(time<now()-30000)seen.delete(id);
 if(seen.has(value.id)||seen.size>=4096)fail();seen.set(value.id,now());return value;
}
