import {createHmac,timingSafeEqual} from 'node:crypto';

export const BUYER_WRITER_DEFAULT_SOCKET='/run/blackspire/buyer-writer.sock';
export const BUYER_WRITER_LOCAL_MAX_BYTES=384*1024;
export const BUYER_WRITER_LOCAL_TIMEOUT_MS=15_000;
export const BUYER_WRITER_LOCAL_OPERATIONS=Object.freeze(['ready','issue','cancel','reconcile','context','apply','receipt','admit']);

const forbidden=new Set(['sql','query','schema','function','procedure','rpc','url','endpoint','method','host','port','database','username','password']);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const opaque=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43}$/.test(value);
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));

export class BuyerWriterLocalProtocolError extends Error {
  constructor(code='REQUEST_REJECTED') {super('Buyer writer local gateway request rejected');this.name='BuyerWriterLocalProtocolError';this.code=code;}
}
const reject=code=>{throw new BuyerWriterLocalProtocolError(code);};

export function canonicalLocalGatewayJson(value) {
  if(Array.isArray(value))return `[${value.map(canonicalLocalGatewayJson).join(',')}]`;
  if(value!==null&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonicalLocalGatewayJson(value[key])}`).join(',')}}`;
  const encoded=JSON.stringify(value);if(encoded===undefined)reject('REQUEST_REJECTED');return encoded;
}

// JSON.parse silently accepts duplicate object keys. Scan the bounded input first
// so an authenticated request has one unambiguous representation.
function rejectDuplicateKeys(text) {
  const stack=[];let string=false,escaped=false,token='',isKey=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(string){
      // Preserve escapes verbatim so JSON.parse below compares decoded key
      // values. Dropping the escaped character lets `"key"` and an escaped
      // spelling of the same key acquire different scanner representations.
      if(escaped){token+=c;escaped=false;continue;}
      if(c==='\\'){token+=c;escaped=true;continue;}
      if(c==='"'){
        string=false;
        if(isKey){let decoded;try{decoded=JSON.parse(`"${token}"`);}catch{reject('MALFORMED_JSON');}
          const frame=stack.at(-1);if(!frame||frame.type!=='object'||frame.keys.has(decoded))reject('MALFORMED_JSON');frame.keys.add(decoded);
        }
        continue;
      }
      token+=c;continue;
    }
    if(c==='"'){
      let j=i-1;while(j>=0&&/\s/.test(text[j]))j--;
      const frame=stack.at(-1);isKey=frame?.type==='object'&&(text[j]==='{'||text[j]===',');
      string=true;escaped=false;token='';continue;
    }
    if(c==='{')stack.push({type:'object',keys:new Set()});
    else if(c==='[')stack.push({type:'array'});
    else if(c==='}'||c===']')stack.pop();
  }
  if(string||stack.length)reject('MALFORMED_JSON');
}

function rejectForbidden(value) {
  if(typeof value==='string'){
    if(/(?:\bpg_net\b|\bnet\s*\.\s*http_[a-z0-9_]*\b|\b[a-z][a-z0-9+.-]*\s*:\/\/)/iu.test(value))reject('FORBIDDEN_INPUT');
    return;
  }
  if(!value||typeof value!=='object')return;
  for(const [key,child] of Object.entries(value)){
    if(forbidden.has(key.toLowerCase()))reject('FORBIDDEN_KEY');
    rejectForbidden(child);
  }
}

export function decodeLocalGatewayJson(bytes) {
  if(!Buffer.isBuffer(bytes)||bytes.length<2||bytes.length>BUYER_WRITER_LOCAL_MAX_BYTES)reject(bytes?.length>BUYER_WRITER_LOCAL_MAX_BYTES?'PAYLOAD_TOO_LARGE':'MALFORMED_JSON');
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{reject('MALFORMED_JSON');}
  rejectDuplicateKeys(text);
  let value;try{value=JSON.parse(text);}catch{reject('MALFORMED_JSON');}
  if(value?.operation!=='admit')rejectForbidden(value);return value;
}

function validateBinding(value,operation,expected) {
  const keys=['releaseSha','operationId','attemptId','inputDigest','checkOutputDigest','workspace','principal','dispatchId','generation','mutation'];
  if(!exact(value,keys)||value.releaseSha!==expected.releaseSha||value.workspace!==expected.workspace
    ||value.operationId!==expected.operationId||value.attemptId!==expected.attemptId
    ||!uuid(value.operationId)||!uuid(value.attemptId)||!digest(value.inputDigest)||!digest(value.checkOutputDigest)
    ||typeof value.principal!=='string'||!/^[A-Za-z0-9._:@-]{1,128}$/.test(value.principal)
    ||(value.dispatchId!==null&&!uuid(value.dispatchId))||(value.generation!==null&&!integer(value.generation,1,Number.MAX_SAFE_INTEGER))
    ||!exact(value.mutation,['operation','dispatchId','generation'])||value.mutation.operation!==operation
    ||value.mutation.dispatchId!==value.dispatchId||value.mutation.generation!==value.generation)reject('BINDING_REJECTED');
  return value;
}

const payloadKeys={ready:[],issue:['jobId','ownerId','requestId','criteria','updatedAt','sourceContext','permitDigest'],cancel:['jobId','ownerId'],
  reconcile:['jobId','ownerId','requestId','updatedAt'],context:['permitDigest','jobId','dispatchId','generation'],
  apply:['permitDigest','jobId','request'],receipt:['permitDigest','jobId','request'],
  admit:['origin','method','path','rawHeaders','body']};

function validatePayload(operation,value,binding) {
  if(!exact(value,payloadKeys[operation]))reject('PAYLOAD_REJECTED');
  if(['issue','cancel','reconcile'].includes(operation)){
    if(!uuid(value.jobId)||!uuid(value.ownerId)||binding.principal!==value.ownerId)reject('PAYLOAD_REJECTED');
  }
  if(operation==='issue'){
    if(!uuid(value.requestId)||!digest(value.permitDigest)||binding.dispatchId!==value.requestId
      ||!exact(value.criteria,['state','county','property_type','date_range_start','date_range_end','min_purchases','cash_buyers_only','llc_buyers_only']))reject('PAYLOAD_REJECTED');
  }else if(operation==='reconcile'){
    if(!uuid(value.requestId)||binding.dispatchId!==value.requestId)reject('PAYLOAD_REJECTED');
  }else if(operation==='context'){
    if(!digest(value.permitDigest)||!uuid(value.jobId)||!uuid(value.dispatchId)||!integer(value.generation,1,Number.MAX_SAFE_INTEGER)
      ||binding.dispatchId!==value.dispatchId||binding.generation!==value.generation)reject('PAYLOAD_REJECTED');
  }else if(operation==='apply'||operation==='receipt'){
    if(!digest(value.permitDigest)||!uuid(value.jobId)||!Buffer.from(JSON.stringify(value.request)).length)reject('PAYLOAD_REJECTED');
    if(value.request?.dispatchId!==binding.dispatchId||value.request?.generation!==binding.generation)reject('PAYLOAD_REJECTED');
  }else if(operation==='admit'){
    if(binding.principal!=='buyer-writer-runtime'||binding.dispatchId!==null||binding.generation!==null
      ||typeof value.origin!=='string'||value.origin.length>512||value.method!=='POST'
      ||!/^\/rest\/v1\/rpc\/(?:issue|cancel|reconcile|apply|receipt|recover)$/.test(value.path)
      ||!Array.isArray(value.rawHeaders)||value.rawHeaders.length>200||value.rawHeaders.length%2
      ||value.rawHeaders.some(item=>typeof item!=='string')||typeof value.body!=='string'
      ||value.body.length<3||value.body.length>87384||!/^[A-Za-z0-9_-]+$/.test(value.body))reject('PAYLOAD_REJECTED');
    let bytes;try{bytes=Buffer.from(value.body,'base64url');}catch{reject('PAYLOAD_REJECTED');}
    if(bytes.length<2||bytes.length>65536||bytes.toString('base64url')!==value.body)reject('PAYLOAD_REJECTED');
    let headerBytes=0;for(const item of value.rawHeaders){headerBytes+=Buffer.byteLength(item);if(headerBytes>32768)reject('PAYLOAD_REJECTED');}
  }
  return value;
}

function signingValue(request) {return {...request,auth:{timestamp:request.auth.timestamp,nonce:request.auth.nonce}};}
export function signLocalGatewayRequest(request,capability) {
  if(!opaque(capability)||!request||typeof request!=='object')reject('AUTH_REJECTED');
  return createHmac('sha256',Buffer.from(capability,'base64url')).update(canonicalLocalGatewayJson(signingValue(request))).digest('hex');
}

export function validateLocalGatewayRequest(value,{capability,authority,now=Date.now,consumeNonce=()=>true}={}) {
  if(!opaque(capability)||!exact(authority,['releaseSha','operationId','attemptId','workspace','gatewayIdentity'])
    ||!/^[a-f0-9]{40}$/.test(authority.releaseSha??'')||!uuid(authority.operationId)||!uuid(authority.attemptId)
    ||typeof authority.workspace!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(authority.workspace)
    ||authority.gatewayIdentity!=='blackspire-writer')reject('GATEWAY_UNAVAILABLE');
  if(!exact(value,['version','requestId','operation','binding','payload','auth'])||value.version!==1||!uuid(value.requestId)
    ||!BUYER_WRITER_LOCAL_OPERATIONS.includes(value.operation)||!exact(value.auth,['timestamp','nonce','mac'])
    ||!integer(value.auth.timestamp,0,Number.MAX_SAFE_INTEGER)||Math.abs(now()-value.auth.timestamp)>30_000
    ||typeof value.auth.nonce!=='string'||!/^[a-f0-9]{32}$/.test(value.auth.nonce)||!digest(value.auth.mac))reject('AUTH_REJECTED');
  const expected=signLocalGatewayRequest(value,capability);
  if(!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(value.auth.mac,'hex'))||consumeNonce(value.auth.nonce,value.auth.timestamp)!==true)reject('AUTH_REJECTED');
  const binding=validateBinding(value.binding,value.operation,authority);
  validatePayload(value.operation,value.payload,binding);return value;
}
