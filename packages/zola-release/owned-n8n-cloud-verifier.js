import {timingSafeEqual,createHash} from 'node:crypto';
export const cloudProofHash=v=>createHash('sha256').update(typeof v==='string'||Buffer.isBuffer(v)?v:JSON.stringify(v)).digest('hex');
export function createOwnedN8nCloudVerifier({plan,key,record,fence,now=Date.now,complete}){
 if(typeof key!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(key)||!/^[a-f0-9]{64}$/.test(plan.challenge??'')||plan.path!=='/__zola_credential_proof/'+plan.challenge||!Number.isFinite(Date.parse(plan.expiresAt)))throw Error('Cloud verifier input refused');
 const expected=Buffer.from(key);let consumed=false,requests=0;
 return async(req,res)=>{
  const reject=()=>{res.writeHead(404,{'content-type':'application/json','cache-control':'no-store'});res.end('{"ok":false}');};
  try{
   if(++requests>32||consumed||req.rawHeaders?.filter((v,i)=>i%2===0&&v.toLowerCase()==='x-buyer-writer-key').length!==1||now()>=Date.parse(plan.expiresAt)||req.method!=='GET'||req.url!==plan.path||req.headers.host!=='jarvis.blackspirehelix.com'||req.headers['transfer-encoding']!==undefined||req.headers['content-length']!==undefined&&req.headers['content-length']!=='0')return reject();
   const value=req.headers['x-buyer-writer-key'];if(typeof value!=='string')return reject();const given=Buffer.from(value);if(given.length!==expected.length||!timingSafeEqual(given,expected))return reject();
   consumed=true;await fence();if(now()>=Date.parse(plan.expiresAt))throw Error('Expired');
   const receipt={version:1,kind:'owned-n8n-cloud-authenticated',planDigest:cloudProofHash(plan),challenge:plan.challenge,receiptId:plan.receiptId,receivedAt:new Date(now()).toISOString(),authenticated:true};
   record(receipt);await fence();
   res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});
   res.end(JSON.stringify({version:1,status:'CREDENTIAL_POSSESSION_VERIFIED',challenge:plan.challenge,receiptId:plan.receiptId}),()=>{complete();});
  }catch{reject();complete();}
 };
}
export function renderOwnedN8nCloudProxy(before,plan){
 if(typeof before!=='string'||cloudProofHash(before)!==plan.proxyBeforeDigest||plan.path!=='/__zola_credential_proof/'+plan.challenge||!/^[a-f0-9]{64}$/.test(plan.challenge))throw Error('Cloud proxy source refused');
 if(before.includes('/__zola_credential_proof/'))throw Error('Existing proof route refused');
 const marker='    location ~ /\\. { deny all; }';if(before.split(marker).length!==2)throw Error('Cloud proxy layout refused');
 const location='    location = '+plan.path+' {\n        if ($request_method != GET) { return 404; }\n        if ($content_length != \"\") { return 404; }\n        if ($http_transfer_encoding != \"\") { return 404; }\n        access_log off;\n        error_log /dev/null crit;\n        proxy_pass http://127.0.0.1:18947;\n        proxy_set_header Host jarvis.blackspirehelix.com;\n        proxy_pass_request_body off;\n        proxy_set_header Content-Length "";\n        proxy_connect_timeout 2s;\n        proxy_read_timeout 30s;\n    }\n';
 return before.replace(marker,location+marker);
}

export async function restoreOwnedN8nCloudProxy({plan,before,candidate},{read,record,write,reconcileTemporary,test,reload,noListener}){
 const planDigest=cloudProofHash(plan);if(cloudProofHash(before)!==plan.proxyBeforeDigest||cloudProofHash(candidate)!==plan.proxyCandidateDigest)throw Error('Cleanup binding refused');
 noListener();record('cleanup-intent',{version:1,planDigest});const current=read();if(current!==before&&current!==candidate)throw Error('Foreign proxy bytes');
 reconcileTemporary([before,candidate]);if(current===candidate)write(candidate,before);test();reload();if(read()!==before)throw Error('Proxy restoration refused');noListener();
 const result={version:1,planDigest,proxyRestored:true,listenerClosed:true};record('cleanup-result',result);return result;
}

export const createOwnedN8nCloudVerifierAttempt2=options=>createNumberedOwnedN8nCloudVerifier(options,2);
export const createOwnedN8nCloudVerifierAttempt4=options=>createNumberedOwnedN8nCloudVerifier(options,4);
export const createOwnedN8nCloudVerifierAttempt3=options=>createNumberedOwnedN8nCloudVerifier(options,3);
function createNumberedOwnedN8nCloudVerifier({plan,key,record,rejectRecord,fence,now=Date.now,complete},attempt){
 if(plan.attempt!==attempt||typeof rejectRecord!=='function'||typeof key!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(key)||plan.path!=='/__zola_credential_proof/'+plan.challenge||!/^[a-f0-9]{64}$/.test(plan.challenge??''))throw Error('Attempt2 verifier refused');
 const expected=Buffer.from(key);let consumed=false;
 return async(req,res)=>{
  if(consumed){res.writeHead(404,{'content-type':'application/json','cache-control':'no-store'});res.end('{"ok":false}');return;}
  consumed=true;
  const reject=code=>{rejectRecord({version:1,kind:'owned-n8n-cloud-rejection',attempt,planDigest:cloudProofHash(plan),code,receivedAt:new Date(now()).toISOString()});res.writeHead(404,{'content-type':'application/json','cache-control':'no-store'});res.end('{"ok":false}',()=>complete());};
  try{
   if(now()>=Date.parse(plan.expiresAt))return reject('EXPIRED');
   if(req.method!=='GET')return reject('METHOD');if(req.url!==plan.path)return reject('PATH');if(req.headers.host!=='jarvis.blackspirehelix.com')return reject('HOST');
   if(req.headers['transfer-encoding']!==undefined||req.headers['content-length']!==undefined&&req.headers['content-length']!=='0')return reject('BODY');
   const count=req.rawHeaders?.filter((v,i)=>i%2===0&&v.toLowerCase()==='x-buyer-writer-key').length??0;
   if(count===0)return reject('AUTH_HEADER_MISSING');if(count!==1)return reject('AUTH_HEADER_DUPLICATE');
   const value=req.headers['x-buyer-writer-key'];if(typeof value!=='string')return reject('AUTH_HEADER_TYPE');
   const raw=Buffer.from(value),given=Buffer.alloc(expected.length);raw.copy(given,0,0,expected.length);const matches=timingSafeEqual(given,expected);
   if(raw.length!==expected.length)return reject('AUTH_LENGTH_MISMATCH');if(!matches)return reject('AUTH_VALUE_MISMATCH');
   await fence();if(now()>=Date.parse(plan.expiresAt))return reject('EXPIRED');
   record({version:1,kind:'owned-n8n-cloud-authenticated',planDigest:cloudProofHash(plan),challenge:plan.challenge,receiptId:plan.receiptId,receivedAt:new Date(now()).toISOString(),authenticated:true});
   await fence();if(now()>=Date.parse(plan.expiresAt))return reject('EXPIRED');
   res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({version:1,status:'CREDENTIAL_POSSESSION_VERIFIED',challenge:plan.challenge,receiptId:plan.receiptId}),()=>complete());
  }catch{try{reject('FENCE_OR_RECEIPT_FAILURE');}catch{res.destroy();complete();}}
 };
}

export async function boundedOwnedN8nCloudFence(operation,{timeoutMs=10000,now=()=>performance.now()}={}){
 const started=now();let timer;
 try{const value=await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Cloud fence timeout')),timeoutMs);})]);if(now()-started>=timeoutMs)throw Error('Cloud fence elapsed deadline');return value;}finally{clearTimeout(timer);}
}
