import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PROVIDER_ACL_CHECK_SQL,PROVIDER_ACL_FUNCTIONS,WRITER_ACCEPTANCE_TARGET_FILE,createProviderAclCheckOperation,createBoundedWriterE2eOperation}
 from '../packages/zola-release/production-acl-writer.js';
import {createFixedProductionOperations} from '../packages/zola-release/production-adapters.js';

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

test('fixed production composition uses the real buyer-writer host protocol and reconciles response loss',async()=>{
 const secrets=[1,2,3,4].map(byte=>Buffer.alloc(32,byte).toString('base64url'));
 const config={version:1,workspace:'blackspire-command',bindingFile:'/etc/blackspire/buyer-writer-binding.json',
  writerCredential:secrets[0],issuerCredential:secrets[1],
  runtime:{host:'db.kchtrvfcixnimvxxctkj.supabase.co',port:5432,database:'postgres',password:secrets[2]},
  issuer:{host:'db.kchtrvfcixnimvxxctkj.supabase.co',port:5432,database:'postgres',password:secrets[3]}};
 const snapshot=Object.freeze({value:config,identity:Object.freeze({uid:0,gid:0,mode:33152,nlink:1,size:1,dev:1,ino:1,mtimeMs:1,ctimeMs:1})});
 const target={schema:1,kind:'zola_bounded_writer_acceptance_target',releaseSha:a,workspace:base.input.workspace,principal:base.input.principal,
  capability:'buyer.writer.acceptance',jobId:'33333333-3333-4333-8333-333333333333',ownerId:'44444444-4444-4444-8444-444444444444',
  criteria:{state:'GA',county:'Fulton',property_type:'all',date_range_start:'2000-01-01',date_range_end:'2000-01-01',min_purchases:1,
   cash_buyers_only:false,llc_buyers_only:false},updatedAt:'2026-09-11T12:34:56.123456Z'};
 const targetSnapshot=Object.freeze({value:target,identity:Object.freeze({uid:0,gid:0,mode:33152,nlink:1,size:1,dev:2,ino:2,mtimeMs:2,ctimeMs:2})});
 let dispatchId,generation=7,state='absent',applyCalls=0,reconcileCalls=0,closed=0;
 const openDatabase=async()=>({isHealthy:()=>true,close:async()=>{closed++;},
  issuerQuery:async(sql,values)=>{
   if(sql.includes('.issue(')){
    assert.equal(values[0],target.jobId);assert.equal(values[1],target.ownerId);assert.equal(values[6],target.updatedAt);
    assert.deepEqual(JSON.parse(values[5]),target.criteria);dispatchId=values[7];state='pending';return{rows:[{result:{dispatchId,generation}}]};
   }
   assert.ok(sql.includes('.reconcile('));reconcileCalls++;
   assert.equal(values[0],target.jobId);assert.equal(values[1],target.ownerId);assert.equal(values[4],target.updatedAt);
   if(state==='pending')state='cancelled';
   return{rows:[{result:{dispatchId:values[3],generation:state==='absent'?null:generation,state}}]};
  },
  runtimeQuery:async(sql,values)=>{
   if(sql.includes('.apply(')){applyCalls++;state='failed';return{rows:[{result:{ok:true,operation:'fail',chunkIndex:0}}]};}
   assert.ok(sql.includes('.receipt('));assert.equal(values[5],'fail');
   return{rows:[{result:{found:true,receipt:{ok:true,operation:'fail',chunkIndex:0}}}]};
  }});
 const input={...base.input,previousMainSha:'b'.repeat(40),recoverySha:'c'.repeat(40),protectedInputDigest:d('protected'),inputDigest:d('sequence')};
 const stateFor=(pending=false)=>({context:{operationId,releaseSha:a,workspace:input.workspace,principal:input.principal},...(pending?{pending:{attemptId,inputDigest:d('input'),checkOutputDigest:d('check')}}:{})});
 const context={input,release:{releaseSha:a,activationConfigurationFile:'/fixed/activation.json'},journal:{stream:()=>({events:()=>[],append(){}})}};
 const writerHost={groupId:0,readSnapshot:()=>snapshot,readAcceptanceSnapshot:file=>{
  assert.equal(file,WRITER_ACCEPTANCE_TARGET_FILE);return targetSnapshot;
 },openDatabase};
 const operation=createFixedProductionOperations(context,{writerHost}).bounded_writer_e2e;
 const checked=await operation.check({input,state:stateFor(),ordinal:9});
 assert.equal(checked.status,'PASS');assert.equal(checked.evidence.writerPrepared,true);
 const call={input,state:stateFor(true),ordinal:9,attemptId,inputDigest:d('input'),checkOutputDigest:d('check')};
 await operation.execute(call);
 const observed=await operation.reconcile(call);
 assert.equal(observed.status,'PASS');assert.equal(observed.evidence.businessRowsChanged,0);assert.equal(observed.evidence.paidProviderCalls,0);
 assert.equal(observed.evidence.compensationComplete,true);assert.match(observed.evidence.receiptDigest,/^[a-f0-9]{64}$/);
 assert.equal(applyCalls,1);assert.equal(reconcileCalls,1);assert.equal(closed,3);

 state='absent';dispatchId=undefined;generation=8;applyCalls=0;reconcileCalls=0;
 const lossyDatabase=async()=>({...(await openDatabase()),runtimeQuery:async(sql)=>{
  if(sql.includes('.apply(')){applyCalls++;throw new Error('response lost');}
  throw new Error('receipt must not be queried for cancellation');
 }});
 const lossy=createFixedProductionOperations(context,{writerHost:{...writerHost,openDatabase:lossyDatabase}}).bounded_writer_e2e;
 await lossy.execute(call);
 const compensated=await lossy.reconcile(call);
 assert.equal(compensated.status,'PASS');assert.equal(compensated.evidence.compensationComplete,true);
 assert.equal(applyCalls,1);assert.equal(reconcileCalls,2);

 state='absent';dispatchId=undefined;applyCalls=0;reconcileCalls=0;
 const missingDatabase=async()=>{
  const database=await openDatabase();
  return{...database,issuerQuery:async(sql,values)=>{
   if(sql.includes('.issue('))throw new Error('acceptance job missing');
   assert.ok(sql.includes('.reconcile('));reconcileCalls++;
   return{rows:[{result:{dispatchId:values[3],generation:null,state:'absent'}}]};
  }};
 };
 const missing=createFixedProductionOperations(context,{writerHost:{...writerHost,openDatabase:missingDatabase}}).bounded_writer_e2e;
 await assert.rejects(()=>missing.execute(call),/outcome unknown/);
 assert.deepEqual(await missing.reconcile(call),{status:'BLOCKED_EXTERNAL'});
 assert.equal(applyCalls,0);assert.equal(reconcileCalls,2);
});

function expectedMutation(bound){
 const normalized={releaseSha:bound.releaseSha,operationId:bound.operationId,workspace:bound.workspace,principal:bound.principal,
  attemptId:bound.attemptId,inputDigest:bound.inputDigest,checkOutputDigest:bound.checkOutputDigest};
 const bytes=createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
 return `${bytes.slice(0,8)}-${bytes.slice(8,12)}-4${bytes.slice(13,16)}-8${bytes.slice(17,20)}-${bytes.slice(20,32)}`;
}
