import crypto from 'node:crypto';
export const now = () => new Date().toISOString();
export const id = (p='id') => `${p}_${crypto.randomBytes(8).toString('hex')}`;
export function json(res, status, body){ res.writeHead(status, {'content-type':'application/json','x-content-type-options':'nosniff'}); res.end(JSON.stringify(body)); }
export function readJson(req){ return new Promise((resolve,reject)=>{let b=''; req.on('data',c=>{b+=c; if(b.length>1_000_000) reject(new Error('payload too large'));}); req.on('end',()=>{try{resolve(b?JSON.parse(b):{});}catch(e){reject(e);}});}); }
export function redact(s=''){ return String(s)
  .replace(/(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{8,}|\b\d{9,}:AA[A-Za-z0-9_-]+)/g,'[REDACTED]')
  .replace(/(api[_ -]?key|token|password|secret)(["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi,'$1$2[REDACTED]'); }
export function escapeMarkdown(s=''){ return String(s).replace(/[_*`\[\]()~>#+\-=|{}.!]/g, '\\$&'); }
