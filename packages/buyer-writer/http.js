import http from 'node:http';
import { authenticateWriterRequest, createWriterGateway, createWriterReceiptGateway, createWriterContextGateway } from './gateway.js';
import { WriterProtocolError } from './protocol.js';
import { authenticateBuyerIssuer, createBuyerIssuer, createBuyerReconciler } from './issuer.js';

// Explicit composition only: the caller owns the dedicated database connection,
// listener binding, TLS ingress and authoritative availability/stop observation.
// No production configuration or credential file is loaded by this module.
export function createBuyerWriterRequestHandler({credential,workspace,query,isAvailable,isPrepared,issuer}) {
  if(typeof isAvailable!=='function') throw new TypeError('Buyer writer availability check required');
  const operations=createWriterGateway({credential,workspace,query});
  const receipts=createWriterReceiptGateway({credential,workspace,query});
  const context=createWriterContextGateway({credential,workspace,query});
  const handlers={operations,receipts,context};
  if(issuer!==undefined) {
    if(!issuer||issuer.credential===credential||issuer.query===query)throw new TypeError('Buyer issuer separation required');
    handlers.issuance=createBuyerIssuer({credential:issuer.credential,workspace,query:issuer.query});
    handlers.reconciliation=createBuyerReconciler({credential:issuer.credential,workspace,query:issuer.query});
  }
  let active=0,stopped=false;
  const sockets=new Set();
  const repliedSockets=new WeakSet();
  const handleRequest=(req,res)=>{
    const reply=(status,body)=>{
      if(res.destroyed||res.writableEnded) return;
      const data=JSON.stringify(body);
      repliedSockets.add(req.socket);
      res.writeHead(status,{'content-type':'application/json','cache-control':'no-store',
        'content-length':Buffer.byteLength(data),'connection':'close','x-content-type-options':'nosniff'});
      res.end(data);
    };
    const deny=(status)=>reply(status,{ok:false,code:status===503?'WRITER_UNAVAILABLE':'WRITER_REJECTED'});
    // Match raw URL exactly. Encodings, query strings and additional path segments
    // do not select a job or an operation endpoint.
    const match=/^\/api\/internal\/buyer-writer\/v1\/jobs\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/(operations|receipts|context|issuance|reconciliation)$/.exec(req.url??'');
    const preparation=req.url==='/api/internal/buyer-writer/v1/preparation'&&typeof isPrepared==='function'&&issuer!==undefined;
    if(!preparation&&(!match||!handlers[match[2]])) return deny(404);
    if(req.method!==(preparation?'GET':'POST')) return deny(405);
    if((!preparation&&req.headers['content-type']!=='application/json')||req.headers['content-encoding']) return deny(415);
    if(preparation&&(![undefined,'0'].includes(req.headers['content-length'])||req.headers['transfer-encoding']!==undefined))return deny(400);
    try {
      if(preparation||match[2]==='issuance'||match[2]==='reconciliation')authenticateBuyerIssuer(req.rawHeaders,issuer.credential);
      else authenticateWriterRequest(req.rawHeaders,credential);
    }
    catch(error){return deny(error instanceof WriterProtocolError?error.status:503);}
    if(stopped||active>=32||(!sockets.has(req.socket)&&sockets.size>=64)) return deny(503);
    if(!sockets.has(req.socket)){
      sockets.add(req.socket);
      req.socket.once('close',()=>sockets.delete(req.socket));
      req.socket.setTimeout(15000,()=>req.socket.destroy());
    }
    active++;
    let disconnected=false;
    const deadline=setTimeout(()=>{disconnected=true;deny(503);},15000);
    deadline.unref();
    res.once('close',()=>{disconnected=true;});
    void (async()=>{
      try {
        if(preparation){
          // Preparation grants no write authority and never calls a database
          // routine. Commitment remains mandatory for every operation below.
          if(stopped||await isPrepared()!==true||stopped)return deny(503);
          if(!disconnected)reply(200,{ok:true,prepared:true});
          return;
        }
        // Failed observation means unavailable. This is an availability gate,
        // not a claim of atomic fencing with an unrelated authority database.
        if(stopped||await isAvailable()!==true) return deny(503);
        if(disconnected) return;
        if(stopped) return deny(503);
        const chunks=[];let bytes=0;
        const limit=match[2]==='operations'?262144:match[2]==='issuance'?65536:8192;
        for await(const chunk of req) {
          bytes+=chunk.length;
          if(bytes>limit) return deny(413);
          chunks.push(chunk);
          if(disconnected) return;
          if(stopped) return deny(503);
        }
        if(disconnected) return;
        if(stopped||await isAvailable()!==true) return deny(503);
        if(disconnected) return;
        if(stopped) return deny(503);
        const result=await handlers[match[2]]({
          jobId:match[1],rawHeaders:req.rawHeaders,body:Buffer.concat(chunks,bytes),
        });
        if(!disconnected) reply(result.status,result.body);
      } catch {deny(503);}
      // A disconnected/timed-out query still occupies its slot until settlement.
      // Releasing early would permit unbounded outstanding database operations.
      finally {active--;clearTimeout(deadline);}
    })();
  };
  const handleClientError=(_error,socket)=>{
    if(repliedSockets.has(socket)) return socket.destroy();
    if(socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    else socket.destroy();
  };
  return Object.freeze({handleRequest,handleClientError,stopAdmission:()=>{stopped=true;},isDrained:()=>active===0});
}

export function createBuyerWriterHttpServer(options) {
  const writer=createBuyerWriterRequestHandler(options);
  const server=http.createServer({maxHeaderSize:32768,headersTimeout:5000,requestTimeout:15000,connectionsCheckingInterval:1000},writer.handleRequest);
  server.maxRequestsPerSocket=1;
  server.maxConnections=64;
  server.setTimeout(15000);
  server.on('clientError',writer.handleClientError);
  server.once('close',writer.stopAdmission);
  return server;
}
