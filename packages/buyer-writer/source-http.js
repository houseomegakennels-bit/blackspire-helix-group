import https from 'node:https';
import { resolve4 } from 'node:dns/promises';
import { BlockList, isIPv4, isIP } from 'node:net';
import { performance } from 'node:perf_hooks';

export class BuyerSourceError extends Error {
  constructor(code) {super('Buyer source acquisition failed');this.name='BuyerSourceError';this.code=code;}
}
const reject=(code='SOURCE_POLICY_REJECTED')=>{throw new BuyerSourceError(code);};
const reserved=new BlockList();
for(const [network,prefix]of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],
  ['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.31.196.0',24],
  ['192.52.193.0',24],['192.88.99.0',24],['192.168.0.0',16],['192.175.48.0',24],
  ['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])reserved.addSubnet(network,prefix,'ipv4');
reserved.addAddress('168.63.129.16','ipv4');
export const isBuyerPublicIPv4=(address)=>typeof address==='string'&&isIPv4(address)&&!reserved.check(address,'ipv4');
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const id=(s)=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(s);

// Policies and buildParameters functions are trusted server code, never caller
// JSON. Their immutable digest binds the reviewed adapter configuration. The
// adapter supplies only an endpoint ID, that digest and typed parameters.
// Explicit transport injection exists for isolation tests; defaults use HTTPS
// and DNS without reading credential files or fetching anything at construction.
// maxBytes bounds consumed response bodies. Outgoing query/body and response
// headers have separate per-request limits; error responses are destroyed early.
export function createBuyerSourceClient({endpoints,budgets,dnsResolve=resolve4,httpsRequest=https.request}) {
  if(!Array.isArray(endpoints)||!endpoints.length||endpoints.length>32
    ||!integer(budgets?.maxRequests,1,500)||!integer(budgets?.maxBytes,1,67108864)
    ||!integer(budgets?.maxElapsedMs,1,240000))reject();
  const policies=new Map();
  for(const p of endpoints) {
    let url;try{url=new URL(p.url);}catch{reject();}
    if(!id(p.id)||policies.has(p.id)||typeof p.digest!=='string'||!/^[a-f0-9]{64}$/.test(p.digest)
      ||url.protocol!=='https:'||url.username||url.password||url.port||url.search||url.hash
      ||isIP(url.hostname)||!url.hostname.includes('.')||url.hostname.endsWith('.local')
      ||!['GET','POST'].includes(p.method)||!['json','form'].includes(p.encoding)
      ||typeof p.buildParameters!=='function'||!integer(p.timeoutMs,1,30000))reject();
    const headers={};
    for(const [name,value]of Object.entries(p.headers??{})) {
      if(name.toLowerCase()!=='x-tenant'||typeof value!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value))reject();
      headers['x-tenant']=value;
    }
    policies.set(p.id,Object.freeze({url:url.href,hostname:url.hostname,method:p.method,encoding:p.encoding,
      digest:p.digest,timeoutMs:p.timeoutMs,headers:Object.freeze(headers),buildParameters:p.buildParameters}));
  }
  const agent=new https.Agent({keepAlive:false,maxSockets:1,maxCachedSessions:0,proxyEnv:{}});
  const deadline=performance.now()+budgets.maxElapsedMs;
  const maxRequests=budgets.maxRequests,maxBytes=budgets.maxBytes;
  let requests=0,bytes=0,active=false,closed=false,currentRequest;
  const close=()=>{closed=true;currentRequest?.destroy(new BuyerSourceError('SOURCE_CLOSED'));agent.destroy();};
  return {
    close,
    usage:()=>({requests,bytes,closed}),
    async request({endpointId,endpointConfigDigest,parameters}) {
      if(closed||active)reject('SOURCE_UNAVAILABLE');
      const policy=policies.get(endpointId);
      if(!policy||policy.digest!==endpointConfigDigest)reject();
      if(requests>=maxRequests||performance.now()>=deadline) {close();reject('SOURCE_BUDGET_EXCEEDED');}
      requests++;active=true;
      let timer;let timedOut=false;
      try {
        const time=Math.min(policy.timeoutMs,deadline-performance.now());
        const requestDeadline=performance.now()+time;
        const timeout=new Promise((_,rejectPromise)=>{timer=setTimeout(()=>{
          timedOut=true;close();rejectPromise(new BuyerSourceError('SOURCE_TIMEOUT'));
        },time);});
        const operation=(async()=>{
          const built=policy.buildParameters(parameters);
          if(!built||Object.keys(built).some(k=>!['query','body'].includes(k))
            ||!(built.query instanceof URLSearchParams))reject();
          const url=new URL(policy.url);url.search=built.query.toString();
          let body;
          if(policy.method==='POST') {
            if(policy.encoding==='form') {
              if(!(built.body instanceof URLSearchParams))reject();body=Buffer.from(built.body.toString());
            }else {body=Buffer.from(JSON.stringify(built.body));}
            if(body.length>65536)reject('SOURCE_BUDGET_EXCEEDED');
          }else if(built.body!==undefined&&built.body!==null)reject();
          if(url.href.length>16384)reject('SOURCE_BUDGET_EXCEEDED');
          if(closed||performance.now()>=requestDeadline)reject('SOURCE_TIMEOUT');
          const addresses=await dnsResolve(policy.hostname);
          if(closed||timedOut||performance.now()>=requestDeadline)reject('SOURCE_TIMEOUT');
          if(!Array.isArray(addresses)||!addresses.length||addresses.length>32||addresses.some(a=>!isBuyerPublicIPv4(a)))reject();
          // One pinned public answer; no second resolver call during connect.
          const address=addresses[0];
          return await new Promise((resolve,rejectPromise)=>{
            let settled=false;
            const finish=(error,value)=>{
              if(settled)return;settled=true;
              if(error){currentRequest?.destroy();rejectPromise(error);}else resolve(value);
            };
            const headers={'accept':'application/json','accept-encoding':'identity',...policy.headers};
            if(policy.method==='POST'&&policy.encoding==='form')headers['user-agent']='Mozilla/5.0';
            if(body){headers['content-type']=policy.encoding==='form'?'application/x-www-form-urlencoded':'application/json';headers['content-length']=body.length;}
            const req=httpsRequest(url,{method:policy.method,agent,headers,maxHeaderSize:16384,
              family:4,autoSelectFamily:false,servername:policy.hostname,rejectUnauthorized:true,
              lookup:(_hostname,_options,callback)=>callback(null,address,4)},res=>{
              if(closed||timedOut){res.destroy();return finish(new BuyerSourceError('SOURCE_TIMEOUT'));}
              if(!Number.isInteger(res.statusCode)||res.statusCode<200||res.statusCode>=300) {
                res.destroy();return finish(new BuyerSourceError('SOURCE_HTTP_FAILED'));
              }
              if(res.headers['content-encoding']&&res.headers['content-encoding']!=='identity') {
                res.destroy();return finish(new BuyerSourceError('SOURCE_ENCODING_REJECTED'));
              }
              const chunks=[];
              res.on('data',chunk=>{
                if(settled)return;
                bytes+=chunk.length;
                if(bytes>maxBytes){res.destroy();return finish(new BuyerSourceError('SOURCE_BUDGET_EXCEEDED'));}
                chunks.push(chunk);
              });
              res.once('error',()=>finish(new BuyerSourceError('SOURCE_TRANSPORT_FAILED')));
              res.once('aborted',()=>finish(new BuyerSourceError('SOURCE_TRANSPORT_FAILED')));
              res.once('end',()=>{
                if(settled)return;
                if(!res.complete)return finish(new BuyerSourceError('SOURCE_TRANSPORT_FAILED'));
                try {
                  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
                  if(!value||typeof value!=='object'||Object.hasOwn(value,'error'))reject('SOURCE_DATA_REJECTED');
                  if(closed||performance.now()>=requestDeadline)reject('SOURCE_TIMEOUT');
                  finish(null,{status:res.statusCode,ok:true,data:value});
                }catch{finish(new BuyerSourceError('SOURCE_DATA_REJECTED'));}
              });
            });
            currentRequest=req;
            req.once('error',()=>finish(new BuyerSourceError('SOURCE_TRANSPORT_FAILED')));
            req.once('upgrade',(_res,socket)=>{socket.destroy();finish(new BuyerSourceError('SOURCE_PROTOCOL_REJECTED'));});
            req.once('connect',(_res,socket)=>{socket.destroy();finish(new BuyerSourceError('SOURCE_PROTOCOL_REJECTED'));});
            req.end(body);
          });
        })();
        return await Promise.race([operation,timeout]);
      }catch(error) {
        close();throw error instanceof BuyerSourceError?error:new BuyerSourceError('SOURCE_TRANSPORT_FAILED');
      }finally {clearTimeout(timer);active=false;currentRequest=undefined;}
    },
  };
}
