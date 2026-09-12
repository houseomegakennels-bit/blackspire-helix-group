import { authenticateWriter, parseWriterOperation, parseWriterReceipt, parseWriterContext, WriterProtocolError } from './protocol.js';
import { validateBuyerSourceContext } from './source-context.js';

const errorStatus = new Map([
  ['42501',403], ['23505',409], ['22023',400], ['22P02',400], ['22003',400], ['22008',400], ['54000',413],
]);
const rejected = (status) => ({ status, body: { ok:false, code:status===503?'WRITER_UNAVAILABLE':'WRITER_REJECTED' } });

function credentialHeaders(rawHeaders) {
  if (!Array.isArray(rawHeaders) || rawHeaders.length>200 || rawHeaders.length%2) throw new WriterProtocolError(401);
  const headers = Object.create(null);
  let bytes=0;
  for(let i=0;i<rawHeaders.length;i+=2) {
    if(typeof rawHeaders[i]!=='string' || typeof rawHeaders[i+1]!=='string') throw new WriterProtocolError(401);
    bytes+=Buffer.byteLength(rawHeaders[i])+Buffer.byteLength(rawHeaders[i+1]);
    if(bytes>32768) throw new WriterProtocolError(401);
    const key=rawHeaders[i].toLowerCase();
    if(key==='x-buyer-writer-key' || key==='x-buyer-job-permit') {
      if(Object.hasOwn(headers,key)) throw new WriterProtocolError(401);
      headers[key]=rawHeaders[i+1];
    }
  }
  return headers;
}

export function authenticateWriterRequest(rawHeaders,credential) {
  return authenticateWriter({headers:credentialHeaders(rawHeaders),expectedCredential:credential});
}

// Deployment supplies an explicitly configured dedicated runtime connection.
// query must use a single autocommit statement with bounded server-side statement
// and lock timeouts. Never provide an admin pool or wrap calls in an uncommitted
// outer transaction. No environment files, credentials or listeners are loaded.
// A timeout is an unknown outcome: inspect the scoped receipt; never auto-retry.
export function createWriterGateway({credential,workspace,query}) {
  if(typeof workspace!=='string' || !workspace.length || workspace.length>128 || typeof query!=='function') {
    throw new TypeError('Buyer writer configuration unavailable');
  }
  return async function handle({rawHeaders,body,jobId}) {
    try {
      const {permitDigest}=authenticateWriterRequest(rawHeaders,credential);
      const {payloadDigest: _localDigest,...operation}=parseWriterOperation({jobId,body});
      // SQL hashes its typed JSONB value itself. The local protocol digest is not
      // passed as authority and cannot override the authoritative receipt digest.
      const result=await query('select buyer_writer.apply($1,$2,$3::jsonb) as result',[
        permitDigest,workspace,JSON.stringify(operation),
      ]);
      const receipt=result?.rows?.length===1?result.rows[0]?.result:null;
      if(!receipt || receipt.ok!==true || receipt.operation!==operation.operation
          || receipt.chunkIndex!==operation.chunkIndex
          || Object.keys(receipt).sort().join(',')!=='chunkIndex,ok,operation') return rejected(503);
      return {status:200,body:receipt};
    } catch(error) {
      if(error instanceof WriterProtocolError) return rejected(error.status);
      return rejected(errorStatus.get(error?.code) ?? 503);
    }
  };
}

export function createWriterReceiptGateway({credential,workspace,query}) {
  if(typeof workspace!=='string'||!workspace.length||workspace.length>128||typeof query!=='function') {
    throw new TypeError('Buyer writer configuration unavailable');
  }
  return async function handle({rawHeaders,body,jobId}) {
    try {
      const {permitDigest}=authenticateWriterRequest(rawHeaders,credential);
      const q=parseWriterReceipt({jobId,body});
      const result=await query('select buyer_writer.receipt($1,$2,$3,$4,$5,$6,$7) as result',[
        permitDigest,workspace,q.jobId,q.dispatchId,q.generation,q.operation,q.chunkIndex,
      ]);
      const value=result?.rows?.length===1?result.rows[0]?.result:null;
      if(!value||Object.keys(value).sort().join(',')!=='found,receipt'||typeof value.found!=='boolean') return rejected(503);
      if(!value.found) return value.receipt===null?{status:200,body:value}:rejected(503);
      const receipt=value.receipt;
      const success=receipt?.ok===true&&receipt.operation===q.operation&&receipt.chunkIndex===q.chunkIndex
        &&Object.keys(receipt).sort().join(',')==='chunkIndex,ok,operation';
      const failure=receipt?.ok===false&&receipt.code==='WRITE_FAILED'&&Object.keys(receipt).sort().join(',')==='code,ok';
      if(!success&&!failure) return rejected(503);
      return {status:200,body:value};
    } catch(error) {
      if(error instanceof WriterProtocolError) return rejected(error.status);
      return rejected(errorStatus.get(error?.code)??503);
    }
  };
}

export function createWriterContextGateway({credential,workspace,query}) {
  if(typeof workspace!=='string'||!workspace.length||workspace.length>128||typeof query!=='function') {
    throw new TypeError('Buyer writer configuration unavailable');
  }
  return async function handle({rawHeaders,body,jobId}) {
    try {
      const {permitDigest}=authenticateWriterRequest(rawHeaders,credential);
      const q=parseWriterContext({jobId,body});
      const result=await query('select buyer_writer.context($1,$2,$3,$4,$5) as result',[
        permitDigest,workspace,q.jobId,q.dispatchId,q.generation,
      ]);
      const value=result?.rows?.length===1?result.rows[0]?.result:null;
      if(!value||Object.keys(value).sort().join(',')!=='criteria,sourceContext,sourceContextDigest'
        ||typeof value.sourceContextDigest!=='string'||!/^[a-f0-9]{64}$/.test(value.sourceContextDigest))return rejected(503);
      const c=value.criteria;
      // Return only the canonical, non-secret criteria projection from SQL.
      if(!c||Object.keys(c).sort().join(',')!=='cash_buyers_only,county,date_range_end,date_range_start,llc_buyers_only,min_purchases,property_type,state')return rejected(503);
      for(const field of ['state','county','property_type','date_range_start','date_range_end']) {
        if(typeof c[field]!=='string'||c[field].length>128)return rejected(503);
      }
      if(c.min_purchases!==null&&(!Number.isSafeInteger(c.min_purchases)||c.min_purchases<1||c.min_purchases>5))return rejected(503);
      for(const field of ['cash_buyers_only','llc_buyers_only'])if(c[field]!==null&&typeof c[field]!=='boolean')return rejected(503);
      try {validateBuyerSourceContext(value.sourceContext);}catch{return rejected(503);}
      return {status:200,body:value};
    }catch(error) {
      if(error instanceof WriterProtocolError)return rejected(error.status);
      return rejected(errorStatus.get(error?.code)??503);
    }
  };
}
