import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { captureBuyerJobVersion, validateBuyerJobRevision } from './criteria.js';
import { validateBuyerSourceContext } from './source-context.js';
import { WriterProtocolError } from './protocol.js';

const opaque=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const reject=status=>{throw new WriterProtocolError(status);};
const exact=(value,keys)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))reject(400);
};
export function authenticateBuyerIssuer(rawHeaders,credential) {
  if(!opaque(credential))reject(503);
  if(!Array.isArray(rawHeaders)||rawHeaders.length>200||rawHeaders.length%2)reject(401);
  let supplied,bytes=0;
  for(let i=0;i<rawHeaders.length;i+=2) {
    if(typeof rawHeaders[i]!=='string'||typeof rawHeaders[i+1]!=='string')reject(401);
    bytes+=Buffer.byteLength(rawHeaders[i])+Buffer.byteLength(rawHeaders[i+1]);if(bytes>32768)reject(401);
    if(rawHeaders[i].toLowerCase()==='x-buyer-issuer-key') {
      if(supplied!==undefined)reject(401);supplied=rawHeaders[i+1];
    }
  }
  if(!opaque(supplied)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(credential)))reject(401);
}

// Trusted frontend service boundary, never browser authentication. The caller
// must capture/revalidate the actual route guard principal and send the ORIGINAL
// acquisition snapshot. This dedicated query connection can only issue/cancel;
// never substitute the runtime or an administrator pool. No environment is read.
// SQL timeouts are unknown outcomes: no retry, permit disclosure or false success.
export function createBuyerIssuer({credential,workspace,query}) {
  if(!opaque(credential)||typeof workspace!=='string'||workspace.length<1||workspace.length>128||typeof query!=='function')
    throw new TypeError('Buyer issuer configuration unavailable');
  return async({rawHeaders,body,jobId})=>{
    try {
      authenticateBuyerIssuer(rawHeaders,credential);
      if(!uuid(jobId)||!Buffer.isBuffer(body))reject(400);if(body.length>65536)reject(413);
      let request;
      try{request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}catch{reject(400);}
      exact(request,['version','ownerId','requestId','criteria','updatedAt','sourceContext']);
      if(request.version!==1||!uuid(request.ownerId)||!uuid(request.requestId))reject(400);
      exact(request.criteria,['state','county','property_type','date_range_start','date_range_end','min_purchases','cash_buyers_only','llc_buyers_only']);
      let captured,context;
      try {
        captured=captureBuyerJobVersion({...request.criteria,updated_at:request.updatedAt});
        context=validateBuyerSourceContext(request.sourceContext);
      }catch{reject(400);}
      if(context.mode!=='frontend_payload'||context.rawPayload.byteCount>6*1024*1024)reject(400);
      const permit=randomBytes(32).toString('base64url');
      const digest=createHash('sha256').update(permit).digest('hex');
      const result=await query('select buyer_writer.issue($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::timestamptz,$8::uuid) as result',[
        jobId,request.ownerId,workspace,digest,JSON.stringify(context),JSON.stringify(captured.criteria),captured.updatedAt,request.requestId,
      ]);
      const issued=result?.rows?.length===1?result.rows[0]?.result:null;
      if(!issued||Object.keys(issued).sort().join(',')!=='dispatchId,generation'||issued.dispatchId!==request.requestId
        ||!Number.isSafeInteger(issued.generation)||issued.generation<1)reject(503);
      return{status:200,body:{version:1,jobId,dispatchId:issued.dispatchId,generation:issued.generation,permit}};
    }catch(error) {
      const status=error instanceof WriterProtocolError?error.status:({'42501':403,'23505':409,'22023':400,'22P02':400,'22008':400}[error?.code]??503);
      return{status,body:{ok:false,code:status===503?'ISSUER_UNAVAILABLE':'ISSUER_REJECTED'}};
    }
  };
}

// Reconciliation is an absorbing cancellation of this attempt, never a retry or
// permit recovery. The trusted caller retains requestId and original revision
// before sending issuance, including when no response was received.
export function createBuyerReconciler({credential,workspace,query}) {
  if(!opaque(credential)||typeof workspace!=='string'||workspace.length<1||workspace.length>128||typeof query!=='function')
    throw new TypeError('Buyer issuer configuration unavailable');
  return async({rawHeaders,body,jobId})=>{
    try {
      authenticateBuyerIssuer(rawHeaders,credential);
      if(!uuid(jobId)||!Buffer.isBuffer(body))reject(400);if(body.length>8192)reject(413);
      let request;
      try{request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}catch{reject(400);}
      exact(request,['version','ownerId','requestId','updatedAt']);
      if(request.version!==1||!uuid(request.ownerId)||!uuid(request.requestId))reject(400);
      try{validateBuyerJobRevision(request.updatedAt);}catch{reject(400);}
      const result=await query('select buyer_writer.reconcile($1,$2,$3,$4,$5::timestamptz) as result',[
        jobId,request.ownerId,workspace,request.requestId,request.updatedAt,
      ]);
      const reconciled=result?.rows?.length===1?result.rows[0]?.result:null;
      if(!reconciled||Object.keys(reconciled).sort().join(',')!=='dispatchId,generation,state'
        ||reconciled.dispatchId!==request.requestId
        ||!['absent','cancelled','completed','failed'].includes(reconciled.state)
        ||(reconciled.state==='absent'?reconciled.generation!==null:!Number.isSafeInteger(reconciled.generation)||reconciled.generation<1))reject(503);
      return{status:200,body:reconciled};
    }catch(error) {
      const status=error instanceof WriterProtocolError?error.status:({'42501':403,'22023':400,'22P02':400,'22008':400}[error?.code]??503);
      return{status,body:{ok:false,code:status===503?'ISSUER_UNAVAILABLE':'ISSUER_REJECTED'}};
    }
  };
}
