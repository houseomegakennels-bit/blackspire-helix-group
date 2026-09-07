import http from 'node:http';
import { authenticateWriterRequest, createWriterGateway, createWriterReceiptGateway } from './gateway.js';
import { WriterProtocolError } from './protocol.js';

// Explicit composition only: the caller owns the dedicated database connection,
// listener binding, TLS ingress and authoritative availability/stop observation.
// No production configuration or credential file is loaded by this module.
export function createBuyerWriterHttpServer({credential,workspace,query,isAvailable}) {
  if(typeof isAvailable!=='function') throw new TypeError('Buyer writer availability check required');
  const operations=createWriterGateway({credential,workspace,query});
  const receipts=createWriterReceiptGateway({credential,workspace,query});
  let active=0;
  const repliedSockets=new WeakSet();
  const server=http.createServer({maxHeaderSize:32768,headersTimeout:5000,requestTimeout:15000,connectionsCheckingInterval:1000},(req,res)=>{
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
    const match=/^\/api\/internal\/buyer-writer\/v1\/jobs\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/(operations|receipts)$/.exec(req.url??'');
    if(!match) return deny(404);
    if(req.method!=='POST') return deny(405);
    if(req.headers['content-type']!=='application/json'||req.headers['content-encoding']) return deny(415);
    try {authenticateWriterRequest(req.rawHeaders,credential);}
    catch(error){return deny(error instanceof WriterProtocolError?error.status:503);}
    if(active>=32) return deny(503);
    active++;
    let disconnected=false;
    const deadline=setTimeout(()=>{disconnected=true;deny(503);},15000);
    deadline.unref();
    res.once('close',()=>{disconnected=true;});
    void (async()=>{
      try {
        // Failed observation means unavailable. This is an availability gate,
        // not a claim of atomic fencing with an unrelated authority database.
        if(await isAvailable()!==true) return deny(503);
        if(disconnected) return;
        const chunks=[];let bytes=0;
        const limit=match[2]==='receipts'?8192:262144;
        for await(const chunk of req) {
          bytes+=chunk.length;
          if(bytes>limit) return deny(413);
          chunks.push(chunk);
          if(disconnected) return;
        }
        if(disconnected) return;
        if(await isAvailable()!==true) return deny(503);
        if(disconnected) return;
        const result=await (match[2]==='receipts'?receipts:operations)({
          jobId:match[1],rawHeaders:req.rawHeaders,body:Buffer.concat(chunks,bytes),
        });
        if(!disconnected) reply(result.status,result.body);
      } catch {deny(503);}
      // A disconnected/timed-out query still occupies its slot until settlement.
      // Releasing early would permit unbounded outstanding database operations.
      finally {active--;clearTimeout(deadline);}
    })();
  });
  server.maxRequestsPerSocket=1;
  server.maxConnections=64;
  server.setTimeout(15000);
  server.on('clientError',(_error,socket)=>{
    if(repliedSockets.has(socket)) return socket.destroy();
    if(socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    else socket.destroy();
  });
  return server;
}
