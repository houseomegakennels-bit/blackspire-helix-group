import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateBuyerSourceContext, verifyBuyerRawPayload } from '../packages/buyer-writer/source-context.js';
import { createWriterContextGateway } from '../packages/buyer-writer/gateway.js';

const context={version:1,mode:'county_fetch',sources:[{sourceId:'00000000-0000-4000-8000-000000000001',sourceType:'arcgis',endpointId:'approved-fixture',endpointConfigDigest:'a'.repeat(64),cashDisabled:false}],budgets:{maxRequests:10,maxRows:100,maxBytes:10000},rawPayload:null};
test('context validation rejects authority expansion and returns a detached snapshot',()=>{
  const copy=validateBuyerSourceContext(context);copy.sources[0].cashDisabled=true;
  assert.equal(context.sources[0].cashDisabled,false);
  for(const invalid of [null,{}, {...context,secret:'not-allowed'}, {...context,mode:'frontend_payload'},
    {...context,sources:[...context.sources,...context.sources]},
    {...context,sources:[{...context.sources[0],endpointId:'https://arbitrary.invalid/'}]},
    {...context,budgets:{...context.budgets,maxRows:50001}},
    {...context,budgets:{...context.budgets,maxBytes:Infinity}},
  ])assert.throws(()=>validateBuyerSourceContext(invalid),{status:400});
});
test('raw payload binding verifies exact bytes, count, shape and limits before normalization',()=>{
  const bytes=Buffer.from('[{"buyer_name":"SYNTHETIC"}]');
  const bound={...context,mode:'frontend_payload',rawPayload:{digest:createHash('sha256').update(bytes).digest('hex'),rowCount:1,byteCount:bytes.length}};
  assert.deepEqual(verifyBuyerRawPayload(bound,bytes),[{buyer_name:'SYNTHETIC'}]);
  for(const bad of [Buffer.from('[{"buyer_name":"FORGERYYY"}]'),Buffer.concat([bytes,Buffer.from(' ')]),bytes.toString()]) {
    assert.throws(()=>verifyBuyerRawPayload(bound,bad),{status:400});
  }
  assert.throws(()=>verifyBuyerRawPayload({...bound,rawPayload:{...bound.rawPayload,rowCount:0}},bytes),{status:400});
  for(const raw of ['[null]','[[]]','{}','[1]']) {
    const data=Buffer.from(raw);
    assert.throws(()=>verifyBuyerRawPayload({...bound,rawPayload:{digest:createHash('sha256').update(data).digest('hex'),rowCount:1,byteCount:data.length}},data),{status:400});
  }
});
test('context gateway authenticates, uses fixed scoped SQL, rejects malformed database responses',async()=>{
  const jobId='00000000-0000-4000-8000-000000000002';
  const body=Buffer.from(JSON.stringify({version:1,dispatchId:jobId,generation:1}));
  const rawHeaders=['x-buyer-writer-key','a'.repeat(43),'x-buyer-job-permit','b'.repeat(43)];
  const criteria={state:'NC',county:'Wake',property_type:'land',date_range_start:'2026-01-01',date_range_end:'2026-12-31',min_purchases:1,cash_buyers_only:false,llc_buyers_only:false};
  let value={criteria,sourceContext:context,sourceContextDigest:'c'.repeat(64)};let calls=0;
  const handle=createWriterContextGateway({credential:'a'.repeat(43),workspace:'fixture',query:async(sql,params)=>{
    calls++;assert.equal(sql,'select buyer_writer.context($1,$2,$3,$4,$5) as result');
    assert.deepEqual(params.slice(1),['fixture',jobId,jobId,1]);return{rows:[{result:value}]};
  }});
  assert.equal((await handle({jobId,body,rawHeaders:[]})).status,401);assert.equal(calls,0);
  assert.equal((await handle({jobId,body,rawHeaders})).status,200);
  value={...value,ownerId:jobId};assert.equal((await handle({jobId,body,rawHeaders})).status,503);
  value={criteria,sourceContext:{...context,sourceUrl:'https://untrusted.invalid'},sourceContextDigest:'c'.repeat(64)};
  assert.equal((await handle({jobId,body,rawHeaders})).status,503);
  assert.equal((await handle({jobId,body:Buffer.from('{}'),rawHeaders})).status,400);
});
