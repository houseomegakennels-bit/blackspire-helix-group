import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {ADMISSION_SQL,createAdmissionBridge} from '../packages/buyer-writer/admission-bridge.js';
import {ADMISSION_IDENTITY_SQL,createAttestedAdmissionExecutor,executeAdmission} from '../packages/buyer-writer/admission-executor.js';

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
const criteria={state:'NC',county:'Wake',property_type:'land',date_range_start:'2026-01-01',
 date_range_end:'2026-12-31',min_purchases:1,cash_buyers_only:false,llc_buyers_only:false};
const sourceContext={version:1,mode:'county_fetch',sources:[{sourceId:'00000000-0000-4000-8000-000000000008',
 sourceType:'arcgis',endpointId:'approved',endpointConfigDigest:'c'.repeat(64),cashDisabled:false}],
 budgets:{maxRequests:10,maxRows:100,maxBytes:10000},rawPayload:null};
const routeParameters={
 issue:{p_job:ids.jobId,p_owner:ids.subject,p_workspace:'isolated',p_digest:'b'.repeat(64),
  p_context:sourceContext,p_expected_criteria:criteria,p_expected_updated_at:'2026-09-17T20:00:00Z',p_request:ids.operationId},
 cancel:{p_job:ids.jobId,p_owner:ids.subject,p_workspace:'isolated'},
 reconcile:{p_job:ids.jobId,p_owner:ids.subject,p_workspace:'isolated',p_request:ids.dispatchId,
  p_expected_updated_at:'2026-09-17T20:00:00Z'},
 receipt:{p_digest:'b'.repeat(64),p_workspace:'isolated',p_job:ids.jobId,p_dispatch:ids.dispatchId,
  p_generation:1,p_operation:'start',p_index:0},
};
function encoded(value){return Buffer.from(JSON.stringify(value)).toString('base64url');}
function fixture(overrides={}){
 const requestId=overrides.requestId??ids.requestId;
 const jti=overrides.jti??ids.jti;
 const operation=overrides.operation??'apply',routeParameters=overrides.parameters??parameters;
 const kind=overrides.kind??(['issue','cancel','reconcile'].includes(operation)?'issuer':'runtime');
 const envelope={version:1,requestId,operation,parameters:routeParameters,
  releaseSha:'a'.repeat(40),operationId:ids.operationId,attemptId:ids.attemptId,workspace:'isolated'};
 const body=Buffer.from(JSON.stringify({envelope}));
 const header=encoded({alg:'Ed25519',typ:'zola-operation+jwt',kid:'test-key'});
 const claims=encoded({iss:'https://issuer.example',aud:'zola-buyer-writer',sub:ids.subject,jti,
  iat:now,nbf:now,exp:now+30,kind,operation,requestId,
  bodyDigest:createHash('sha256').update(body).digest('hex'),releaseSha:'a'.repeat(40),
  operationId:ids.operationId,attemptId:ids.attemptId,workspace:'isolated'});
 const token=`${header}.${claims}.${sign(null,Buffer.from(`${header}.${claims}`),privateKey).toString('base64url')}`;
 const rawHeaders=['Authorization',`Bearer ${token}`,'Content-Type','application/json',
  'Content-Length',String(body.length)];
 return {origin:'https://writer.example',method:'POST',path:`/rest/v1/rpc/${operation}`,rawHeaders,body};
}
function executor(query,{safe=true,releases=[]}={}){
 return createAttestedAdmissionExecutor({expectedLogin:'buyer_writer_admission_login',expectedCreatorOid:16388,connect:async()=>({
  query:async config=>config.text===ADMISSION_IDENTITY_SQL?{rows:[{safe}]}:query(config.text,config.values,{signal:config.signal}),
  release:destroy=>releases.push(destroy),
 })});
}
function bridge(query,options={}){
 return createAdmissionBridge({mode:'research-admission',configuration,publicKeyPem,
  admissionExecutor:executor(query,options.executorOptions),now:()=>now,...options.bridgeOptions});
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

test('typed issue, cancel, reconcile and receipt use only their exact admitted wrappers',async()=>{
 const cases=[
  ['issue',{dispatchId:ids.operationId,generation:1},15],
  ['cancel',{cancelled:true,jobId:ids.jobId},10],
  ['reconcile',{dispatchId:ids.dispatchId,generation:null,state:'absent'},12],
  ['receipt',{found:false,receipt:null},15],
 ];
 for(const [operation,result,count] of cases){
  const calls=[];
  const output=await bridge(async(sql,params)=>{
   calls.push({sql,params});
   if(sql===ADMISSION_SQL.reserve)return reserveResult;
   if(sql===ADMISSION_SQL[operation])return {rows:[{result}]};
   assert.fail('unexpected query');
  })(fixture({operation,parameters:routeParameters[operation]}));
  assert.deepEqual(output,{status:200,body:{...result,automaticRetry:false}});
  assert.deepEqual(calls.map(call=>call.sql),[ADMISSION_SQL.reserve,ADMISSION_SQL[operation]]);
  assert.equal(calls[1].params.length,count);
 }
});

test('typed lost acknowledgement correlates by route and never replays',async()=>{
 const calls=[],result={dispatchId:ids.operationId,generation:1};
 const output=await bridge(async sql=>{
  calls.push(sql);
  if(sql===ADMISSION_SQL.reserve)return reserveResult;
  if(sql===ADMISSION_SQL.issue)throw new Error('lost acknowledgement');
  if(sql===ADMISSION_SQL.correlate)return {rows:[{result:{state:'succeeded',routeOperation:'issue',
   result,automaticRetry:false,requestCorrelated:true}}]};
  assert.fail('unexpected query');
 })(fixture({operation:'issue',parameters:routeParameters.issue}));
 assert.deepEqual(output,{status:200,body:{...result,recovered:true,automaticRetry:false}});
 assert.deepEqual(calls,[ADMISSION_SQL.reserve,ADMISSION_SQL.issue,ADMISSION_SQL.correlate]);
});

test('lost apply acknowledgement correlates once and never replays apply',async()=>{
 const calls=[];
 const handle=bridge(async(sql)=>{
  calls.push(sql);
  if(sql===ADMISSION_SQL.reserve)return reserveResult;
  if(sql===ADMISSION_SQL.apply)throw new Error('lost acknowledgement');
  if(sql===ADMISSION_SQL.correlate)return {rows:[{result:{
   state:'succeeded',routeOperation:'apply',result:success,automaticRetry:false,requestCorrelated:true,
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

test('forged executor capability never falls back to runtime',async()=>{
 let runtimeCalls=0;
 const handle=createAdmissionBridge({
  mode:'research-admission',configuration,publicKeyPem,
  admissionExecutor:{run:async()=>{}},runtimeQuery:async()=>{runtimeCalls++;},now:()=>now,
 });
 const result=await handle(fixture());
 assert.equal(result.status,503);
 assert.equal(result.body.code,'ADMISSION_UNAVAILABLE');
 assert.equal(runtimeCalls,0);
});

test('database identity attestation failure is availability, not authentication',async()=>{
 let operationCalls=0;
 const result=await bridge(async()=>{operationCalls++;return reserveResult;},{
  executorOptions:{safe:false},
 })(fixture());
 assert.equal(result.status,503);
 assert.equal(result.body.code,'ADMISSION_UNAVAILABLE');
 assert.equal(operationCalls,0);
 assert.match(ADMISSION_IDENTITY_SQL,/current_user='buyer_writer_admission'/);
 assert.match(ADMISSION_IDENTITY_SQL,/session_user=\$1/);
 assert.match(ADMISSION_IDENTITY_SQL,/creator\.oid=\$2::oid/);
 assert.match(ADMISSION_IDENTITY_SQL,/buyer_writer\.execute_admitted_apply/);
 assert.match(ADMISSION_IDENTITY_SQL,/not exists\(select from pg_auth_members/);
});

test('reservation outage is availability while a bad signature remains authentication',async()=>{
 const unavailable=await bridge(async sql=>{
  if(sql===ADMISSION_SQL.reserve)throw new Error('database offline');
  assert.fail('must not execute');
 })(fixture());
 assert.equal(unavailable.status,503);
 assert.equal(unavailable.body.code,'ADMISSION_UNAVAILABLE');
 const bad=fixture();
 bad.rawHeaders[1]=bad.rawHeaders[1].slice(0,-1)+(bad.rawHeaders[1].endsWith('A')?'B':'A');
 let operationCalls=0;
 const rejected=await bridge(async()=>{operationCalls++;return reserveResult;})(bad);
 assert.equal(rejected.status,401);
 assert.equal(rejected.body.code,'ADMISSION_REJECTED');
 assert.equal(operationCalls,0);
});

test('definitive database authorization rejection is distinct and is not correlated',async()=>{
 const calls=[];
 const result=await bridge(async sql=>{
  calls.push(sql);
  if(sql===ADMISSION_SQL.reserve)return reserveResult;
  throw Object.assign(new Error('denied'),{code:'42501'});
 })(fixture());
 assert.equal(result.status,403);
 assert.equal(result.body.code,'ADMISSION_REJECTED');
 assert.deepEqual(calls,[ADMISSION_SQL.reserve,ADMISSION_SQL.apply]);
});

test('execute and correlation deadlines abort and destroy their pinned sessions',async()=>{
 const calls=[],releases=[];let executeAborted=false,correlateAborted=false;
 const query=async(sql,_params,{signal}={})=>{
  calls.push(sql);
  if(sql===ADMISSION_SQL.reserve)return reserveResult;
  return new Promise((_,reject)=>signal.addEventListener('abort',()=>{
   if(sql===ADMISSION_SQL.apply)executeAborted=true;
   if(sql===ADMISSION_SQL.correlate)correlateAborted=true;
   reject(new Error('aborted'));
  },{once:true}));
 };
 const result=await bridge(query,{
  executorOptions:{releases},
  bridgeOptions:{executeTimeoutMs:10,correlateTimeoutMs:10},
 })(fixture());
 assert.equal(result.status,503);
 assert.equal(result.body.code,'ADMISSION_UNKNOWN');
 assert.equal(executeAborted,true);
 assert.equal(correlateAborted,true);
 assert.deepEqual(calls,[ADMISSION_SQL.reserve,ADMISSION_SQL.apply,ADMISSION_SQL.correlate]);
 assert.deepEqual(releases,[false,true,true]);
});

test('executor exposes no arbitrary SQL and enforces exact fixed argument counts',async()=>{
 const admission=executor(async()=>{assert.fail('must not query');});
 await assert.rejects(executeAdmission(admission,'select * from pg_authid',[]),/unavailable/);
 await assert.rejects(executeAdmission(admission,'reserve',[]),/unavailable/);
 assert.throws(()=>createAttestedAdmissionExecutor({expectedLogin:'buyer_writer_admission_login',expectedCreatorOid:0,connect:async()=>{}}),/unavailable/);
});
