import {timingSafeEqual} from 'node:crypto';
import {createOperationPermitVerifier} from './operation-permit.js';
import {parseWriterOperation} from './protocol.js';

export const ADMISSION_SQL=Object.freeze({
 reserve:'select buyer_writer.reserve_operation($1,$2::uuid,$3::uuid,$4,$5::timestamptz) as accepted',
 apply:'select buyer_writer.execute_admitted_apply($1,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7::uuid,$8::uuid,$9,$10,$11::jsonb) as result',
 correlate:'select buyer_writer.correlate_admission($1,$2::uuid,$3::uuid,$4,$5::uuid,$6,$7::uuid,$8::uuid,$9) as result',
});

class AdmissionBridgeError extends Error {
 constructor(status=401){super('Buyer admission rejected');this.status=status;}
}
const reject=status=>{throw new AdmissionBridgeError(status);};
const response=(status,code)=>({status,body:{ok:false,code,automaticRetry:false}});
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
function parsedApply(parameters){
 if(!plain(parameters,['p_digest','p_workspace','q'])
  ||typeof parameters.p_digest!=='string'||!/^[a-f0-9]{64}$/.test(parameters.p_digest))reject();
 const q=parameters.q;
 if(!plain(q,['jobId','version','dispatchId','generation','operation','chunkIndex','chunkCount','payload']))reject();
 const {jobId,...operation}=q;
 const parsed=parseWriterOperation({jobId,body:Buffer.from(JSON.stringify(operation))});
 return {parsed,q};
}
function one(result,column){
 if(!result||!Array.isArray(result.rows)||result.rows.length!==1
  ||!plain(result.rows[0],[column]))reject(503);
 return result.rows[0][column];
}
const canonicalResult=(value,operation,index)=>{
 if(plain(value,['ok','operation','chunkIndex'])&&value.ok===true
  &&value.operation===operation&&value.chunkIndex===index)return 'succeeded';
 if(plain(value,['ok','code'])&&value.ok===false&&value.code==='WRITE_FAILED')return 'business_failed';
 return null;
};
function admissionParameters(auth){
 return [auth.issuer,auth.jti,auth.requestId,auth.bodyDigest,auth.subject,
  auth.releaseSha,auth.operationId,auth.attemptId,auth.workspace];
}
function recoveryResponse(value,operation,index){
 if(!value||typeof value!=='object'||Array.isArray(value)||value.automaticRetry!==false)return response(503,'ADMISSION_UNKNOWN');
 if(value.state==='reserved'&&plain(value,['state','automaticRetry']))return response(503,'ADMISSION_RESERVED');
 if(value.state==='inconsistent'&&plain(value,['state','automaticRetry']))return response(503,'ADMISSION_INCONSISTENT');
 if(!['succeeded','business_failed'].includes(value.state)
  ||!plain(value,['state','result','automaticRetry','requestCorrelated'])
  ||value.requestCorrelated!==true)return response(503,'ADMISSION_UNKNOWN');
 const kind=canonicalResult(value.result,operation,index);
 if(kind!==value.state)return response(503,'ADMISSION_INCONSISTENT');
 return kind==='succeeded'
  ?{status:200,body:{...value.result,recovered:true,automaticRetry:false}}
  :response(409,'WRITE_FAILED');
}

// admissionQuery must be backed by the dedicated admission-only database identity;
// this boundary never accepts or falls back to a runtime/issuer/admin connection.
export function createAdmissionBridge({mode,configuration,publicKeyPem,admissionQuery,now,reserveTimeoutMs=1000}={}){
 if(mode!=='research-admission'||typeof admissionQuery!=='function')throw new TypeError('Buyer admission configuration unavailable');
 const reserve=async(record,signal)=>{
  const result=await admissionQuery(ADMISSION_SQL.reserve,[
   record.issuer,record.jti,record.requestId,record.bodyDigest,new Date(record.expiresAt*1000).toISOString(),
  ],{signal});
  return one(result,'accepted')===true;
 };
 const verifier=createOperationPermitVerifier({
  mode:'isolated-prototype',configuration,publicKeyPem,consume:reserve,now,reserveTimeoutMs,
  validateParameters:(operation,parameters,claims)=>{
   if(operation!=='apply'||claims.kind!=='runtime')return false;
   try{parsedApply(parameters);return true;}catch{return false;}
  },
 });
 return async function handle(request){
  let auth,parsed;
  try{
   auth=await verifier.authorize(readHttpRequest(request));
   ({parsed}=parsedApply(auth.parameters));
  }catch(error){
   const status=error instanceof AdmissionBridgeError?error.status:401;
   return response(status,status===503?'ADMISSION_UNAVAILABLE':'ADMISSION_REJECTED');
  }
  const base=admissionParameters(auth);
  try{
   const result=await admissionQuery(ADMISSION_SQL.apply,[
    ...base,auth.parameters.p_digest,JSON.stringify(auth.parameters.q),
   ]);
   const value=one(result,'result');
   const kind=canonicalResult(value,parsed.operation,parsed.chunkIndex);
   if(kind==='succeeded')return {status:200,body:{...value,automaticRetry:false}};
   if(kind==='business_failed')return response(409,'WRITE_FAILED');
  }catch{}
  try{
   const correlated=one(await admissionQuery(ADMISSION_SQL.correlate,base),'result');
   return recoveryResponse(correlated,parsed.operation,parsed.chunkIndex);
  }catch{
   return response(503,'ADMISSION_UNKNOWN');
  }
 };
}
