import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createBuyerIssuer, createBuyerReconciler } from '../packages/buyer-writer/issuer.js';
import { createBuyerWriterHttpServer } from '../packages/buyer-writer/http.js';
const credential='a'.repeat(43),ownerId='00000000-0000-4000-8000-000000000001',jobId='00000000-0000-4000-8000-000000000002',dispatchId='00000000-0000-4000-8000-000000000003';
const input={version:1,ownerId,requestId:dispatchId,criteria:{state:'NC',county:'Wake',property_type:'land',date_range_start:'2026-01-01',date_range_end:'2026-12-31',min_purchases:1,cash_buyers_only:false,llc_buyers_only:false},
  updatedAt:'2026-09-07T00:00:00.123456Z',sourceContext:{version:1,mode:'frontend_payload',
    sources:[{sourceId:dispatchId,sourceType:'arcgis',endpointId:'fixture',endpointConfigDigest:'b'.repeat(64),cashDisabled:false}],
    budgets:{maxRequests:10,maxRows:100,maxBytes:10000},rawPayload:{digest:'c'.repeat(64),rowCount:0,byteCount:2}}};
const request=(body=input,rawHeaders=['x-buyer-issuer-key',credential])=>({jobId,body:Buffer.from(JSON.stringify(body)),rawHeaders});
test('issuer authenticates a separate workload before SQL and binds captured criteria/revision',async()=>{
  let call;
  const issuer=createBuyerIssuer({credential,workspace:'fixture',query:async(statement,parameters)=>{call={statement,parameters};return{rows:[{result:{dispatchId,generation:1}}]};}});
  const result=await issuer(request());assert.equal(result.status,200);assert.match(result.body.permit,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(call.statement,'select buyer_writer.issue($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::timestamptz,$8::uuid) as result');
  assert.deepEqual(call.parameters.slice(0,3),[jobId,ownerId,'fixture']);
  assert.equal(call.parameters[3],createHash('sha256').update(result.body.permit).digest('hex'));
  assert.deepEqual(JSON.parse(call.parameters[5]),input.criteria);assert.equal(call.parameters[6],input.updatedAt);
  assert.equal(call.parameters.includes(result.body.permit),false);assert.equal(call.parameters[7],dispatchId);
});
test('missing, runtime or duplicate authentication and malformed authority cannot issue',async()=>{
  let calls=0;const issuer=createBuyerIssuer({credential,workspace:'fixture',query:async()=>{calls++;throw new Error('should not query');}});
  for(const headers of [[],['x-buyer-writer-key',credential],['x-buyer-issuer-key','b'.repeat(43)],['x-buyer-issuer-key',credential,'X-Buyer-Issuer-Key',credential]])
    assert.equal((await issuer(request(input,headers))).status,401);
  for(const body of [{...input,ownerId:'invalid'},{...input,workspace:'caller'},{...input,criteria:{...input.criteria,extra:true}},
    {...input,criteria:{...input.criteria,min_purchases:6}},{...input,updatedAt:'infinity'},
    {...input,sourceContext:{...input.sourceContext,mode:'county_fetch',rawPayload:null}}])
    assert.equal((await issuer(request(body))).status,400);
  assert.equal(calls,0);
});
test('denied or unknown SQL outcomes never reveal generated permits, raw errors or false success',async()=>{
  for(const code of ['42501','23505','08006']) {
    let calls=0;const issuer=createBuyerIssuer({credential,workspace:'fixture',query:async()=>{calls++;throw Object.assign(new Error('SENSITIVE DATABASE DETAIL'),{code});}});
    const result=await issuer(request());assert.equal(result.status,code==='42501'?403:code==='23505'?409:503);
    assert.equal(calls,1);assert.equal(result.body.ok,false);assert.equal(JSON.stringify(result).includes('SENSITIVE'),false);assert.equal('permit' in result.body,false);
  }
  for(const value of [null,{dispatchId,generation:0},{dispatchId,generation:1,extra:true}]) {
    const issuer=createBuyerIssuer({credential,workspace:'fixture',query:async()=>({rows:[{result:value}]})});
    assert.equal((await issuer(request())).status,503);
  }
});
test('HTTP composition keeps issuer and runtime credentials/connections separate and responses uncached',async()=>{
  let issuerCalls=0,runtimeCalls=0;
  const runtimeQuery=async()=>{runtimeCalls++;throw new Error('unexpected runtime call');};
  const options={credential:'b'.repeat(43),workspace:'fixture',query:runtimeQuery,isAvailable:()=>true};
  assert.throws(()=>createBuyerWriterHttpServer({...options,issuer:{credential:options.credential,query:async()=>{}}}),/separation/);
  assert.throws(()=>createBuyerWriterHttpServer({...options,issuer:{credential,query:runtimeQuery}}),/separation/);
  const server=createBuyerWriterHttpServer({...options,issuer:{credential,query:async()=>{issuerCalls++;return{rows:[{result:{dispatchId,generation:1}}]};}}});
  try {
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
    const url=`http://127.0.0.1:${server.address().port}/api/internal/buyer-writer/v1/jobs/${jobId}/issuance`;
    const denied=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-buyer-writer-key':options.credential,'x-buyer-job-permit':'c'.repeat(43)},body:JSON.stringify(input)});
    assert.equal(denied.status,401);await denied.arrayBuffer();
    const accepted=await fetch(url,{method:'POST',headers:{'content-type':'application/json','x-buyer-issuer-key':credential},body:JSON.stringify(input)});
    assert.equal(accepted.status,200);assert.equal(accepted.headers.get('cache-control'),'no-store');assert.match((await accepted.json()).permit,/^[A-Za-z0-9_-]{43}$/);
    assert.equal(issuerCalls,1);assert.equal(runtimeCalls,0);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('reconciliation uses issuer authority and original revision without disclosing a permit',async()=>{
  let calls=0;
  const reconcile=createBuyerReconciler({credential,workspace:'fixture',query:async(statement,parameters)=>{
    calls++;assert.equal(statement,'select buyer_writer.reconcile($1,$2,$3,$4,$5::timestamptz) as result');
    assert.deepEqual(parameters,[jobId,ownerId,'fixture',dispatchId,input.updatedAt]);
    return{rows:[{result:{dispatchId,generation:1,state:'cancelled'}}]};
  }});
  const body={version:1,ownerId,requestId:dispatchId,updatedAt:input.updatedAt};
  assert.equal((await reconcile(request(body,[]))).status,401);
  assert.equal((await reconcile(request({...body,requestId:'invalid'}))).status,400);
  const result=await reconcile(request(body));assert.equal(result.status,200);
  assert.deepEqual(result.body,{dispatchId,generation:1,state:'cancelled'});assert.equal(calls,1);
});
test('mismatched issuance identity and invalid reconciliation outcomes fail closed',async()=>{
  const issuer=createBuyerIssuer({credential,workspace:'fixture',query:async()=>({rows:[{result:{dispatchId:jobId,generation:1}}]})});
  assert.equal((await issuer(request())).status,503);
  for(const value of [null,{dispatchId,generation:1,state:'processing'}, {dispatchId:jobId,generation:1,state:'completed'},
    {dispatchId,generation:1,state:'cancelled',permit:'unexpected'}]) {
    const reconcile=createBuyerReconciler({credential,workspace:'fixture',query:async()=>({rows:[{result:value}]})});
    assert.equal((await reconcile(request({version:1,ownerId,requestId:dispatchId,updatedAt:null}))).status,503);
  }
});
