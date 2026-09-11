import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../packages/zola-release/commander-journal.js';
import {MUTATING_STAGES,RELEASE_REGISTRY_DIGEST,RELEASE_STAGES,inspectReleaseSequence} from '../packages/zola-release/commander-sequence.js';
import {HELD_ACCEPTANCE_CAPABILITIES,HELD_ACCEPTANCE_OPERATIONS} from '../packages/zola-release/held-acceptance-authority.js';
import {DIVISION_TABLES,compareDivisionSnapshots} from '../packages/zola-six-reads/database-observer.js';
import {createZeroProofProductionOperations} from '../packages/zola-release/production-zero-proofs.js';

const releaseSha='a'.repeat(40),previousMainSha='b'.repeat(40),recoverySha='c'.repeat(40);
const operationId='11111111-1111-4111-8111-111111111111',epochRunId='22222222-2222-4222-8222-222222222222';
const stageAttemptId='33333333-3333-4333-8333-333333333333',permitId='44444444-4444-4444-8444-444444444444';
const input={releaseSha,previousMainSha,recoverySha,protectedInputDigest:'1'.repeat(64),workspace:'zola-production',principal:'blackspire-release-root',inputDigest:'2'.repeat(64)};
const permissions=['seller.opportunities.read','buyer.profiles.read','buyer.matches.read','deal.records.read','deal.analysis.read','nexus.enrichment.read'];
const claims={schema:1,kind:'held-epoch-acceptance',permitId,commanderRunId:operationId,mergeMainSha:releaseSha,expectedDeploymentSha:releaseSha,
 epochRunId,workspace:input.workspace,principal:input.principal,apiGeneration:'d'.repeat(32),workerGeneration:'e'.repeat(32),issuedAt:1,expiresAt:1000,
 operations:[...HELD_ACCEPTANCE_OPERATIONS],reads:HELD_ACCEPTANCE_CAPABILITIES.map((capability,index)=>{
  const idempotencyKey=`zola-six:${epochRunId}:${index}`,request=`read ${index}`;
  return{index,idempotencyKey,capability,permission:permissions[index],request,
   requestDigest:hash({channel:'jarvis',workspaceId:input.workspace,text:request,idempotencyKey,executionIntent:'read_only'})};
 }),tokenDigest:'f'.repeat(64)};
const collectorHash='9'.repeat(64);

function heldEvents(stage){
 const rows=[{schema:1,type:'held_acceptance_mint_intent',claims,claimsDigest:hash(claims)},
  {schema:1,type:'held_acceptance_minted',permitId,claimsDigest:hash(claims)},
  {schema:1,type:'held_acceptance_consume_intent',permitId,claimsDigest:hash(claims)}];
 for(const operation of HELD_ACCEPTANCE_OPERATIONS.slice(0,HELD_ACCEPTANCE_OPERATIONS.indexOf(stage))){
  const evidence=operation==='six_live_reads'?{status:'PASS_LIVE_ACCEPTANCE',livePass:true,readCount:6,crossOwnerDenials:6,
   paidProviderCalls:0,mutationDelta:0,collectorDigest:collectorHash}:{status:'PASS',observationDigest:'8'.repeat(64)};
  const attemptId=`${String(5+rows.length).slice(-1).repeat(8)}-${String(5+rows.length).slice(-1).repeat(4)}-4aaa-8aaa-${String(5+rows.length).slice(-1).repeat(12)}`;
  rows.push({schema:1,type:'held_acceptance_operation_intent',permitId,claimsDigest:hash(claims),operation,attemptId});
  rows.push({schema:1,type:'held_acceptance_operation_result',permitId,claimsDigest:hash(claims),operation,attemptId,evidenceDigest:hash(evidence),evidence});
 }
 rows.push({schema:1,type:'held_acceptance_operation_intent',permitId,claimsDigest:hash(claims),operation:stage,attemptId:'77777777-7777-4777-8777-777777777777'});
 return rows;
}

function sequenceEvents(stage){
 const rows=[{schema:4,type:'sequence_started',operationId,...input,registryDigest:RELEASE_REGISTRY_DIGEST}];
 for(let ordinal=0;ordinal<RELEASE_STAGES.indexOf(stage);ordinal++){
  const name=RELEASE_STAGES[ordinal],checkOutputDigest=hash(`check-${name}`),stageInputDigest=hash({sequence:input.inputDigest,stage:name,ordinal,check:checkOutputDigest});
  const attemptId=MUTATING_STAGES.has(name)?`${String((ordinal%8)+1).repeat(8)}-${String((ordinal%8)+1).repeat(4)}-4aaa-8aaa-${String((ordinal%8)+1).repeat(12)}`:null;
  if(attemptId)rows.push({schema:4,type:'sequence_stage_intent',operationId,ordinal,stage:name,attemptId,inputDigest:stageInputDigest,checkOutputDigest});
  const output=name==='bounded_writer_e2e'?{boundedWriterAcceptance:true,businessRowsChanged:0,compensationComplete:true,receiptDigest:'7'.repeat(64)}
   :name==='capture_new_main_sha'?{newMainSha:releaseSha}:{complete:true,stage:name};
  rows.push({schema:4,type:'sequence_stage_confirmed',operationId,ordinal,stage:name,attemptId,inputDigest:stageInputDigest,checkOutputDigest,
   outputDigest:hash(JSON.stringify(output)),output});
 }
 const ordinal=RELEASE_STAGES.indexOf(stage),checkOutputDigest=hash(`check-${stage}`),stageInputDigest=hash({sequence:input.inputDigest,stage,ordinal,check:checkOutputDigest});
 rows.push({schema:4,type:'sequence_stage_intent',operationId,ordinal,stage,attemptId:stageAttemptId,inputDigest:stageInputDigest,checkOutputDigest});
 return rows;
}

function snapshot(phase,changed=false){
 return{version:1,releaseSha,runId:'collector-run',phase,capturedAt:phase==='before'?'2026-09-11T10:00:00Z':'2026-09-11T10:01:00Z',
  database:'postgres',role:'postgres',readOnly:true,primary:true,bypassRls:true,ordinaryTables:15,
  tables:DIVISION_TABLES.map((name,index)=>({name,rows:index===0&&changed?2:1,digest:index===0&&changed?'6'.repeat(64):'4'.repeat(64),version_digest:'5'.repeat(64)}))};
}
function owner(phase){return{version:1,releaseSha,runId:'collector-run',phase,capturedAt:phase==='before'?'2026-09-11T10:00:00Z':'2026-09-11T10:01:00Z',
 database:'postgres',role:'authenticated',readOnly:true,witness:'3'.repeat(64),realDistinctUsers:true,ownVisible:1,foreignVisible:0};}
function collectorSource({changed=false,tupleChanged=false}={}){
 const before=snapshot('before'),after=snapshot('after',changed);
 if(tupleChanged)after.tables[0].version_digest='6'.repeat(64);
 let evidence=null;if(!changed&&!tupleChanged)evidence=compareDivisionSnapshots(before,after,{releaseSha,runId:'collector-run'});
 return{reportDigest:collectorHash,events:[{type:'run',binding:'x',releaseSha},...HELD_ACCEPTANCE_CAPABILITIES.map((_,index)=>({type:'intent',index,key:`zola-six:${epochRunId}:${index}`,requestDigest:'1'.repeat(64),generation:{}})),
  ...HELD_ACCEPTANCE_CAPABILITIES.map((_,index)=>({type:'collected',index,taskId:`task-${index}`,evidenceDigest:'2'.repeat(64)})),
  {type:'database_before',observation:{owner:owner('before'),snapshot:before},generation:{}},
  {type:'database_after',observation:{owner:owner('after'),snapshot:after},evidence:evidence&&{...evidence,ownerDenial:'PASS',ownerScope:'SearchJob'}},
  {type:'report',digest:collectorHash,status:'PASS_LIVE_ACCEPTANCE'}]};
}
function commandEvidence({paid=false,extraAttempt=false}={}){
 const tasks=HELD_ACCEPTANCE_CAPABILITIES.map((_,index)=>({id:`task-${index}`,workspace_id:input.workspace,actor_id:input.principal,status:'completed',idempotency_key:`unified:jarvis:zola-six:${epochRunId}:${index}`}));
 const attempts=HELD_ACCEPTANCE_CAPABILITIES.map((mode,index)=>({id:`attempt-${index}`,task_id:`task-${index}`,provider:'blackspire-capability',mode,status:'completed'}));
 if(extraAttempt)attempts.push({id:'extra',task_id:'task-0',provider:'paid',mode:'x',status:'completed'});
 return{tasks,attempts,usage:attempts.slice(0,6).map((row,index)=>({attempt_id:row.id,task_id:row.task_id,provider:'blackspire-capability',cost_cents:paid&&index===5?1:0,monetary_cost_state:'settled'})),databaseIdentity:{device:1,inode:2}};
}
function fixture(stage,deps){
 const events=[...sequenceEvents(stage),...heldEvents(stage)],stream={events:()=>structuredClone(events)};
 const context={input,journal:{stream:()=>stream}},state=inspectReleaseSequence(events);
 const call={input,state,ordinal:RELEASE_STAGES.indexOf(stage),attemptId:stageAttemptId,inputDigest:state.pending.inputDigest,checkOutputDigest:state.pending.checkOutputDigest};
 return{operation:createZeroProofProductionOperations(context,deps)[stage],call,context};
}

test('zero paid Nexus reconciles exact acceptance tasks against authoritative usage rows',async()=>{
 const {operation,call}=fixture('zero_paid_nexus',{readCollector:async()=>collectorSource(),readUsage:async()=>commandEvidence()});
 assert.equal((await operation.check({...call,attemptId:undefined,inputDigest:undefined,checkOutputDigest:undefined})).status,'PASS');
 operation.execute(call);const result=await operation.reconcile(call);
 assert.equal(result.status,'PASS');assert.equal(result.evidence.paidProviderCalls,0);assert.equal(result.evidence.operationId,operationId);
 assert.equal(result.evidence.stageAttemptId,stageAttemptId);assert.equal(result.evidence.workspace,input.workspace);
 assert.match(result.evidence.usageDigest,/^[a-f0-9]{64}$/);
});

test('zero paid Nexus fails closed on paid or additional provider attempts',async()=>{
 for(const raw of [commandEvidence({paid:true}),commandEvidence({extraAttempt:true})]){
  const {operation,call}=fixture('zero_paid_nexus',{readCollector:async()=>collectorSource(),readUsage:async()=>raw});
 await assert.rejects(()=>operation.reconcile(call),/rejected/);
 }
 const unavailable=fixture('zero_paid_nexus',{readCollector:async()=>null,readUsage:async()=>commandEvidence()});
 assert.deepEqual(await unavailable.operation.reconcile(unavailable.call),{status:'BLOCKED_EXTERNAL'});
});

test('zero unintended mutation verifies authoritative content and tuple-version snapshots plus declared release changes',async()=>{
 const {operation,call}=fixture('zero_unintended_mutation',{readCollector:async()=>collectorSource(),readUsage:async()=>commandEvidence()});
 operation.execute(call);const result=await operation.reconcile(call);
 assert.equal(result.status,'PASS');assert.equal(result.evidence.mutationDelta,0);assert.equal(result.evidence.unknownDelta,false);
 assert.equal(result.evidence.unexpectedBusinessRows,0);assert.equal(result.evidence.crossOwnerChanges,0);assert.equal(result.evidence.enrichmentChanges,0);
 assert.match(result.evidence.mutationDigest,/^[a-f0-9]{64}$/);assert.match(result.evidence.allowedChangesDigest,/^[a-f0-9]{64}$/);
});

test('mutation proof rejects changed rows, tuple versions, unknown evidence and wrong outer attempt',async()=>{
 const changed=collectorSource({changed:true}),fixtureChanged=fixture('zero_unintended_mutation',{readCollector:async()=>changed,readUsage:async()=>commandEvidence()});
 await assert.rejects(()=>fixtureChanged.operation.reconcile(fixtureChanged.call),/DIVISION_ROWS_CHANGED|rejected/);
 const tuple=fixture('zero_unintended_mutation',{readCollector:async()=>collectorSource({tupleChanged:true}),readUsage:async()=>commandEvidence()});
 await assert.rejects(()=>tuple.operation.reconcile(tuple.call),/DIVISION_ROWS_CHANGED|rejected/);
 const unavailable=fixture('zero_unintended_mutation',{readCollector:async()=>null,readUsage:async()=>commandEvidence()});
 assert.deepEqual(await unavailable.operation.reconcile(unavailable.call),{status:'BLOCKED_EXTERNAL'});
 assert.throws(()=>unavailable.operation.reconcile({...unavailable.call,attemptId:'wrong'}),/rejected/);
});
