import { parseWriterOperation, WriterProtocolError } from './protocol.js';
import {canonicalBuyerSaleDate} from './dates.js';

const fields=['buyer_name','seller_name','property_address','mailing_address','sale_price',
  'sale_date','property_type','parcel_id','deed_type','lender_name'];
const reject=()=>{throw new WriterProtocolError(400);};

// Build the complete bounded sequence before sending any operation. A separately
// authenticated start claim precedes this plan. No network or credential input.
export function planBuyerWrites({jobId,dispatchId,generation,criteria,raw,clean}) {
  if(!Array.isArray(raw)||!Array.isArray(clean)||raw.length>50000||clean.length>50000) reject();
  if(!criteria||typeof criteria.property_type!=='string'||criteria.property_type.length>128)reject();
  for(const field of ['date_range_start','date_range_end']) {
    if(typeof criteria[field]!=='string'||canonicalBuyerSaleDate(criteria[field])!==criteria[field])reject();
  }
  if(criteria.date_range_start>criteria.date_range_end)reject();
  const propertyType=criteria.property_type.toLowerCase();
  const envelope=(operation,payload,chunkIndex=0,chunkCount=1)=>({
    version:1,dispatchId,generation,operation,chunkIndex,chunkCount,payload,
  });
  const snapshot=(value)=>{
    const text=JSON.stringify(value,(_key,item)=>{
      if(typeof item==='number'&&!Number.isFinite(item))reject();
      return item;
    });
    const {jobId:_job,payloadDigest:_hash,...parsed}=parseWriterOperation({jobId,body:Buffer.from(text)});
    return parsed;
  };
  const rawKeys=new Set();
  const eligibleKeys=new Set();
  const plan=[];let totalBytes=0;
  const append=(value)=>{
    // JSONB adds spaces and a job field at the database boundary. Reserve more
    // than that overhead, so chunks fitting HTTP also fit PostgreSQL's limit.
    // PostgreSQL expands exponent-form subnormal numbers into decimal text.
    // 512/row also covers the maximum finite allowed price expansion and spaces.
    const bytes=Buffer.byteLength(JSON.stringify(value))+1024+(value.payload.rows?.length??0)*512;
    totalBytes+=bytes;
    if(bytes>262144||totalBytes>64*1024*1024)throw new WriterProtocolError(413);
    plan.push(snapshot(value));
  };
  for(const [kind,rows] of [['raw',raw],['clean',clean]]) {
    const chunks=[];let chunk=[];let chunkBytes=1024;const seen=new Set();
    for(const candidate of rows) {
      const row=snapshot(envelope(`${kind}.append`,{rows:[candidate]})).payload.rows[0];
      if(!row.buyer_name?.trim()) reject();
      const key=JSON.stringify(fields.map(field=>row[field]));
      if(seen.has(key)||(kind==='clean'&&(!rawKeys.has(key)||!eligibleKeys.has(key)))) reject();
      seen.add(key);if(kind==='raw')rawKeys.add(key);
      if(kind==='raw'&&row.sale_date!==null&&row.sale_date>=criteria.date_range_start&&row.sale_date<=criteria.date_range_end
        &&(!propertyType||propertyType==='all'||row.property_type?.includes(propertyType)))eligibleKeys.add(key);
      const bytes=Buffer.byteLength(JSON.stringify(row))+512;
      if(chunk.length&&(chunk.length===100||chunkBytes+bytes>260000)) {
        chunks.push(chunk);chunk=[];chunkBytes=1024;
      }
      chunk.push(row);chunkBytes+=bytes;
    }
    if(kind==='clean'&&seen.size!==eligibleKeys.size)reject();
    if(chunk.length)chunks.push(chunk);
    if(chunks.length>500)throw new WriterProtocolError(413);
    for(let i=0;i<chunks.length;i++)append(envelope(`${kind}.append`,{rows:chunks[i]},i,chunks.length));
  }
  append(envelope('buyers.commit',{}));
  append(envelope('complete',{}));
  return plan;
}
