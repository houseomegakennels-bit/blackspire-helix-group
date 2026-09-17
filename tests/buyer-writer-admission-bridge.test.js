import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {ADMISSION_SQL,createAdmissionBridge} from '../packages/buyer-writer/admission-bridge.js';

const {publicKey,privateKey}=generateKeyPairSync('ed25519');
const publicKeyPem=publicKey.export({type:'spki',format:'pem'});
const now=2_000_000_000;
const ids={
 subject:'00000000-0000-4000-8000-000000000001',
 operationId:'00000000-0000-4000-8000-000000000002',
 attemptId:'00000000-0000-4000-8000-000000000003',
 requestId:'00000000-0000-4000-8000-000000000004',
 jti:'00000000-0000-4000-8000-000000000005',
 jobId:'00000000-0000-4000-8000-000000000006',
 dispatchId:'00000000-0000-4000-8000-000000000007',
};
const configuration=JSON.stringify({
 issuer:'https://issuer.example',audience:'zola-buyer-writer',subject:ids.subject,
 keyId:'test-key',origin:'https://writer.example',releaseSha:'a'.repeat(40),
 operationId:ids.operationId,attemptId:ids.attemptId,workspace:'isolated',
});
const q={jobId:ids.jobId,version:1,dispatchId:ids.dispatchId,generation:1,
 operation:'start',chunkIndex:0,chunkCount:1,payload:{}};
const parameters={p_digest:'b'.repeat(64),p_workspace:'isolated',q};
function encoded(value){return Buffer.from(JSON.stringify(value)).toString('base64url');}
function fixture(overrides={}){
 const requestId=overrides.requestId??ids.requestId;
 const jti=overrides.jti??ids.jti;
 const envelope={version:1,requestId,operation:'apply',parameters,
  releaseSha:'a'.repeat(40),operationId:ids.operationId,attemptId:ids.attemptId,workspace:'isolated'};
 const body=Buffer.from(JSON.stringify({envelope}));
 const header=encoded({alg:'Ed25519',typ:'zola-operation+jwt',kid:'test-key'});
 const claims=encoded({iss:'https://issuer.example',aud:'zola-buyer-writer',sub:ids.subject,jti,
  iat:now,nbf:now,exp:now+30,kind:'runtime',operation:'apply',requestId,
  bodyDigest:createHash('sha256').update(body).digest('hex'),releaseSha:'a'.repeat(40),
  operationId:ids.operationId,attemptId:ids.attemptId,workspace:'isolated'});
 const token=`${header}.${claims}.${sign(null,Buffer.from(`${header}.${claims}`),privateKey).toString('base64url')}`;
 const rawHeaders=['Authorization',`Bearer ${token}`,'Content-Type','application/json',
  'Content-Length',String(body.length)];
 return {origin:'https://writer.example',method:'POST',path:'/rest/v1/rpc/apply',rawHeaders,body};
}
function bridge(query){
 return createAdmissionBridge({mode:'research-admission',configuration,publicKeyPem,admissionQuery:query,now:()=>now});
}
const success={ok:true,operation:'start',chunkIndex:0};
const reserveResult={rows:[{accepted:true}]};

test('valid signed raw request reserves before one admitted apply using fixed SQL',async()=>{
 const calls=[];
 const handle=bridge(async(sql,params,options)=>{
  calls.push({sql,params,options});
  if(sql===ADMISSION_SQL.reserve)return reserveResult;
  if(sql===ADMISSION_SQL.apply)return {rows:[{result:success}]};
  assert.fail('unexpected query');
 });
 assert.deepEqual(await handle(fixture()),{status:200,body:{...success,automaticRetry:false}});
 assert.deepEqual(calls.map(x=>x.sql),[ADMISSION_SQL.reserve,ADMISSION_SQL.apply]);
 assert.deepEqual(calls[0].params.slice(0,4),[
  'https://issuer.example',ids.jti,ids.requestId,
  createHash('sha256').update(fixture().body).digest('hex'),
 ]);
 assert.equal(calls[0].params.length,5);
 assert.equal(calls[1].params.length,11);
 assert.deepEqual(calls[1].params.slice(0,9),[
  'https://issuer.example',ids.jti,ids.requestId,calls[0].params[3],ids.subject,
  'a'.repeat(40),ids.operationId,ids.attemptId,'isolated',
 ]);
 assert.equal(calls[1].params[9],'b'.repeat(64));
 assert.deepEqual(JSON.parse(calls[1].params[10]),q);
 assert.equal(calls[0].options.signal instanceof AbortSignal,true);
});

test('lost apply acknowledgement correlates once and never replays apply',async()=>{
 const calls=[];
 const handle=bridge(async(sql)=>{
  calls.push(sql);
  if(sql===ADMISSION_SQL.reserve)return reserveResult;
  if(sql===ADMISSION_SQL.apply)throw new Error('lost acknowledgement');
  if(sql===ADMISSION_SQL.correlate)return {rows:[{result:{
   state:'succeeded',result:success,automaticRetry:false,requestCorrelated:true,
  }}]};
 });
 assert.deepEqual(await handle(fixture()),{
  status:200,body:{...success,recovered:true,automaticRetry:false},
 });
 assert.deepEqual(calls,[ADMISSION_SQL.reserve,ADMISSION_SQL.apply,ADMISSION_SQL.correlate]);
 assert.equal(calls.filter(x=>x===ADMISSION_SQL.apply).length,1);
});

test('reserved or inconsistent correlation remains unavailable without retry',async()=>{
 for(const state of ['reserved','inconsistent']){
  const calls=[];
  const handle=bridge(async(sql)=>{
   calls.push(sql);
   if(sql===ADMISSION_SQL.reserve)return reserveResult;
   if(sql===ADMISSION_SQL.apply)throw new Error('unknown');
   return {rows:[{result:{state,automaticRetry:false}}]};
  });
  const result=await handle(fixture());
  assert.equal(result.status,503);
  assert.equal(result.body.automaticRetry,false);
  assert.deepEqual(calls,[ADMISSION_SQL.reserve,ADMISSION_SQL.apply,ADMISSION_SQL.correlate]);
 }
});

test('replayed reservation is rejected before admitted apply',async()=>{
 const calls=[];
 const result=await bridge(async(sql)=>{
  calls.push(sql);
  if(sql===ADMISSION_SQL.reserve)return {rows:[{accepted:false}]};
  assert.fail('apply must not execute');
 })(fixture());
 assert.equal(result.status,401);
 assert.deepEqual(calls,[ADMISSION_SQL.reserve]);
});

test('duplicate authorization and ambiguous framing fail before reservation',async()=>{
 const original=fixture();let calls=0;
 const cases=[
  {...original,rawHeaders:[...original.rawHeaders,'Authorization',original.rawHeaders[1]]},
  {...original,rawHeaders:[...original.rawHeaders,'Content-Length',String(original.body.length)]},
  {...original,rawHeaders:[...original.rawHeaders,'Transfer-Encoding','chunked']},
  {...original,rawHeaders:[...original.rawHeaders,'Content-Encoding','gzip']},
  {...original,rawHeaders:original.rawHeaders.map((x,i)=>i===5?String(original.body.length+1):x)},
  {...original,rawHeaders:original.rawHeaders.map((x,i)=>i===3?'application/json; charset=utf-8':x)},
  {...original,body:Buffer.from([0xff])},
 ];
 const handle=bridge(async()=>{calls++;return reserveResult;});
 for(const request of cases){
  const result=await handle(request);
  assert.equal(result.status,400);
  assert.equal(result.body.automaticRetry,false);
 }
 assert.equal(calls,0);
});

test('raw bytes, origin, route and signed schema are bound before reservation',async()=>{
 const original=fixture();let calls=0;
 const cases=[
  {...original,origin:'https://redirect.example'},
  {...original,path:'/rest/v1/rpc/receipt'},
  {...original,method:'GET'},
  {...original,body:Buffer.concat([original.body,Buffer.from(' ')])},
 ];
 const handle=bridge(async()=>{calls++;return reserveResult;});
 for(const request of cases)assert.notEqual((await handle(request)).status,200);
 assert.equal(calls,0);
});

test('database detail and malformed results are never exposed',async()=>{
 for(const behavior of [
  async sql=>sql===ADMISSION_SQL.reserve?reserveResult:{rows:[{result:{ok:true,operation:'start',chunkIndex:0,secret:'x'}}]},
  async sql=>{if(sql===ADMISSION_SQL.reserve)return reserveResult;throw new Error('PRIVATE DATABASE DETAIL');},
 ]){
  const output=await bridge(behavior)(fixture());
  assert.equal(output.status,503);
  assert.equal(JSON.stringify(output).includes('PRIVATE'),false);
  assert.equal(JSON.stringify(output).includes('secret'),false);
  assert.equal(output.body.automaticRetry,false);
 }
});

test('bridge requires the dedicated admission query and never falls back to runtime',()=>{
 let runtimeCalls=0;
 assert.throws(()=>createAdmissionBridge({
  mode:'research-admission',configuration,publicKeyPem,
  runtimeQuery:async()=>{runtimeCalls++;},
  now:()=>now,
 }),/configuration unavailable/);
 assert.equal(runtimeCalls,0);
});
