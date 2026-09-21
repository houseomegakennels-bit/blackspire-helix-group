import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {hash} from '../packages/zola-release/commander-journal.js';
import {RELEASE_STAGES,MUTATING_STAGES,RELEASE_REGISTRY_DIGEST} from '../packages/zola-release/commander-sequence.js';
import {createBoundedWriterAdmissionJournal} from '../packages/zola-release/bounded-writer-admission-journal.js';
import {createBuyerWriterAdmittedLocalClient} from '../packages/buyer-writer/admitted-local-client.js';
import {createBoundedWriterE2eOperation,inspectFixedWriterAcceptance,runFixedWriterAcceptance} from '../packages/zola-release/production-acl-writer.js';

function fixture(){
 const input={releaseSha:'a'.repeat(40),previousMainSha:'b'.repeat(40),recoverySha:'c'.repeat(40),
  protectedInputDigest:hash('protected'),workspace:'zola-production',principal:'blackspire-release-root',inputDigest:hash('input')};
 const operationId=randomUUID(),attemptId=randomUUID(),checkOutputDigest=hash('check');
 const start={schema:4,type:'sequence_started',operationId,...input,registryDigest:RELEASE_REGISTRY_DIGEST},events=[start];
 for(let ordinal=0;ordinal<9;ordinal++){
  const stage=RELEASE_STAGES[ordinal],id=MUTATING_STAGES.has(stage)?randomUUID():null;
  const inputDigest=hash({sequence:input.inputDigest,stage,ordinal,check:checkOutputDigest});
  const row={schema:4,operationId,ordinal,stage,attemptId:id,inputDigest,checkOutputDigest};
  if(id)events.push({...row,type:'sequence_stage_intent'});
  events.push({...row,type:'sequence_stage_confirmed',output:{ok:true},outputDigest:hash(JSON.stringify({ok:true}))});
 }
 const inputDigest=hash({sequence:input.inputDigest,stage:'bounded_writer_e2e',ordinal:9,check:checkOutputDigest});
 events.push({schema:4,type:'sequence_stage_intent',operationId,ordinal:9,stage:'bounded_writer_e2e',attemptId,inputDigest,checkOutputDigest});
 const bound={releaseSha:input.releaseSha,operationId,workspace:input.workspace,principal:input.principal,attemptId,inputDigest,checkOutputDigest};
 const stream={events:()=>structuredClone(events),append:row=>events.push(structuredClone(row))};
 const target={schema:1,kind:'zola_bounded_writer_acceptance_target',releaseSha:input.releaseSha,workspace:'blackspire-command',
  principal:input.principal,capability:'buyer.writer.acceptance',jobId:randomUUID(),ownerId:randomUUID(),
  criteria:{state:'GA',county:'Fulton',property_type:'all',date_range_start:'2000-01-01',date_range_end:'2000-01-01',
   min_purchases:1,cash_buyers_only:false,llc_buyers_only:false},updatedAt:'2026-09-11T12:34:56.123456Z'};
 const configuration={issuer:'zola-control',audience:'buyer-writer',subject:target.ownerId,keyId:'active',
  origin:'https://writer.example',releaseSha:input.releaseSha,operationId:randomUUID(),attemptId:randomUUID(),workspace:'blackspire-command'};
 const originals=[],receipts=new Map();let lost=null,denyRecovery=false,dispatchId;
 const open=async binding=>{assert.equal(binding.workspace,'blackspire-command');assert.equal(binding.releaseSha,input.releaseSha);
  assert.equal(binding.operationId,operationId);assert.equal(binding.principal,input.principal);return createBuyerWriterAdmittedLocalClient({configuration,
  signer:{sign:envelope=>({origin:configuration.origin,method:'POST',path:'/rest/v1/rpc/'+envelope.operation,
   body:JSON.stringify(envelope),token:'fixture-signature'})},
  client:{isHealthy:()=>true,close:async()=>{},checkAvailability:async()=>true,runtimeQuery:async()=>{throw Error('legacy');},
   admittedRequest:async request=>{
    const envelope=JSON.parse(request.body),p=envelope.parameters;
    if(envelope.operation==='recover'){
     if(denyRecovery)throw Error('recovery unavailable');
     const original=receipts.get(p.p_original_jti);
     if(!original)throw Error('unknown');
     return {status:200,body:{...original.result,automaticRetry:false,recovered:true,
      admissionCorrelation:{issuer:configuration.issuer,jti:p.p_original_jti,requestId:original.requestId,
       bodyDigest:original.bodyDigest,operation:original.operation,requestCorrelated:true}}};
    }
    const persisted=events.find(row=>row.type==='bounded_writer_admission_handle'&&row.handle.jti===envelope.jti);
    assert.ok(persisted,'journal must be durable before original dispatch');
    originals.push(envelope.operation);
    let result;
    if(envelope.operation==='issue'){dispatchId=p.p_request;result={dispatchId,generation:7};}
    else if(envelope.operation==='apply')result={ok:true,operation:'fail',chunkIndex:0};
    else if(envelope.operation==='reconcile')result={dispatchId,generation:7,state:'failed'};
    else if(envelope.operation==='receipt')result={found:true,receipt:{ok:true,operation:'fail',chunkIndex:0}};
    else throw Error('unexpected');
    receipts.set(envelope.jti,{result,operation:envelope.operation,requestId:envelope.requestId,bodyDigest:hash(request.body.toString())});
    if(lost===envelope.operation){denyRecovery=true;throw Error('lost ack');}
    return {status:200,body:{...result,automaticRetry:false}};
   }}});};
 const host={groupId:0,admissionJournal:stream,readAcceptanceSnapshot:()=>({value:target,identity:{}}),openAdmittedClient:open};
 const operation=()=>createBoundedWriterE2eOperation({inspectAcceptance:b=>inspectFixedWriterAcceptance(b,host),
  runAcceptance:r=>runFixedWriterAcceptance(r,host)});
 const call={input,state:{context:{operationId,releaseSha:input.releaseSha,workspace:input.workspace,principal:input.principal}},
  attemptId,inputDigest,checkOutputDigest};
 return {events,stream,bound,target,operation,call,originals,host,lose:value=>{lost=value;},restore:()=>{denyRecovery=false;}};
}

test('bounded writer persists actual client handles then recovers correlated original receipt chain',async()=>{
 const f=fixture();await f.operation().execute(f.call);
 const result=await f.operation().reconcile(f.call);
 assert.equal(result.status,'PASS');assert.equal(result.evidence.admittedGatewayReceiptAttemptId,f.bound.attemptId);
 assert.deepEqual(f.originals,['issue','apply','reconcile','receipt']);
 assert.equal(f.events.filter(row=>row.type==='bounded_writer_admission_handle').length,4);
 await f.operation().reconcile(f.call);
 assert.deepEqual(f.originals,['issue','apply','reconcile','receipt'],'fresh composition never redispatches originals');
});

test('lost apply acknowledgement survives new instance using original handle only',async()=>{
 const f=fixture();f.lose('apply');await assert.rejects(()=>f.operation().execute(f.call));
 assert.deepEqual(f.originals,['issue','apply']);f.restore();
 assert.equal((await f.operation().reconcile(f.call)).status,'PASS');
 assert.deepEqual(f.originals,['issue','apply','reconcile','receipt']);
});

test('lost reconcile acknowledgement survives fresh composition without redispatch',async()=>{
 const f=fixture();await f.operation().execute(f.call);f.lose('reconcile');
 assert.deepEqual(await f.operation().reconcile(f.call),{status:'BLOCKED_EXTERNAL'});
 assert.deepEqual(f.originals,['issue','apply','reconcile']);f.restore();
 assert.equal((await f.operation().reconcile(f.call)).status,'PASS');
 assert.deepEqual(f.originals,['issue','apply','reconcile','receipt']);
});

test('lost receipt acknowledgement survives fresh composition without redispatch',async()=>{
 const f=fixture();await f.operation().execute(f.call);f.lose('receipt');
 assert.deepEqual(await f.operation().reconcile(f.call),{status:'BLOCKED_EXTERNAL'});
 assert.deepEqual(f.originals,['issue','apply','reconcile','receipt']);f.restore();
 assert.equal((await f.operation().reconcile(f.call)).status,'PASS');
 assert.deepEqual(f.originals,['issue','apply','reconcile','receipt']);
});

test('lost issue acknowledgement cannot invent an apply witness',async()=>{
 const f=fixture();f.lose('issue');await assert.rejects(()=>f.operation().execute(f.call));
 f.restore();assert.deepEqual(await f.operation().reconcile(f.call),{status:'BLOCKED_EXTERNAL'});
 assert.equal(f.originals.filter(op=>op==='issue').length,1);assert.equal(f.originals.includes('apply'),false);
});

test('journal append failure prevents original dispatch',async()=>{
 const f=fixture();f.stream.append=()=>{throw Error('fsync failure');};
 await assert.rejects(()=>f.operation().execute(f.call));assert.deepEqual(f.originals,[]);
});

test('duplicate, tampered and cross-attempt handles fail closed before new mutation',async()=>{
 for(const fault of ['duplicate','digest','attempt','authority']){
  const f=fixture();await f.operation().execute(f.call);
  const row=f.events.find(e=>e.type==='bounded_writer_admission_handle');
  if(fault==='duplicate')f.events.push(structuredClone(row));
  if(fault==='digest')row.handleDigest='0'.repeat(64);
  if(fault==='attempt')row.attemptId=randomUUID();
  if(fault==='authority')row.handle.authority.releaseSha='b'.repeat(40);
  assert.throws(()=>createBoundedWriterAdmissionJournal(f.stream,f.bound));
  assert.deepEqual(await f.operation().reconcile(f.call),{status:'BLOCKED_EXTERNAL'});
  assert.deepEqual(f.originals,['issue','apply']);
 }
});

test('absent installed admitted opener blocks check before transport or mutation',async()=>{
 const f=fixture();delete f.host.openAdmittedClient;
 assert.deepEqual(await f.operation().check(f.call),{status:'BLOCKED_EXTERNAL'});
 assert.deepEqual(f.originals,[]);
});

test('writer target namespace stays distinct from release journal and rejects authority drift',async()=>{
 const f=fixture();await f.operation().execute(f.call);
 const handles=f.events.filter(row=>row.type==='bounded_writer_admission_handle');
 assert.ok(handles.length>0);
 for(const row of handles){assert.equal(row.workspace,'zola-production');assert.equal(row.handle.authority.workspace,'blackspire-command');}
 for(const [key,value] of [['workspace','zola-production'],['principal','another-principal'],['releaseSha','f'.repeat(40)]]){
  const denied=fixture();denied.target[key]=value;
  await assert.rejects(()=>denied.operation().execute(denied.call));
  assert.deepEqual(denied.originals,[]);
 }
});
