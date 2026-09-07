import { createHash, timingSafeEqual } from 'node:crypto';
import { WriterProtocolError } from './protocol.js';

const reject=()=>{throw new WriterProtocolError(400);};
const exact=(value,keys)=>{
  if(!value||typeof value!=='object'||Array.isArray(value)
    ||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))reject();
};
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const hash=(value)=>createHash('sha256').update(value).digest('hex');
const digest=(value)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

// Structural validation is not source approval. Only the trusted issuer may
// construct this snapshot from its canonical rows and reviewed endpoint policy.
export function validateBuyerSourceContext(c) {
  exact(c,['version','mode','sources','budgets','rawPayload']);
  if(c.version!==1||!['county_fetch','frontend_payload'].includes(c.mode)
    ||!Array.isArray(c.sources)||c.sources.length<1||c.sources.length>32)reject();
  const ids=new Set();
  for(const s of c.sources) {
    exact(s,['sourceId','sourceType','endpointId','endpointConfigDigest','cashDisabled']);
    if(typeof s.sourceId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(s.sourceId)
      ||ids.has(s.sourceId)||typeof s.cashDisabled!=='boolean'||!digest(s.endpointConfigDigest))reject();
    ids.add(s.sourceId);
    for(const field of ['sourceType','endpointId'])if(typeof s[field]!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(s[field]))reject();
  }
  const b=c.budgets;
  exact(b,['maxRequests','maxRows','maxBytes']);
  if(!integer(b.maxRequests,1,500)||!integer(b.maxRows,1,50000)||!integer(b.maxBytes,1,67108864))reject();
  if(c.mode==='county_fetch') {if(c.rawPayload!==null)reject();}
  else {
    exact(c.rawPayload,['digest','rowCount','byteCount']);
    if(!digest(c.rawPayload.digest)||!integer(c.rawPayload.rowCount,0,b.maxRows)
      ||!integer(c.rawPayload.byteCount,1,b.maxBytes))reject();
  }
  // Reserve JSONB formatting overhead; database independently caps at 32KiB.
  if(Buffer.byteLength(JSON.stringify(c))+2048>32768)reject();
  return structuredClone(c);
}

// The digest binds EXACT UTF-8 bytes of a JSON array, not a reserialized object
// or the later normalized sales. Keep these bytes unchanged through transport.
export function verifyBuyerRawPayload(context,bytes) {
  const c=validateBuyerSourceContext(context);
  if(c.mode!=='frontend_payload'||!Buffer.isBuffer(bytes)||bytes.length!==c.rawPayload.byteCount
    ||bytes.length>c.budgets.maxBytes)reject();
  if(!timingSafeEqual(Buffer.from(hash(bytes),'hex'),Buffer.from(c.rawPayload.digest,'hex')))reject();
  let rows;
  try {rows=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{reject();}
  if(!Array.isArray(rows)||rows.length!==c.rawPayload.rowCount
    ||rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))reject();
  return rows;
}
