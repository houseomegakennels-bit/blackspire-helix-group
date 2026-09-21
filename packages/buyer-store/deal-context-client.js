import crypto from 'node:crypto';
import {signBuyerDealContextRequest,verifyBuyerDealContextResponse} from './deal-context-contract.js';
const PATH='/api/internal/buyer-store/deal-context';
const fail=()=>{throw new Error('Buyer deal context unavailable');};
export function validateBuyerDealContextClientConfiguration(value){
 if(!value||Array.isArray(value)||Object.keys(value).sort().join(',')!=='key,origin,releaseSha,version'
  ||value.version!==1||!/^[a-f0-9]{40}$/.test(value.releaseSha??'')
  ||!/^[A-Za-z0-9_-]{43}$/.test(value.key??''))fail();
 let url;try{url=new URL(value.origin);}catch{fail();}
 if(url.origin!==value.origin||url.protocol!=='https:'||url.port||url.username||url.password
  ||!(url.hostname==='blackspirehelix.com'||/^frontend-[a-z0-9]+-houseomegakennels-4825s-projects\.vercel\.app$/.test(url.hostname)))fail();
 return Object.freeze({...value});
}
export function createBuyerDealContextClient({configuration,fetchImpl=fetch,now=Date.now,random=()=>crypto.randomBytes(32).toString('base64url')}){
 const config=validateBuyerDealContextClientConfiguration(configuration);
 return async function lookupDeal(dealId,{authority,bindingDigest}){
  try{
   if(authority?.releaseSha!==config.releaseSha||authority.capabilityId!=='buyer.matches.search'
    ||!Number.isSafeInteger(authority.expiresAt)||authority.expiresAt<=now())fail();
   const request=signBuyerDealContextRequest({version:1,releaseSha:config.releaseSha,bindingDigest,
    taskId:authority.taskId,dealId,expiresAt:Math.min(authority.expiresAt,now()+10000),nonce:random()},config.key,now());
   const response=await fetchImpl(new URL(PATH,config.origin),{method:'POST',redirect:'error',cache:'no-store',
    signal:AbortSignal.timeout(Math.max(1,Math.min(4000,request.expiresAt-now()))),
    headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(request)});
   if(!response.ok||response.redirected||!response.body||request.expiresAt<=now())fail();
   const reader=response.body.getReader();let size=0;const chunks=[];
   try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>65536)fail();chunks.push(part.value);}}
   finally{await reader.cancel().catch(()=>{});}
   const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
   if(request.expiresAt<=now())fail();
   return verifyBuyerDealContextResponse(body,request,config.key,now());
  }catch{fail();}
 };
}
