import test from 'node:test';
import assert from 'node:assert/strict';
import {buyerWriterAdmissionHandleDigest,createBuyerWriterAdmittedLocalClient}
  from '../packages/buyer-writer/admitted-local-client.js';
import {BUYER_WRITER_LOCAL_STATEMENTS as SQL}
  from '../packages/buyer-writer/local-gateway-server.js';

const ids={
  operation:'00000000-0000-4000-8000-000000000001',
  request:'00000000-0000-4000-8000-000000000002',
  jti:'00000000-0000-4000-8000-000000000003',
  job:'00000000-0000-4000-8000-000000000004',
  owner:'00000000-0000-4000-8000-000000000005',
};
const configuration={issuer:'zola-control',audience:'buyer-writer',subject:ids.owner,
  keyId:'active',origin:'https://writer.example',releaseSha:'a'.repeat(40),
  operationId:ids.operation,attemptId:'00000000-0000-4000-8000-000000000006',
  workspace:'isolated'};

function fixture({uuids=[ids.request,ids.jti]}={}){
  const signed=[],admitted=[],contexts=[];let healthy=true,closed=0,response;
  const signer={sign:input=>{signed.push(input);return{origin:configuration.origin,
    method:'POST',path:'/rest/v1/rpc/'+input.operation,body:JSON.stringify({envelope:input}),
    token:'signed-token'};}};
  const client={admittedRequest:async request=>{admitted.push(request);
      return response??{status:200,body:{ok:true,operation:'start',chunkIndex:0,
        automaticRetry:false}};},
    runtimeQuery:async(...args)=>{contexts.push(args);return{rows:[{result:{read:true}}]};},
    checkAvailability:async()=>healthy,isHealthy:()=>healthy,
    close:async()=>{closed++;healthy=false;}};
  let next=0;
  const adapter=createBuyerWriterAdmittedLocalClient({client,signer,configuration,
    now:()=>2_000_000_001_999,uuid:()=>uuids[next++]});
  return {adapter,signed,admitted,contexts,client,setResponse:value=>{response=value;},
    closed:()=>closed};
}

test('runtime writes receive fresh signed permits and use only admitted transport',async()=>{
  const f=fixture(),q={jobId:ids.job,version:1,dispatchId:ids.operation,generation:1,
    operation:'start',chunkIndex:0,chunkCount:1,payload:{}};
  const result=await f.adapter.runtimeQuery(SQL.apply,['b'.repeat(64),'isolated',
    JSON.stringify(q)]);
  assert.deepEqual(result,{rows:[{result:{ok:true,operation:'start',chunkIndex:0}}]});
  assert.equal(f.signed.length,1);assert.equal(f.admitted.length,1);
  assert.deepEqual(f.signed[0],{configuration,operation:'apply',requestId:ids.request,
    jti:ids.jti,issuedAt:2_000_000_001,expiresAt:2_000_000_031,
    parameters:{p_digest:'b'.repeat(64),p_workspace:'isolated',q}});
  assert.equal(f.admitted[0].path,'/rest/v1/rpc/apply');
  assert.deepEqual(f.admitted[0].rawHeaders.slice(0,4),
    ['content-type','application/json','content-length',
      String(f.admitted[0].body.length)]);
  assert.equal(f.admitted[0].rawHeaders.at(-1),'Bearer signed-token');
});

test('issuer issue preserves the caller dispatch id separately from release operation authority',async()=>{
  const f=fixture({uuids:[ids.jti]});f.setResponse({status:200,body:{dispatchId:ids.request,
    generation:1,automaticRetry:false}});
  const values=[ids.job,ids.owner,'isolated','c'.repeat(64),
    JSON.stringify({version:1,mode:'frontend_payload',rawPayload:{byteCount:1}}),
    JSON.stringify({state:'NC'}),'2026-09-18T00:00:00.000Z',ids.request];
  const result=await f.adapter.issuerQuery(SQL.issue,values);
  assert.deepEqual(result,{rows:[{result:{dispatchId:ids.request,generation:1}}]});
  assert.notEqual(ids.request,configuration.operationId);
  assert.equal(f.signed[0].requestId,ids.request);
  assert.equal(f.signed[0].jti,ids.jti);
  assert.notEqual(f.signed[0].jti,f.signed[0].requestId);
  assert.equal(f.signed[0].parameters.p_request,ids.request);
  await assert.rejects(f.adapter.issuerQuery(SQL.issue,[...values.slice(0,7),'not-a-uuid']),
    /^Error: Buyer writer admitted client unavailable$/);
  assert.equal(f.admitted.length,1);
});

test('read-only context remains on the restricted runtime path',async()=>{
  const f=fixture(),values=['d'.repeat(64),'isolated',ids.job,ids.operation,1];
  assert.deepEqual(await f.adapter.runtimeQuery(SQL.context,values),
    {rows:[{result:{read:true}}]});
  assert.deepEqual(f.contexts,[[SQL.context,values]]);
  assert.equal(f.signed.length,0);assert.equal(f.admitted.length,0);
});

test('admission denial is sanitized and never falls back to legacy mutation',async()=>{
  for(const [status,code] of [[400,'22023'],[403,'42501'],[409,'23505'],
    [503,'ADMISSION_UNAVAILABLE']]){
    const f=fixture();f.setResponse({status,body:{ok:false,code:'PRIVATE',
      automaticRetry:false}});
    await assert.rejects(f.adapter.runtimeQuery(SQL.receipt,['d'.repeat(64),
      'isolated',ids.job,ids.operation,1,'start',0]),
      error=>error.message==='Buyer writer admitted client unavailable'&&error.code===code);
    assert.equal(f.contexts.length,0);
  }
});

test('unknown statements, signer failures and malformed success fail closed',async()=>{
  const f=fixture();
  await assert.rejects(f.adapter.runtimeQuery('select now()',[]),
    /^Error: Buyer writer admitted client unavailable$/);
  f.setResponse({status:200,body:{ok:true}});
  await assert.rejects(f.adapter.runtimeQuery(SQL.apply,['b'.repeat(64),'isolated',
    JSON.stringify({})]),/^Error: Buyer writer admitted client unavailable$/);
  const broken=fixture();broken.client.admittedRequest=async()=>{throw new Error('PRIVATE');};
  await assert.rejects(broken.adapter.runtimeQuery(SQL.apply,['b'.repeat(64),
    'isolated',JSON.stringify({})]),
    error=>error.message==='Buyer writer admitted client unavailable'&&!error.cause);
});

const outerAttemptId='00000000-0000-4000-8000-000000000090';
const applyValues=['b'.repeat(64),'isolated',JSON.stringify({jobId:ids.job,version:1,
  dispatchId:ids.operation,generation:1,operation:'start',chunkIndex:0,chunkCount:1,payload:{}})];
const recoveryBody=handle=>({ok:true,operation:'start',chunkIndex:0,recovered:true,
  automaticRetry:false,admissionCorrelation:{issuer:handle.authority.issuer,jti:handle.jti,
    requestId:handle.requestId,bodyDigest:handle.bodyDigest,operation:handle.operation,
    requestCorrelated:true}});

test('durable handle persistence completes before dispatch and contains no replay capability',async()=>{
  const f=fixture();let saved,release;
  const gate=new Promise(resolve=>{release=resolve;});
  const pending=f.adapter.runtimeQuery(SQL.apply,applyValues,{outerAttemptId,
    persistHandle:async(handle,digest)=>{saved={handle,digest};await gate;}});
  assert.equal(f.admitted.length,0);
  assert.equal(saved.handle.outerAttemptId,outerAttemptId);
  assert.notEqual(saved.handle.outerAttemptId,saved.handle.authority.attemptId);
  assert.equal(saved.digest,buyerWriterAdmissionHandleDigest(saved.handle));
  assert.equal(saved.handle.jti,ids.jti);assert.equal(saved.handle.requestId,ids.request);
  assert.equal(Object.isFrozen(saved.handle),true);
  assert.equal(Object.isFrozen(saved.handle.authority),true);
  assert.doesNotMatch(JSON.stringify(saved),/signed-token|Bearer|privateKey|parameters|payload/);
  release();await pending;assert.equal(f.admitted.length,1);
});

test('persistence rejection prevents all transport dispatch',async()=>{
  const f=fixture();
  await assert.rejects(f.adapter.runtimeQuery(SQL.apply,applyValues,{outerAttemptId,
    persistHandle:async()=>{throw new Error('PRIVATE journal failure');}}),
    /^Error: Buyer writer admitted client unavailable$/);
  assert.equal(f.admitted.length,0);
});

test('lost response is recovered by a fresh client with durable identity and no business replay',async()=>{
  const f=fixture();let saved,dispatches=0;
  f.client.admittedRequest=async()=>{dispatches++;throw new Error('lost response');};
  await assert.rejects(f.adapter.runtimeQuery(SQL.apply,applyValues,{outerAttemptId,
    persistHandle:async(handle,digest)=>{saved=JSON.parse(JSON.stringify({handle,digest}));}}));
  await f.adapter.close();assert.equal(dispatches,1);
  const fresh=fixture({uuids:[ids.job,ids.owner]});
  fresh.setResponse({status:200,body:recoveryBody(saved.handle)});
  assert.deepEqual(await fresh.adapter.recoverHandle(saved.handle,{outerAttemptId,
    expectedHandleDigest:saved.digest}),{result:{ok:true,operation:'start',chunkIndex:0},
      requestCorrelated:true,handleDigest:saved.digest});
  assert.deepEqual(fresh.signed.map(item=>item.operation),['recover']);
  assert.deepEqual(fresh.admitted.map(item=>item.path),['/rest/v1/rpc/recover']);
  assert.equal(fresh.signed[0].parameters.p_original_digest,saved.handle.bodyDigest);
  assert.notEqual(fresh.signed[0].jti,saved.handle.jti);
});

test('wrong journal attempt, digest, handle content, and installed authority deny before dispatch',async()=>{
  const f=fixture();let saved;
  await f.adapter.runtimeQuery(SQL.apply,applyValues,{outerAttemptId,
    persistHandle:async(handle,digest)=>{saved={handle,digest};}});
  const changedAuthority={...saved.handle,authority:{...configuration,releaseSha:'c'.repeat(40)}};
  for(const [handle,options] of [
    [saved.handle,{outerAttemptId:ids.job,expectedHandleDigest:saved.digest}],
    [saved.handle,{outerAttemptId,expectedHandleDigest:'e'.repeat(64)}],
    [{...saved.handle,bodyDigest:'e'.repeat(64)},{outerAttemptId,expectedHandleDigest:saved.digest}],
    [changedAuthority,{outerAttemptId,expectedHandleDigest:buyerWriterAdmissionHandleDigest(changedAuthority)}],
  ]){
    const fresh=fixture();await assert.rejects(fresh.adapter.recoverHandle(handle,options));
    assert.equal(fresh.signed.length,0);assert.equal(fresh.admitted.length,0);
  }
});

test('ordinary success and uncorrelated or mismatched recovery never prove admission',async()=>{
  const f=fixture();let saved;
  await f.adapter.runtimeQuery(SQL.apply,applyValues,{outerAttemptId,
    persistHandle:async(handle,digest)=>{saved={handle,digest};}});
  const valid=recoveryBody(saved.handle);
  for(const body of [{ok:true,operation:'start',chunkIndex:0,automaticRetry:false},
    {...valid,admissionCorrelation:{...valid.admissionCorrelation,requestCorrelated:false}},
    {...valid,admissionCorrelation:{...valid.admissionCorrelation,bodyDigest:'e'.repeat(64)}}]){
    const fresh=fixture();fresh.setResponse({status:200,body});
    await assert.rejects(fresh.adapter.recoverHandle(saved.handle,{outerAttemptId,
      expectedHandleDigest:saved.digest}));
    assert.deepEqual(fresh.signed.map(item=>item.operation),['recover']);
  }
});

test('health, availability and closure remain delegated once',async()=>{
  const f=fixture();
  assert.equal(f.adapter.isHealthy(),true);
  assert.equal(await f.adapter.checkAvailability(),true);
  await f.adapter.close();assert.equal(f.closed(),1);
  assert.equal(f.adapter.isHealthy(),false);
});

test('explicit recovery uses a distinct permit and never replays the original operation',async()=>{
  const f=fixture(),parameters={p_workspace:'isolated',p_owner:ids.owner,
    p_original_issuer:'zola-control',p_original_jti:ids.jti,
    p_original_request:ids.request,p_original_digest:'e'.repeat(64),
    p_route_operation:'apply'};
  f.setResponse({status:200,body:{ok:true,operation:'start',chunkIndex:0,
    recovered:true,automaticRetry:false}});
  const result=await f.adapter.recover(parameters);
  assert.deepEqual(result,{ok:true,operation:'start',chunkIndex:0});
  assert.equal(f.signed.length,1);assert.equal(f.signed[0].operation,'recover');
  assert.deepEqual(f.signed[0].parameters,parameters);
  assert.equal(f.admitted.length,1);
  await assert.rejects(f.adapter.recover({...parameters,extra:true}),
    /^Error: Buyer writer admitted client unavailable$/);
  assert.equal(f.admitted.length,1);
});
