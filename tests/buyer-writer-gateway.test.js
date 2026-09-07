import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createWriterGateway } from '../packages/buyer-writer/gateway.js';
const credential=randomBytes(32).toString('base64url');
const permit=randomBytes(32).toString('base64url');
const jobId='00000000-0000-4000-8000-000000000001';
const body=Buffer.from(JSON.stringify({version:1,dispatchId:'00000000-0000-4000-8000-000000000002',generation:1,operation:'start',chunkIndex:0,chunkCount:1,payload:{}}));
const request={jobId,body,rawHeaders:['X-Buyer-Writer-Key',credential,'X-Buyer-Job-Permit',permit]};
const gateway=(query)=>createWriterGateway({credential,workspace:'isolated',query});
test('authenticated operation uses fixed parameterized SQL and never passes raw credentials',async()=>{
 let captured;
 const handle=gateway(async(sql,params)=>{captured={sql,params};return{rows:[{result:{ok:true,operation:'start',chunkIndex:0}}]};});
 assert.deepEqual(await handle(request),{status:200,body:{ok:true,operation:'start',chunkIndex:0}});
 assert.equal(captured.sql,'select buyer_writer.apply($1,$2,$3::jsonb) as result');
 assert.equal(JSON.stringify(captured).includes(credential),false);assert.equal(JSON.stringify(captured).includes(permit),false);
 assert.equal(Object.hasOwn(JSON.parse(captured.params[2]),'payloadDigest'),false);
});
test('duplicate and malformed credential headers fail before database access',async()=>{
 let calls=0;const handle=gateway(async()=>{calls++;});
 for(const rawHeaders of [[], [...request.rawHeaders,'x-buyer-writer-key',credential], [...request.rawHeaders,'X-Buyer-Job-Permit',permit], ['x-buyer-writer-key'], null]) {
  assert.equal((await handle({...request,rawHeaders})).status,401);
 }
 assert.equal(calls,0);
});
test('database failure receipts and exceptions never become HTTP success or leak detail',async()=>{
 for(const query of [
  async()=>({rows:[{result:{ok:false,code:'WRITE_FAILED'}}]}),
  async()=>{throw Object.assign(new Error('PRIVATE DATABASE DETAIL'),{code:'XX000'});},
  async()=>({rows:[{result:{ok:true,operation:'other',chunkIndex:0}}]}),
  async()=>({rows:[]}),
  async()=>({rows:[{result:{ok:true,operation:'start',chunkIndex:0,owner:'PRIVATE'}}]}),
 ]) {const result=await gateway(query)(request);assert.equal(result.status,503);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);}
});
test('authorization, replay and malformed input return explicit non-success status',async()=>{
 for(const [code,status] of [['42501',403],['23505',409],['22023',400],['22P02',400],['57014',503]]) {
  const result=await gateway(async()=>{throw Object.assign(new Error('PRIVATE'),{code});})(request);
  assert.equal(result.status,status);assert.equal(JSON.stringify(result).includes('PRIVATE'),false);
 }
 assert.equal((await gateway(async()=>assert.fail('must not query'))({...request,body:Buffer.from('{}')})).status,400);
});

test('receipt lookup is separately scoped and never retries an operation',async()=>{
 const {createWriterReceiptGateway}=await import('../packages/buyer-writer/gateway.js');
 let captured;
 const handle=createWriterReceiptGateway({credential,workspace:'isolated',query:async(sql,params)=>{
  captured={sql,params};return{rows:[{result:{found:true,receipt:{ok:false,code:'WRITE_FAILED'}}}]};
 }});
 const lookup={version:1,dispatchId:'00000000-0000-4000-8000-000000000002',generation:1,operation:'buyers.commit',chunkIndex:0};
 const result=await handle({...request,body:Buffer.from(JSON.stringify(lookup))});
 assert.equal(result.status,200);assert.equal(result.body.receipt.ok,false);
 assert.equal(captured.sql,'select buyer_writer.receipt($1,$2,$3,$4,$5,$6,$7) as result');
 assert.equal(JSON.stringify(captured).includes(permit),false);
 assert.equal((await handle({...request,body:Buffer.from(JSON.stringify({...lookup,owner:'forged'}))})).status,400);
});
