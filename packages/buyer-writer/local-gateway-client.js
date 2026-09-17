import {createHash,randomBytes,randomUUID} from 'node:crypto';
import net from 'node:net';
import {BUYER_WRITER_DEFAULT_SOCKET,BUYER_WRITER_LOCAL_MAX_BYTES,BUYER_WRITER_LOCAL_TIMEOUT_MS,
  canonicalLocalGatewayJson,decodeLocalGatewayJson,signLocalGatewayRequest} from './local-gateway-protocol.js';
import {BUYER_WRITER_LOCAL_STATEMENTS} from './local-gateway-server.js';
import {validateBuyerWriterGatewayAuthority} from './configuration.js';

const hash=value=>createHash('sha256').update(canonicalLocalGatewayJson(value)).digest('hex');
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
const unavailable=()=>new Error('Buyer writer local gateway unavailable');

function queryRequest(kind,text,values) {
  if(!Array.isArray(values))throw unavailable();
  if(kind==='issuer'&&text===BUYER_WRITER_LOCAL_STATEMENTS.issue&&values.length===8)return {operation:'issue',principal:values[1],dispatchId:values[7],generation:null,
    payload:{jobId:values[0],ownerId:values[1],requestId:values[7],criteria:JSON.parse(values[5]),updatedAt:values[6],sourceContext:JSON.parse(values[4]),permitDigest:values[3]}};
  if(kind==='issuer'&&text===BUYER_WRITER_LOCAL_STATEMENTS.cancel&&values.length===3)return {operation:'cancel',principal:values[1],dispatchId:null,generation:null,
    payload:{jobId:values[0],ownerId:values[1]}};
  if(kind==='issuer'&&text===BUYER_WRITER_LOCAL_STATEMENTS.reconcile&&values.length===5)return {operation:'reconcile',principal:values[1],dispatchId:values[3],generation:null,
    payload:{jobId:values[0],ownerId:values[1],requestId:values[3],updatedAt:values[4]}};
  if(kind==='runtime'&&text===BUYER_WRITER_LOCAL_STATEMENTS.context&&values.length===5)return {operation:'context',principal:'buyer-writer-runtime',dispatchId:values[3],generation:values[4],
    payload:{permitDigest:values[0],jobId:values[2],dispatchId:values[3],generation:values[4]}};
  if(kind==='runtime'&&text===BUYER_WRITER_LOCAL_STATEMENTS.apply&&values.length===3){const request=JSON.parse(values[2]);return {operation:'apply',principal:'buyer-writer-runtime',dispatchId:request.dispatchId,generation:request.generation,payload:{permitDigest:values[0],jobId:request.jobId,request:Object.fromEntries(Object.entries(request).filter(([key])=>key!=='jobId'))}};}
  if(kind==='runtime'&&text===BUYER_WRITER_LOCAL_STATEMENTS.receipt&&values.length===7)return {operation:'receipt',principal:'buyer-writer-runtime',dispatchId:values[3],generation:values[4],
    payload:{permitDigest:values[0],jobId:values[2],request:{version:1,dispatchId:values[3],generation:values[4],operation:values[5],chunkIndex:values[6]}}};
  throw unavailable();
}

export function createBuyerWriterLocalClient({socketPath=BUYER_WRITER_DEFAULT_SOCKET,capability,authority,
  timeoutMs=BUYER_WRITER_LOCAL_TIMEOUT_MS,connect=net.createConnection,now=Date.now}={}) {
  if(typeof socketPath!=='string'||!socketPath.startsWith('/')||!exact(authority,['releaseSha','operationId','attemptId','workspace','gatewayIdentity'])
    ||!/^[A-Za-z0-9._:-]{1,128}$/.test(authority.workspace??'')||!/^[a-f0-9]{40}$/.test(authority.releaseSha??'')
    ||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(authority.operationId??'')
    ||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(authority.attemptId??'')
    ||authority.gatewayIdentity!=='blackspire-writer'||typeof capability!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(capability)
    ||!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30_000)throw unavailable();
  try{authority=validateBuyerWriterGatewayAuthority(authority);}catch{throw unavailable();}
  const {workspace,releaseSha}=authority;
  let closed=false,healthy=true;
  const request=(operation,payload,provided={})=>new Promise((resolve,reject)=>{
    if(closed)return reject(unavailable());
    const requestId=randomUUID(),operationId=provided.operationId??authority.operationId,attemptId=provided.attemptId??authority.attemptId;
    const dispatchId=provided.dispatchId??payload.dispatchId??payload.requestId??payload.request?.dispatchId??null;
    const generation=provided.generation??payload.generation??payload.request?.generation??null;
    const inputDigest=provided.inputDigest??hash(payload),checkOutputDigest=provided.checkOutputDigest??hash({operation,workspace,releaseSha});
    const base={version:1,requestId,operation,binding:{releaseSha,operationId,attemptId,inputDigest,checkOutputDigest,workspace,
      principal:provided.principal??'buyer-writer-runtime',dispatchId,generation,mutation:{operation,dispatchId,generation}},payload,
      auth:{timestamp:now(),nonce:randomBytes(16).toString('hex'),mac:''}};
    base.auth.mac=signLocalGatewayRequest(base,capability);
    let socket,timer,bytes=0,settled=false;const chunks=[];
    const fail=()=>{if(settled)return;settled=true;healthy=false;clearTimeout(timer);socket?.destroy();reject(unavailable());};
    try{socket=connect({path:socketPath});}catch{return fail();}
    timer=setTimeout(fail,timeoutMs);timer.unref();socket.setTimeout(timeoutMs,fail);
    socket.once('error',fail);socket.once('connect',()=>socket.end(JSON.stringify(base)+'\n'));
    socket.on('data',chunk=>{
      bytes+=chunk.length;if(bytes>BUYER_WRITER_LOCAL_MAX_BYTES)return fail();chunks.push(chunk);
      const data=Buffer.concat(chunks,bytes),newline=data.indexOf(0x0a);if(newline<0)return;
      try{
        const value=decodeLocalGatewayJson(data.subarray(0,newline));
        if(!exact(value,value.ok===true?['version','requestId','ok','result']:['version','requestId','ok','code'])||value.version!==1||value.requestId!==requestId||value.ok!==true)throw unavailable();
        settled=true;healthy=true;clearTimeout(timer);socket.destroy();resolve(value.result);
      }catch{fail();}
    });
  });
  const query=kind=>async(text,values)=>{
    let q;try{q=queryRequest(kind,text,values);}catch{throw unavailable();}
    const suppliedWorkspace=kind==='runtime'?values[1]:(text===BUYER_WRITER_LOCAL_STATEMENTS.cancel?values[2]:values[2]);
    if(suppliedWorkspace!==workspace)throw unavailable();
    const result=await request(q.operation,q.payload,{principal:q.principal,dispatchId:q.dispatchId,generation:q.generation});
    return {rows:[{result}]};
  };
  const admittedRequest=async(value)=>{
    if(!exact(value,['origin','method','path','rawHeaders','body'])||typeof value.origin!=='string'||value.method!=='POST'
      ||!/^\/rest\/v1\/rpc\/(?:issue|cancel|reconcile|apply|receipt)$/.test(value.path)
      ||!Array.isArray(value.rawHeaders)||!Buffer.isBuffer(value.body))throw unavailable();
    return request('admit',{origin:value.origin,method:value.method,path:value.path,
      rawHeaders:[...value.rawHeaders],body:value.body.toString('base64url')},
    {principal:'buyer-writer-runtime',dispatchId:null,generation:null});
  };
  const admittedApply=async value=>{
    if(value?.path!=='/rest/v1/rpc/apply')throw unavailable();
    return admittedRequest(value);
  };
  // This is an authenticated protocol round-trip. The server's `ready`
  // dispatcher is deliberately implemented without either database adapter.
  const readiness=async()=>{
    const value=await request('ready',{}, {principal:'buyer-writer-runtime',dispatchId:null,generation:null});
    const keys=['status','protocolVersion','releaseShaMatch','workspaceMatch','authorityBindingLoaded','databaseConfigurationPresent','gatewayIdentityMatch'];
    if(!exact(value,keys)||value.status!=='ready'||value.protocolVersion!==1||!keys.slice(2).every(key=>value[key]===true))throw unavailable();
    return Object.freeze({...value});
  };
  const checkAvailability=async()=>{try{await readiness();return true;}catch{return false;}};
  return Object.freeze({request,admittedRequest,admittedApply,readiness,runtimeQuery:query('runtime'),issuerQuery:query('issuer'),checkAvailability,
    isHealthy:()=>!closed&&healthy,close:async()=>{closed=true;healthy=false;}});
}
