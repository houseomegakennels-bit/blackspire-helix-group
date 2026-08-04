import crypto from 'node:crypto';
export const now = () => new Date().toISOString();
export const id = (p='id') => `${p}_${crypto.randomBytes(8).toString('hex')}`;
export function json(res, status, body){ res.writeHead(status, {'content-type':'application/json','x-content-type-options':'nosniff'}); res.end(JSON.stringify(body)); }
export function readJson(req, { maxBytes = 1_000_000 } = {}) { return new Promise((resolve,reject)=>{
  let body=''; let bytes=0; let settled=false;
  const fail=(error)=>{ if(settled)return; settled=true; reject(error); };
  req.on('data',(chunk)=>{
    if(settled)return;
    bytes+=Buffer.byteLength(chunk);
    if(bytes>maxBytes){const error=new Error('payload too large');error.code='PAYLOAD_TOO_LARGE';fail(error);req.resume?.();return;}
    body+=chunk;
  });
  req.on('end',()=>{if(settled)return;settled=true;try{resolve(body?JSON.parse(body):{});}catch(error){error.code='INVALID_JSON';reject(error);}});
  req.on('error',fail);
  req.on('aborted',()=>{const error=new Error('request aborted');error.code='REQUEST_ABORTED';fail(error);});
}); }
export function redact(s=''){ return String(s)
  .replace(/(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|\b\d{9,}:AA[A-Za-z0-9_-]+)/g,'[REDACTED]')
  .replace(/(api[_ -]?key|token|password|secret)(["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi,'$1$2[REDACTED]'); }
export function escapeMarkdown(s=''){ return String(s).replace(/[_*`\[\]()~>#+\-=|{}.!]/g, '\\$&'); }
