import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PROVIDER_ACL_CHECK_SQL,PROVIDER_ACL_FUNCTIONS,createProviderAclCheckOperation,createBoundedWriterE2eOperation}
 from '../packages/zola-release/production-acl-writer.js';

const a='a'.repeat(40),d=value=>createHash('sha256').update(value).digest('hex');
const operationId='11111111-1111-4111-8111-111111111111',attemptId='22222222-2222-4222-8222-222222222222';
const base={input:{releaseSha:a,workspace:'blackspire',principal:'zola-release',},state:{context:{operationId,releaseSha:a,workspace:'blackspire',principal:'zola-release'}}};
const attempt={...base,attemptId,inputDigest:d('input'),checkOutputDigest:d('check')};
const aclRows=()=>PROVIDER_ACL_FUNCTIONS.map(functionName=>({functionName,arguments:'',owner:'supabase_admin',publicExecute:false,
 ownerExecute:true,postgresExecute:true,serviceRoleExecute:true,writerExecute:false}));

test('provider ACL operation performs one fixed read-only exact-twelve catalog check',async()=>{
 let calls=0;const operation=createProviderAclCheckOperation({query:async(sql,values)=>{
  calls++;assert.equal(sql,PROVIDER_ACL_CHECK_SQL);assert.deepEqual(values,[]);
  assert.doesNotMatch(sql,/\b(?:grant|revoke|alter|update|insert|delete|call)\b/i);return{rows:aclRows()};
 }});
 const result=await operation.check(base);
 assert.equal(result.status,'PASS');assert.equal(result.evidence.functionCount,12);assert.equal(result.evidence.operationId,operationId);
 assert.match(result.evidence.catalogDigest,/^[a-f0-9]{64}$/);assert.equal(calls,1);
});

test('provider ACL operation blocks on unavailable or unapplied provider state and rejects privilege loss',async()=>{
 assert.deepEqual(await createProviderAclCheckOperation({query:async()=>{throw new Error('offline');}}).observe(base),{status:'BLOCKED_EXTERNAL'});
 const publicRows=aclRows();publicRows[0].publicExecute=true;
 assert.deepEqual(await createProviderAclCheckOperation({query:async()=>({rows:publicRows})}).check(base),{status:'BLOCKED_EXTERNAL'});
 const lost=aclRows();lost[0].serviceRoleExecute=false;
 await assert.rejects(()=>createProviderAclCheckOperation({query:async()=>({rows:lost})}).check(base),/operation rejected/);
 const duplicate=aclRows();duplicate[1].functionName=duplicate[0].functionName;
 await assert.rejects(()=>createProviderAclCheckOperation({query:async()=>({rows:duplicate})}).check(base),/operation rejected/);
});

test('bounded writer operation binds release, operation, attempt, workspace, principal and fixed capability',async()=>{
 let request;const operation=createBoundedWriterE2eOperation({
  inspectAcceptance:async bound=>bound.attemptId===null
   ?{schema:1,kind:'zola_bounded_writer_acceptance',...bound,capability:'buyer.writer.acceptance',mutationId:expectedMutation(bound),state:'PREPARED',businessRowsChanged:0,paidProviderCalls:0,receiptDigest:null,compensationComplete:false,outcomeUnknown:false}
   :{schema:1,kind:'zola_bounded_writer_acceptance',...bound,capability:'buyer.writer.acceptance',mutationId:expectedMutation(bound),state:'COMPENSATED',businessRowsChanged:0,paidProviderCalls:0,receiptDigest:d('receipt'),compensationComplete:true,outcomeUnknown:false},
  runAcceptance:async value=>{request=value;},
 });
 const checked=await operation.check(base);assert.equal(checked.status,'PASS');assert.equal(checked.evidence.paidProviderCalls,0);
 await operation.execute(attempt);
 assert.deepEqual({...request},{...attempt.input,operationId,attemptId,inputDigest:attempt.inputDigest,checkOutputDigest:attempt.checkOutputDigest,
  capability:'buyer.writer.acceptance',mutationId:expectedMutation({...attempt.input,operationId,attemptId,inputDigest:attempt.inputDigest,checkOutputDigest:attempt.checkOutputDigest}),
  operation:'fail',failureCode:'INVALID_SOURCE_DATA',maximumBusinessRows:0,paidProviderAllowed:false});
 const reconciled=await operation.reconcile(attempt);
 assert.equal(reconciled.status,'PASS');assert.equal(reconciled.evidence.receiptDigest,d('receipt'));
 assert.equal(reconciled.evidence.businessRowsChanged,0);assert.equal(reconciled.evidence.compensationComplete,true);
});

test('bounded writer operation blocks unavailable evidence and fails closed on unknown or unintended mutation',async()=>{
 const unavailable=createBoundedWriterE2eOperation({inspectAcceptance:async()=>null,runAcceptance:async()=>{}});
 assert.deepEqual(await unavailable.check(base),{status:'BLOCKED_EXTERNAL'});
 const invalid=createBoundedWriterE2eOperation({inspectAcceptance:async bound=>({schema:1,kind:'zola_bounded_writer_acceptance',...bound,
  capability:'buyer.writer.acceptance',mutationId:expectedMutation(bound),state:'COMPENSATED',businessRowsChanged:1,paidProviderCalls:0,
  receiptDigest:d('receipt'),compensationComplete:true,outcomeUnknown:false}),runAcceptance:async()=>{}});
 await assert.rejects(()=>invalid.reconcile(attempt),/operation rejected/);
 const unknown=createBoundedWriterE2eOperation({inspectAcceptance:async bound=>({schema:1,kind:'zola_bounded_writer_acceptance',...bound,
  capability:'buyer.writer.acceptance',mutationId:expectedMutation(bound),state:'COMPENSATED',businessRowsChanged:0,paidProviderCalls:0,
  receiptDigest:d('receipt'),compensationComplete:true,outcomeUnknown:true}),runAcceptance:async()=>{}});
 await assert.rejects(()=>unknown.reconcile(attempt),/operation rejected/);
});

function expectedMutation(bound){
 const normalized={releaseSha:bound.releaseSha,operationId:bound.operationId,workspace:bound.workspace,principal:bound.principal,
  attemptId:bound.attemptId,inputDigest:bound.inputDigest,checkOutputDigest:bound.checkOutputDigest};
 const bytes=createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
 return `${bytes.slice(0,8)}-${bytes.slice(8,12)}-4${bytes.slice(13,16)}-8${bytes.slice(17,20)}-${bytes.slice(20,32)}`;
}
