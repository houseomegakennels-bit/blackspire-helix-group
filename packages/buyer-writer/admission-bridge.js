import {timingSafeEqual} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {performance} from 'node:perf_hooks';
import {createOperationPermitVerifier} from './operation-permit.js';
import {captureBuyerJobVersion,validateBuyerJobRevision} from './criteria.js';
import {validateBuyerSourceContext} from './source-context.js';
import {parseWriterOperation,parseWriterReceipt} from './protocol.js';
import {AdmissionUnavailableError,executeAdmission} from './admission-executor.js';

export const ADMISSION_SQL=Object.freeze({
 reserve:'select buyer_writer.reserve_operation($1,$2::uuid,$3::uuid,$4,$5::timestamptz) as accepted',
 apply:'select buyer_writer.execute_admitted_apply($1,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7::uuid,$8::uuid,$9,$10,$11::jsonb) as result',
 issue:'select buyer_writer.execute_admitted_issue($1,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7::uuid,$8::uuid,$9,$10::uuid,$11,$12::jsonb,$13::jsonb,$14::timestamptz,$15::uuid) as result',
 cancel:'select buyer_writer.execute_admitted_cancel($1,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7::uuid,$8::uuid,$9,$10::uuid) as result',
 reconcile:'select buyer_writer.execute_admitted_reconcile($1,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7::uuid,$8::uuid,$9,$10::uuid,$11::uuid,$12::timestamptz) as result',
 receipt:'select buyer_writer.execute_admitted_receipt($1,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7::uuid,$8::uuid,$9,$10,$11::uuid,$12::uuid,$13::bigint,$14,$15::integer) as result',
 correlate:'select buyer_writer.correlate_admission($1,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7::uuid,$8::uuid,$9) as result',
});

class AdmissionBridgeError extends Error {
 constructor(status=401){super('Buyer admission rejected');this.status=status;}
}
const reject=status=>{throw new AdmissionBridgeError(status);};
const response=(status,code)=>({status,body:{ok:false,code,automaticRetry:false}});
const sqlStatus=new Map([['42501',403],['22023',400],['22P02',400],['23505',409]]);
const plain=(value,keys)=>{
 if(value===null||typeof value!=='object'||Array.isArray(value))return false;
 if(![Object.prototype,null].includes(Object.getPrototypeOf(value)))return false;
 const d=Object.getOwnPropertyDescriptors(value);
 return Object.getOwnPropertySymbols(value).length===0&&Object.keys(d).length===keys.length
  &&keys.every(k=>d[k]?.enumerable&&Object.hasOwn(d[k],'value'));
};
function readHttpRequest(request){
 if(!plain(request,['origin','method','path','rawHeaders','body']))reject(400);
 const {origin,method,path,rawHeaders,body}=request;
 if(typeof origin!=='string'||method!=='POST'||typeof path!=='string'||!Buffer.isBuffer(body)||body.length>65536)reject(400);
 if(!Array.isArray(rawHeaders)||rawHeaders.length>200||rawHeaders.length%2)reject(400);
 const selected=Object.create(null);let bytes=0;
 for(let i=0;i<rawHeaders.length;i+=2){
  const name=rawHeaders[i],value=rawHeaders[i+1];
  if(typeof name!=='string'||typeof value!=='string')reject(400);
  bytes+=Buffer.byteLength(name)+Buffer.byteLength(value);if(bytes>32768)reject(400);
  const key=name.toLowerCase();
  if(['authorization','content-length','content-type','transfer-encoding','content-encoding'].includes(key)){
   if(Object.hasOwn(selected,key))reject(400);
   selected[key]=value;
  }
 }
 if(Object.hasOwn(selected,'transfer-encoding')||Object.hasOwn(selected,'content-encoding'))reject(400);
 if(selected['content-type']!=='application/json')reject(400);
 if(!/^(0|[1-9][0-9]{0,5})$/.test(selected['content-length']??'')
  ||Number(selected['content-length'])!==body.length)reject(400);
 const authorization=selected.authorization;
 if(typeof authorization!=='string'||!authorization.startsWith('Bearer ')
  ||authorization.length<8||authorization.length>4103)reject(401);
 const token=authorization.slice(7);
 if(token.includes(' ')||token.includes('\t')||token.includes('\r')||token.includes('\n'))reject(401);
 let text;
 try{text=new TextDecoder('utf-8',{fatal:true}).decode(body);}catch{reject(400);}
 if(!timingSafeEqual(body,Buffer.from(text,'utf8')))reject(400);
 return {origin,method,path,profile:'buyer_writer_rpc',body:text,token};
}
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const DIGEST=/^[a-f0-9]{64}$/;
function parsedParameters(operation,p,claims){
 if(operation==='apply'){
  if(!plain(p,['p_digest','p_workspace','q'])||typeof p.p_digest!=='string'||!DIGEST.test(p.p_digest))reject();
  const q=p.q;
  if(!plain(q,['jobId','version','dispatchId','generation','operation','chunkIndex','chunkCount','payload']))reject();
  const {jobId,...value}=q;
  return {value:parseWriterOperation({jobId,body:Buffer.from(JSON.stringify(value))}),sql:[p.p_digest,JSON.stringify(q)]};
 }
 if(operation==='issue'){
  if(!UUID.test(p.p_job)||!DIGEST.test(p.p_digest)||!UUID.test(p.p_request)
   ||p.p_request!==claims.operationId)reject();
  captureBuyerJobVersion({...p.p_expected_criteria,updated_at:p.p_expected_updated_at});
  validateBuyerSourceContext(p.p_context);
  return {value:p,sql:[p.p_job,p.p_digest,JSON.stringify(p.p_context),JSON.stringify(p.p_expected_criteria),
   p.p_expected_updated_at,p.p_request]};
 }
 if(operation==='cancel'){
  if(!UUID.test(p.p_job))reject();
  return {value:p,sql:[p.p_job]};
 }
 if(operation==='reconcile'){
  if(!UUID.test(p.p_job)||!UUID.test(p.p_request))reject();
  validateBuyerJobRevision(p.p_expected_updated_at);
  return {value:p,sql:[p.p_job,p.p_request,p.p_expected_updated_at]};
 }
 if(operation==='receipt'){
  if(!DIGEST.test(p.p_digest))reject();
  const receipt=parseWriterReceipt({jobId:p.p_job,body:Buffer.from(JSON.stringify({
   version:1,dispatchId:p.p_dispatch,generation:p.p_generation,operation:p.p_operation,chunkIndex:p.p_index,
  }))});
  return {value:receipt,sql:[p.p_digest,p.p_job,p.p_dispatch,p.p_generation,p.p_operation,p.p_index]};
 }
 reject();
}
function one(result,column){
 if(!result||!Array.isArray(result.rows)||result.rows.length!==1
  ||!plain(result.rows[0],[column]))reject(503);
 return result.rows[0][column];
}
function resultKind(operation,value,parsed){
 if(operation==='apply'){
  if(plain(value,['ok','operation','chunkIndex'])&&value.ok===true
   &&value.operation===parsed.value.operation&&value.chunkIndex===parsed.value.chunkIndex)return 'succeeded';
  if(plain(value,['ok','code'])&&value.ok===false&&value.code==='WRITE_FAILED')return 'business_failed';
 }else if(operation==='issue'){
  if(plain(value,['dispatchId','generation'])&&value.dispatchId===parsed.value.p_request
   &&Number.isSafeInteger(value.generation)&&value.generation>0)return 'succeeded';
 }else if(operation==='cancel'){
  if(plain(value,['cancelled','jobId'])&&value.cancelled===true&&value.jobId===parsed.value.p_job)return 'succeeded';
 }else if(operation==='reconcile'){
  const state=value?.state;
  if(plain(value,['dispatchId','generation','state'])&&value.dispatchId===parsed.value.p_request
   &&['absent','cancelled','completed','failed'].includes(state)
   &&(state==='absent'?value.generation===null:Number.isSafeInteger(value.generation)&&value.generation>0))return 'succeeded';
 }else if(operation==='receipt'&&plain(value,['found','receipt'])&&typeof value.found==='boolean'){
  if(!value.found&&value.receipt===null)return 'succeeded';
  if(value.found&&(plain(value.receipt,['ok','operation','chunkIndex'])&&value.receipt.ok===true
    &&value.receipt.operation===parsed.value.operation&&value.receipt.chunkIndex===parsed.value.chunkIndex
    ||plain(value.receipt,['ok','code'])&&value.receipt.ok===false&&value.receipt.code==='WRITE_FAILED'))return 'succeeded';
 }
 return null;
}
function admissionParameters(auth){
 return [auth.issuer,auth.jti,auth.requestId,auth.bodyDigest,auth.subject,
  auth.releaseSha,auth.operationId,auth.attemptId,auth.workspace];
}
function recoveryResponse(value,operation,parsed){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.automaticRetry!==false)return response(503,'ADMISSION_UNKNOWN');
 if(value.state==='reserved'&&plain(value,['state','automaticRetry']))return response(503,'ADMISSION_RESERVED');
 if(value.state==='inconsistent'&&plain(value,['state','automaticRetry']))return response(503,'ADMISSION_INCONSISTENT');
 if(!['succeeded','business_failed'].includes(value.state)
  ||!plain(value,['state','routeOperation','result','automaticRetry','requestCorrelated'])
  ||value.routeOperation!==operation||value.requestCorrelated!==true)return response(503,'ADMISSION_UNKNOWN');
 const kind=resultKind(operation,value.result,parsed);
 if(kind!==value.state)return response(503,'ADMISSION_INCONSISTENT');
 return kind==='succeeded'
  ?{status:200,body:{...value.result,recovered:true,automaticRetry:false}}
  :response(409,'WRITE_FAILED');
}
async function boundedOperation(executor,operation,values,timeoutMs){
 const controller=new AbortController();let timer;
 try{
  return await Promise.race([
   executeAdmission(executor,operation,values,{signal:controller.signal}),
   new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new AdmissionUnavailableError());},timeoutMs);}),
  ]);
 }finally{clearTimeout(timer);}
}

// The closed executor selects one of seven fixed admission statements and attests
// every session. Production wiring must separately pin its connector and TLS endpoint.
export function createAdmissionBridge({mode,configuration,publicKeyPem,admissionExecutor,now,
 reserveTimeoutMs=5000,executeTimeoutMs=5000,correlateTimeoutMs=3000}={}){
 if(mode!=='research-admission'||!admissionExecutor||typeof admissionExecutor!=='object'
  ||![executeTimeoutMs,correlateTimeoutMs].every(value=>
   Number.isInteger(value)&&value>=10&&value<=10000))throw new TypeError('Buyer admission configuration unavailable');
 const sessions=new AsyncLocalStorage();
 const reserve=async(record,signal)=>{
  const store=sessions.getStore();
  if(!store)throw new AdmissionUnavailableError();
  const deadline=performance.now()+reserveTimeoutMs;
  const unavailable=()=>{store.unavailable=true;};
  signal.addEventListener('abort',unavailable,{once:true});
  try{
   if(signal.aborted)throw new AdmissionUnavailableError();
   const result=await executeAdmission(admissionExecutor,'reserve',[
    record.issuer,record.jti,record.requestId,record.bodyDigest,new Date(record.expiresAt*1000).toISOString(),
   ],{signal});
   if(signal.aborted||performance.now()>=deadline)throw new AdmissionUnavailableError();
   return one(result,'accepted')===true;
  }catch(error){store.unavailable=true;throw error;}
  finally{signal.removeEventListener('abort',unavailable);}
 };
 const verifier=createOperationPermitVerifier({
  mode:'isolated-prototype',configuration,publicKeyPem,consume:reserve,now,reserveTimeoutMs,
  validateParameters:(operation,parameters,claims)=>{
   if(!['issue','cancel','reconcile','apply','receipt'].includes(operation))return false;
   try{parsedParameters(operation,parameters,claims);return true;}catch{return false;}
  },
 });
 return async function handle(request){
  let attempt;const store={unavailable:false};
  try{
   attempt=await sessions.run(store,async()=>{
     let auth;
     try{auth=await verifier.authorize(readHttpRequest(request));}
     catch(error){if(store.unavailable)throw new AdmissionUnavailableError();throw error;}
     const parsed=parsedParameters(auth.operation,auth.parameters,auth),base=admissionParameters(auth);
     try{
      const result=await boundedOperation(admissionExecutor,auth.operation,[...base,...parsed.sql],executeTimeoutMs);
      const value=one(result,'result'),kind=resultKind(auth.operation,value,parsed);
      if(kind==='succeeded')return {done:true,response:{status:200,body:{...value,automaticRetry:false}}};
      if(kind==='business_failed')return {done:true,response:response(409,'WRITE_FAILED')};
      return {done:false,auth,parsed};
     }catch(error){
      const status=sqlStatus.get(error?.code);
      if(status)return {done:true,response:response(status,status===403?'ADMISSION_REJECTED':'ADMISSION_INVALID')};
      return {done:false,auth,parsed};
     }
   });
  }catch(error){
   if(error instanceof AdmissionUnavailableError)return response(503,'ADMISSION_UNAVAILABLE');
   const status=error instanceof AdmissionBridgeError?error.status:401;
   return response(status,'ADMISSION_REJECTED');
  }
  if(attempt.done)return attempt.response;
  const base=admissionParameters(attempt.auth);
  try{
   const correlated=one(await boundedOperation(admissionExecutor,'correlate',base,correlateTimeoutMs),'result');
   return recoveryResponse(correlated,attempt.auth.operation,attempt.parsed);
  }catch{
   return response(503,'ADMISSION_UNKNOWN');
  }
 };
}
