import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
const fail=()=>{throw new Error('BUYER_DEAL_CONTEXT_REFUSED');};
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const sign=(purpose,value,key)=>{if(typeof key!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(key)||Buffer.from(key,'base64url').length!==32)fail();return createHmac('sha256',Buffer.from(key,'base64url')).update(`${purpose}\n${JSON.stringify(value)}`).digest('hex');};
const eq=(a,b)=>typeof a==='string'&&/^[a-f0-9]{64}$/.test(a)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const shape=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys;
function claims(value,now){
 if(!shape(value,'bindingDigest,dealId,expiresAt,nonce,releaseSha,taskId,version')||value.version!==1||!/^[a-f0-9]{40}$/.test(value.releaseSha)||!/^[a-f0-9]{64}$/.test(value.bindingDigest)||!/^DE-\d{4}$/.test(value.dealId)||!/^[A-Za-z0-9._:-]{1,256}$/.test(value.taskId)||!/^[A-Za-z0-9_-]{43}$/.test(value.nonce)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt<=now||value.expiresAt>now+15000)fail();
 return {version:1,releaseSha:value.releaseSha,bindingDigest:value.bindingDigest,taskId:value.taskId,dealId:value.dealId,expiresAt:value.expiresAt,nonce:value.nonce};
}
export function signBuyerDealContextRequest(value,key,now=Date.now()){
 const canonical=claims(value,now);return {...canonical,signature:sign('buyer-deal-context-request-v1',canonical,key)};
}
export function verifyBuyerDealContextRequest(value,key,releaseSha,now=Date.now()){
 if(!shape(value,'bindingDigest,dealId,expiresAt,nonce,releaseSha,signature,taskId,version'))fail();
 const {signature,...raw}=value,canonical=claims(raw,now);
 if(canonical.releaseSha!==releaseSha||!eq(signature,sign('buyer-deal-context-request-v1',canonical,key)))fail();
 return {...canonical,signature};
}
function dealShape(deal){if(deal!==null&&(!shape(deal,'city,county,property_address,property_type')||Object.values(deal).some(v=>v!==null&&(typeof v!=='string'||v.length>1024))))fail();return deal;}
export function signBuyerDealContextResponse(request,deal,observation,key,now=Date.now()){
 verifyBuyerDealContextRequest(request,key,request.releaseSha,now);dealShape(deal);
 if(!shape(observation,'latencyMs,requests,responseBytes')||!Number.isSafeInteger(observation.requests)||observation.requests!==1||!Number.isSafeInteger(observation.responseBytes)||observation.responseBytes<0||observation.responseBytes>32768||!Number.isSafeInteger(observation.latencyMs)||observation.latencyMs<0||observation.latencyMs>8000)fail();
 const value={version:1,requestDigest:hash(request),deal,observation};return {...value,signature:sign('buyer-deal-context-response-v1',value,key)};
}
export function verifyBuyerDealContextResponse(value,request,key,now=Date.now()){
 verifyBuyerDealContextRequest(request,key,request.releaseSha,now);
 if(!shape(value,'deal,observation,requestDigest,signature,version'))fail();
 const expected=signBuyerDealContextResponse(request,value.deal,value.observation,key,now);
 if(value.version!==1||value.requestDigest!==expected.requestDigest||!eq(value.signature,expected.signature))fail();
 return {deal:value.deal,observation:value.observation};
}
