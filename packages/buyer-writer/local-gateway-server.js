import fs from 'node:fs';
import net from 'node:net';
import {captureBuyerJobVersion,validateBuyerJobRevision} from './criteria.js';
import {validateBuyerSourceContext} from './source-context.js';
import {parseWriterContext,parseWriterOperation,parseWriterReceipt} from './protocol.js';
import {BUYER_WRITER_DEFAULT_SOCKET,BUYER_WRITER_LOCAL_MAX_BYTES,BUYER_WRITER_LOCAL_TIMEOUT_MS,
  BuyerWriterLocalProtocolError,decodeLocalGatewayJson,validateLocalGatewayRequest} from './local-gateway-protocol.js';

const statements=Object.freeze({
  issue:'select buyer_writer.issue($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::timestamptz,$8::uuid) as result',
  cancel:'select buyer_writer.cancel($1,$2,$3) as result',
  reconcile:'select buyer_writer.reconcile($1,$2,$3,$4,$5::timestamptz) as result',
  context:'select buyer_writer.context($1,$2,$3,$4,$5) as result',
  apply:'select buyer_writer.apply($1,$2,$3::jsonb) as result',
  receipt:'select buyer_writer.receipt($1,$2,$3,$4,$5,$6,$7) as result',
});
const genericError=error=>error instanceof BuyerWriterLocalProtocolError?error.code:'GATEWAY_UNAVAILABLE';
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const rejectResult=()=>{throw new BuyerWriterLocalProtocolError('GATEWAY_UNAVAILABLE');};

function validateResult(operation,p,result){
  if(operation==='cancel'){if(result!==null&&result!==undefined)rejectResult();return null;}
  if(operation==='issue'){
    if(!exact(result,['dispatchId','generation'])||result.dispatchId!==p.requestId||!Number.isSafeInteger(result.generation)||result.generation<1)rejectResult();
  }else if(operation==='reconcile'){
    if(!exact(result,['dispatchId','generation','state'])||result.dispatchId!==p.requestId||!['absent','cancelled','completed','failed'].includes(result.state)
      ||(result.state==='absent'?result.generation!==null:!Number.isSafeInteger(result.generation)||result.generation<1))rejectResult();
  }else if(operation==='apply'){
    if(!exact(result,['ok','operation','chunkIndex'])||result.ok!==true||result.operation!==p.request.operation||result.chunkIndex!==p.request.chunkIndex)rejectResult();
  }else if(operation==='receipt'){
    if(!exact(result,['found','receipt'])||typeof result.found!=='boolean')rejectResult();
    if(result.found&&!(exact(result.receipt,['ok','operation','chunkIndex'])&&result.receipt.ok===true
      &&result.receipt.operation===p.request.operation&&result.receipt.chunkIndex===p.request.chunkIndex)
      &&!(exact(result.receipt,['ok','code'])&&result.receipt.ok===false&&result.receipt.code==='WRITE_FAILED'))rejectResult();
    if(!result.found&&result.receipt!==null)rejectResult();
  }else if(operation==='context'){
    if(!exact(result,['criteria','sourceContext','sourceContextDigest'])||typeof result.sourceContextDigest!=='string'||!/^[a-f0-9]{64}$/.test(result.sourceContextDigest))rejectResult();
    if(!exact(result.criteria,['state','county','property_type','date_range_start','date_range_end','min_purchases','cash_buyers_only','llc_buyers_only']))rejectResult();
    for(const field of ['state','county','property_type','date_range_start','date_range_end'])if(typeof result.criteria[field]!=='string'||result.criteria[field].length>128)rejectResult();
    if(result.criteria.min_purchases!==null&&(!Number.isSafeInteger(result.criteria.min_purchases)||result.criteria.min_purchases<1||result.criteria.min_purchases>5))rejectResult();
    for(const field of ['cash_buyers_only','llc_buyers_only'])if(result.criteria[field]!==null&&typeof result.criteria[field]!=='boolean')rejectResult();
    validateBuyerSourceContext(result.sourceContext);
  }
  return result;
}

function dispatcher({workspace,runtimeQuery,issuerQuery}) {
  return async request=>{
    const p=request.payload;
    if(request.operation==='issue'){
      const captured=captureBuyerJobVersion({...p.criteria,updated_at:p.updatedAt});
      const context=validateBuyerSourceContext(p.sourceContext);
      if(context.mode!=='frontend_payload'||context.rawPayload.byteCount>6*1024*1024)throw new BuyerWriterLocalProtocolError('PAYLOAD_REJECTED');
      const result=(await issuerQuery(statements.issue,[p.jobId,p.ownerId,workspace,p.permitDigest,JSON.stringify(context),
        JSON.stringify(captured.criteria),captured.updatedAt,p.requestId]))?.rows?.[0]?.result;
      return validateResult(request.operation,p,result);
    }
    if(request.operation==='cancel')return validateResult(request.operation,p,(await issuerQuery(statements.cancel,[p.jobId,p.ownerId,workspace]))?.rows?.[0]?.result);
    if(request.operation==='reconcile'){
      validateBuyerJobRevision(p.updatedAt);
      return validateResult(request.operation,p,(await issuerQuery(statements.reconcile,[p.jobId,p.ownerId,workspace,p.requestId,p.updatedAt]))?.rows?.[0]?.result);
    }
    if(request.operation==='context'){
      const q=parseWriterContext({jobId:p.jobId,body:Buffer.from(JSON.stringify({version:1,dispatchId:p.dispatchId,generation:p.generation}))});
      return validateResult(request.operation,p,(await runtimeQuery(statements.context,[p.permitDigest,workspace,q.jobId,q.dispatchId,q.generation]))?.rows?.[0]?.result);
    }
    if(request.operation==='apply'){
      const {payloadDigest:_,...q}=parseWriterOperation({jobId:p.jobId,body:Buffer.from(JSON.stringify(p.request))});
      return validateResult(request.operation,p,(await runtimeQuery(statements.apply,[p.permitDigest,workspace,JSON.stringify(q)]))?.rows?.[0]?.result);
    }
    const q=parseWriterReceipt({jobId:p.jobId,body:Buffer.from(JSON.stringify(p.request))});
    return validateResult(request.operation,p,(await runtimeQuery(statements.receipt,[p.permitDigest,workspace,q.jobId,q.dispatchId,q.generation,q.operation,q.chunkIndex]))?.rows?.[0]?.result);
  };
}

function verifySocketParent(socketPath,io,uid) {
  if(typeof socketPath!=='string'||socketPath!==BUYER_WRITER_DEFAULT_SOCKET&&!socketPath.startsWith('/tmp/'))throw new Error('Buyer writer gateway configuration rejected');
  const parent=new URL('.',`file://${socketPath}`).pathname.replace(/\/$/,'');
  const stat=io.lstatSync(parent);
  if(!stat.isDirectory()||stat.isSymbolicLink()||![0,uid].includes(stat.uid)||(stat.mode&0o0022)!==0)throw new Error('Buyer writer gateway socket directory rejected');
}

export function createBuyerWriterLocalGateway({socketPath=BUYER_WRITER_DEFAULT_SOCKET,capability,workspace,releaseSha,runtimeQuery,issuerQuery,
  timeoutMs=BUYER_WRITER_LOCAL_TIMEOUT_MS,maxConnections=32,io=fs,uid=process.getuid?.()??-1,now=Date.now,log=()=>{}}) {
  if(typeof runtimeQuery!=='function'||typeof issuerQuery!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30_000)throw new Error('Buyer writer gateway configuration rejected');
  verifySocketParent(socketPath,io,uid);
  const dispatch=dispatcher({workspace,runtimeQuery,issuerQuery});
  const nonces=new Map();let stopped=false,active=0,ready=false;
  const consumeNonce=(nonce,timestamp)=>{
    const cutoff=now()-30_000;for(const [key,value] of nonces)if(value<cutoff)nonces.delete(key);
    if(nonces.has(nonce))return false;nonces.set(nonce,timestamp);return true;
  };
  const server=net.createServer(socket=>{
    if(stopped||active>=maxConnections)return socket.destroy();
    active++;let bytes=0,settled=false,processed=false;const chunks=[];
    socket.setTimeout(timeoutMs,()=>socket.destroy());
    const finish=()=>{if(!settled){settled=true;active--;}};
    socket.once('close',finish);socket.once('error',()=>{});
    socket.on('data',chunk=>{
      if(processed)return;
      bytes+=chunk.length;if(bytes>BUYER_WRITER_LOCAL_MAX_BYTES+1){processed=true;socket.end(JSON.stringify({version:1,requestId:null,ok:false,code:'PAYLOAD_TOO_LARGE'})+'\n');return;}
      chunks.push(chunk);
      const data=Buffer.concat(chunks,bytes),newline=data.indexOf(0x0a);
      if(newline<0)return;
      processed=true;
      socket.pause();
      const trailing=data.subarray(newline+1);let parsed,requestId=null,operation=null,started=now();
      Promise.resolve().then(async()=>{
        if(trailing.some(byte=>![0x09,0x0d,0x20].includes(byte)))throw new BuyerWriterLocalProtocolError('MALFORMED_JSON');
        parsed=decodeLocalGatewayJson(data.subarray(0,newline));requestId=parsed?.requestId??null;operation=parsed?.operation??null;
        const request=validateLocalGatewayRequest(parsed,{capability,workspace,releaseSha,now,consumeNonce});
        const result=await dispatch(request);
        socket.end(JSON.stringify({version:1,requestId,ok:true,result:result??null})+'\n');
        log({requestId,operation,outcome:'settled',durationMs:Math.max(0,now()-started)});
      }).catch(error=>{
        socket.end(JSON.stringify({version:1,requestId,ok:false,code:genericError(error)})+'\n');
        log({requestId,operation,outcome:'rejected',durationMs:Math.max(0,now()-started)});
      });
    });
  });
  server.maxConnections=maxConnections;
  const listen=()=>new Promise((resolve,reject)=>{
    try{const prior=io.lstatSync(socketPath);if(!prior.isSocket()||prior.uid!==uid)throw new Error();io.unlinkSync(socketPath);}catch(error){if(error?.code!=='ENOENT')return reject(new Error('Buyer writer gateway stale socket rejected'));}
    server.once('error',reject);server.listen(socketPath,()=>{
      try{io.chmodSync(socketPath,0o660);ready=true;server.off('error',reject);resolve();}catch(error){server.close();reject(error);}
    });
  });
  const close=()=>new Promise(resolve=>{stopped=true;ready=false;server.close(()=>{try{io.unlinkSync(socketPath);}catch(error){if(error?.code!=='ENOENT')log({outcome:'cleanup_failed'});}resolve();});});
  return Object.freeze({listen,close,isReady:()=>ready&&!stopped&&server.listening,isDrained:()=>active===0,address:()=>server.address()});
}

export {statements as BUYER_WRITER_LOCAL_STATEMENTS};
