import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createBoundedWriterE2eOperation,inspectFixedWriterAcceptance} from '../packages/zola-release/production-acl-writer.js';

const root=fileURLToPath(new URL('..',import.meta.url));
const source=file=>readFileSync(new URL(file,`file://${root}/`),'utf8');
const sha='a'.repeat(40),digest=value=>createHash('sha256').update(value).digest('hex');
const operationId='11111111-1111-4111-8111-111111111111';
const attemptId='22222222-2222-4222-8222-222222222222';
const base={input:{releaseSha:sha,workspace:'blackspire',principal:'zola-release'},
 state:{context:{operationId,releaseSha:sha,workspace:'blackspire',principal:'zola-release'}}};
const attempt={...base,attemptId,inputDigest:digest('input'),checkOutputDigest:digest('check')};

function mutation(bound){
 const normalized={releaseSha:bound.releaseSha,operationId:bound.operationId,workspace:bound.workspace,principal:bound.principal,
  attemptId:bound.attemptId,inputDigest:bound.inputDigest,checkOutputDigest:bound.checkOutputDigest};
 const bytes=createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
 return `${bytes.slice(0,8)}-${bytes.slice(8,12)}-4${bytes.slice(13,16)}-8${bytes.slice(17,20)}-${bytes.slice(20,32)}`;
}

function inspection(bound,overrides={}){
 const completed=bound.attemptId!==null;
 return {schema:1,kind:'zola_bounded_writer_acceptance',...bound,capability:'buyer.writer.acceptance',mutationId:mutation(bound),
  state:completed?'COMPENSATED':'PREPARED',businessRowsChanged:0,paidProviderCalls:0,
  receiptDigest:completed?digest('receipt'):null,compensationComplete:completed,outcomeUnknown:false,
  ...(completed?{admittedGatewayReceiptWitness:true,admittedGatewayReceiptDigest:digest('admitted-gateway-receipt'),
   admittedGatewayReceiptAttemptId:bound.attemptId,...overrides}:{})};
}

test('bounded writer production path cannot regain a direct PostgreSQL or in-process gateway transport',()=>{
 const writer=source('packages/zola-release/production-acl-writer.js');
 const legacy=['createBuyerWriterPostgres','createWriterGateway','createWriterReceiptGateway']
  .filter(name=>new RegExp(`\\b${name}\\b`).test(writer));
 assert.deepEqual(legacy,[],'legacy transports bypass the admitted local gateway boundary');
});

test('bounded writer production composition cannot use the legacy activation configuration',()=>{
 const adapters=source('packages/zola-release/production-adapters.js');
 const bounded=adapters.match(/const writerHost=[\s\S]*?operations\.bounded_writer_e2e=[\s\S]*?\);/)?.[0];
 assert.ok(bounded,'bounded writer composition must remain explicit');
 assert.doesNotMatch(bounded,/activationConfigurationFile/,'bounded writer must consume the installed admission client/gateway configuration');
});

test('bounded writer reconciliation requires an attempt-bound admitted gateway receipt witness',async()=>{
 const operation=createBoundedWriterE2eOperation({inspectAcceptance:async bound=>inspection(bound),runAcceptance:async()=>{}});
 assert.equal((await operation.check(base)).status,'PASS');
 await operation.execute(attempt);
 const observed=await operation.reconcile(attempt);
 assert.equal(observed.status,'PASS');
 assert.equal(observed.evidence.admittedGatewayReceiptWitness,true);
 assert.equal(observed.evidence.admittedGatewayReceiptDigest,digest('admitted-gateway-receipt'));
 assert.equal(observed.evidence.admittedGatewayReceiptAttemptId,attemptId);
});

test('business cancelled or failed results cannot manufacture an admitted receipt witness',async()=>{
 const target={schema:1,kind:'zola_bounded_writer_acceptance_target',releaseSha:sha,
  workspace:base.input.workspace,principal:base.input.principal,capability:'buyer.writer.acceptance',
  jobId:'33333333-3333-4333-8333-333333333333',ownerId:'44444444-4444-4444-8444-444444444444',
  criteria:{state:'GA',county:'Fulton',property_type:'all',date_range_start:'2000-01-01',date_range_end:'2000-01-01',
   min_purchases:1,cash_buyers_only:false,llc_buyers_only:false},updatedAt:'2026-09-11T12:34:56.123456Z'};
 const bound={...base.state.context,attemptId,inputDigest:attempt.inputDigest,checkOutputDigest:attempt.checkOutputDigest};
 for(const state of ['cancelled','failed']){
  let receipts=0;
  const host={groupId:0,readAcceptanceSnapshot:()=>({value:target,identity:{}}),openAdmittedClient:async()=>({
   isHealthy:()=>true,close:async()=>{},
   issuerQuery:async(sql,values)=>{
    assert.match(sql,/\.reconcile\(/);
    return {rows:[{result:{dispatchId:values[3],generation:7,state}}]};
   },
   runtimeQuery:async sql=>{
    assert.match(sql,/\.receipt\(/);receipts++;
    return {rows:[{result:{found:true,receipt:{ok:true,operation:'fail',chunkIndex:0}}}]};
   },
  })};
  assert.equal(await inspectFixedWriterAcceptance(bound,host),null);
  const operation=createBoundedWriterE2eOperation({
   inspectAcceptance:value=>inspectFixedWriterAcceptance(value,host),runAcceptance:async()=>{},
  });
  assert.deepEqual(await operation.reconcile(attempt),{status:'BLOCKED_EXTERNAL'});
  assert.equal(receipts,0,'missing durable journal blocks before any business receipt request');
 }
});

test('bounded writer rejects forged, missing, or cross-attempt admitted receipt evidence',async()=>{
 const cases=[
  {admittedGatewayReceiptWitness:false},
  {admittedGatewayReceiptDigest:null},
  {admittedGatewayReceiptAttemptId:'33333333-3333-4333-8333-333333333333'},
 ];
 for(const forged of cases){
  const operation=createBoundedWriterE2eOperation({inspectAcceptance:async bound=>inspection(bound,forged),runAcceptance:async()=>{}});
  await assert.rejects(()=>operation.reconcile(attempt),/operation rejected/);
 }
});
