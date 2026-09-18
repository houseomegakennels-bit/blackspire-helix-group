// Offline research only: verifies an operation permit; does not execute SQL or HTTP.
import {createHash,createPublicKey,verify} from 'node:crypto';
import {performance} from 'node:perf_hooks';
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const HEX=/^[a-f0-9]{64}$/;
const FIELDS=Object.freeze({
 issue:['p_job','p_owner','p_workspace','p_digest','p_context','p_expected_criteria','p_expected_updated_at','p_request'],
 cancel:['p_job','p_owner','p_workspace'],
 reconcile:['p_job','p_owner','p_workspace','p_request','p_expected_updated_at'],
 apply:['p_digest','p_workspace','q'],
 context:['p_digest','p_workspace','p_job','p_dispatch','p_generation'],
 receipt:['p_digest','p_workspace','p_job','p_dispatch','p_generation','p_operation','p_index'],
 recover:['p_workspace','p_owner','p_original_issuer','p_original_jti','p_original_request','p_original_digest','p_route_operation'],
});
const KIND=Object.freeze({issue:'issuer',cancel:'issuer',reconcile:'issuer',apply:'runtime',context:'runtime',receipt:'runtime',recover:'recovery'});
const BINDING=['releaseSha','operationId','attemptId','workspace'];
const CONFIG=['issuer','audience','subject','keyId','origin',...BINDING];
const CLAIMS=['iss','aud','sub','jti','iat','nbf','exp','kind','operation','requestId','bodyDigest',...BINDING];
const RECOVERY_CLAIMS=['originalIssuer','originalJti','originalRequestId','originalBodyDigest','routeOperation'];
const ENVELOPE=['version','requestId','operation','parameters',...BINDING];
const denied=()=>new Error('Operation permit rejected');
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function frozen(value,depth=0,budget={count:0}){
 if(depth>16||++budget.count>10000)throw denied();
 if(value&&typeof value==='object'){
  for(const key of Object.keys(value)){
   if(['__proto__','constructor','prototype'].includes(key))throw denied();
   frozen(value[key],depth+1,budget);
  }
  Object.freeze(value);
 }
 return value;
}
function parse(text,limit){
 if(typeof text!=='string'||text.length<2||text.length>limit||Buffer.byteLength(text)>limit)throw denied();
 const value=JSON.parse(text);
 // The isolated protocol requires exact JSON.stringify serialization. This also
 // rejects duplicate keys, alternate number encodings and invalid UTF-8 round trips.
 if(JSON.stringify(value)!==text)throw denied();
 return frozen(value);
}
function decode(part,max){
 if(typeof part!=='string'||part.length===0||part.length>max*2||!/^[A-Za-z0-9_-]+$/.test(part))throw denied();
 const bytes=Buffer.from(part,'base64url');
 if(bytes.length>max||bytes.toString('base64url')!==part)throw denied();
 return bytes;
}
const utf8=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
const digest=text=>createHash('sha256').update(text).digest('hex');
export function createOperationPermitVerifier({mode,configuration,publicKeyPem,consume,validateParameters,now=()=>Math.floor(Date.now()/1000),reserveTimeoutMs=1000}={}){
 let config,key;
 try{
  if(mode!=='isolated-prototype'||typeof consume!=='function'||typeof validateParameters!=='function'||typeof now!=='function'||!Number.isInteger(reserveTimeoutMs)||reserveTimeoutMs<10||reserveTimeoutMs>5000)throw denied();
  config=parse(configuration,4096);
  if(!exact(config,CONFIG)||CONFIG.some(k=>typeof config[k]!=='string'||config[k].length===0||config[k].length>200))throw denied();
  if(!/^[a-f0-9]{40}$/.test(config.releaseSha)||!UUID.test(config.operationId)||!UUID.test(config.attemptId)||!UUID.test(config.subject)||!/^[A-Za-z0-9._:-]{1,128}$/.test(config.workspace)||!/^[A-Za-z0-9_-]{1,64}$/.test(config.keyId))throw denied();
  const origin=new URL(config.origin);
  if(origin.protocol!=='https:'||origin.origin!==config.origin||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw denied();
  if(typeof publicKeyPem!=='string'||publicKeyPem.length>1024||!publicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----'))throw denied();
  key=createPublicKey(publicKeyPem);
  if(key.type!=='public'||key.asymmetricKeyType!=='ed25519')throw denied();
 }catch{throw denied();}
 let lastTime=-1;
 function clock(){const t=now();if(!Number.isSafeInteger(t)||t<0||t<lastTime)throw denied();lastTime=t;return t;}
 return Object.freeze({profile:'ISOLATED_OPERATION_PERMIT',authorize:async request=>{
  let timer,controller;
  try{
   if(!exact(request,['origin','method','path','profile','body','token']))throw denied();
   const {origin,method,path,profile,body,token}=request;
   if(origin!==config.origin||method!=='POST'||profile!=='buyer_writer_rpc'||typeof token!=='string'||token.length>4096)throw denied();
   const parts=token.split('.');if(parts.length!==3)throw denied();
   const header=parse(utf8(decode(parts[0],512)),512);
   if(!exact(header,['alg','typ','kid'])||header.alg!=='Ed25519'||header.typ!=='zola-operation+jwt'||header.kid!==config.keyId)throw denied();
   const signature=decode(parts[2],64);if(signature.length!==64)throw denied();
   if(!verify(null,Buffer.from(parts[0]+'.'+parts[1]),key,signature))throw denied();
   const claims=parse(utf8(decode(parts[1],2048)),2048);
   const claimFields=claims?.operation==='recover'?[...CLAIMS,...RECOVERY_CLAIMS]:CLAIMS;
   if(!exact(claims,claimFields)||claims.iss!==config.issuer||claims.aud!==config.audience||claims.sub!==config.subject||!UUID.test(claims.jti)||!UUID.test(claims.requestId)||!HEX.test(claims.bodyDigest))throw denied();
   if(!Object.hasOwn(KIND,claims.operation)||KIND[claims.operation]!==claims.kind||path!=='/rest/v1/rpc/'+claims.operation)throw denied();
   if(claims.operation==='recover'&&(
    typeof claims.originalIssuer!=='string'||claims.originalIssuer.length<1||claims.originalIssuer.length>200
    ||!UUID.test(claims.originalJti)||!UUID.test(claims.originalRequestId)||!HEX.test(claims.originalBodyDigest)
    ||!['apply','issue','cancel','reconcile','receipt'].includes(claims.routeOperation)))throw denied();
   if(BINDING.some(k=>claims[k]!==config[k]))throw denied();
   if(![claims.iat,claims.nbf,claims.exp].every(Number.isSafeInteger)||claims.iat!==claims.nbf||claims.iat<0||claims.exp<=claims.iat||claims.exp-claims.iat>60)throw denied();
   const time=clock();if(claims.nbf>time||claims.exp<=time)throw denied();
   if(typeof body!=='string'||body.length>65536||Buffer.byteLength(body)>65536||digest(body)!==claims.bodyDigest)throw denied();
   const wrapper=parse(body,65536);if(!exact(wrapper,['envelope']))throw denied();
   const envelope=wrapper.envelope;
   if(!exact(envelope,ENVELOPE)||envelope.version!==1||envelope.requestId!==claims.requestId||envelope.operation!==claims.operation||BINDING.some(k=>envelope[k]!==config[k]))throw denied();
   const parameters=envelope.parameters;
   if(!exact(parameters,FIELDS[claims.operation])||parameters.p_workspace!==config.workspace||(Object.hasOwn(parameters,'p_owner')&&parameters.p_owner!==claims.sub))throw denied();
   if(claims.operation==='recover'&&(
    parameters.p_original_issuer!==claims.originalIssuer||parameters.p_original_jti!==claims.originalJti
    ||parameters.p_original_request!==claims.originalRequestId||parameters.p_original_digest!==claims.originalBodyDigest
    ||parameters.p_route_operation!==claims.routeOperation))throw denied();
   if(validateParameters(claims.operation,parameters,claims)!==true)throw denied();
   const reservationDeadline=performance.now()+reserveTimeoutMs;
   controller=new AbortController();
   const record=Object.freeze({issuer:claims.iss,jti:claims.jti,requestId:claims.requestId,bodyDigest:claims.bodyDigest,expiresAt:claims.exp});
   const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(denied());},reserveTimeoutMs);});
   const accepted=await Promise.race([Promise.resolve().then(()=>consume(record,controller.signal)),deadline]);
   if(accepted!==true||controller.signal.aborted||performance.now()>=reservationDeadline||clock()>=claims.exp)throw denied();
   return frozen({version:1,issuer:claims.iss,jti:claims.jti,requestId:claims.requestId,bodyDigest:claims.bodyDigest,operation:claims.operation,kind:claims.kind,subject:claims.sub,expiresAt:claims.exp,parameters,...Object.fromEntries(BINDING.map(k=>[k,config[k]]))});
  }catch{throw denied();}
  finally{clearTimeout(timer);}
 }});
}
