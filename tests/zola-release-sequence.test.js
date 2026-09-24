import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {RELEASE_STAGES,MUTATING_STAGES,inspectReleaseSequence,runReleaseSequence} from '../packages/zola-release/commander-sequence.js';

import {createHeldProductionOperations} from '../packages/zola-release/production-held-operations.js';
import {createProviderAclCheckOperation,PROVIDER_ACL_FUNCTIONS} from '../packages/zola-release/production-acl-writer.js';

const releaseSha='a'.repeat(40),previousMainSha='b'.repeat(40),recoverySha='c'.repeat(40),newMainSha='d'.repeat(40);
const protectedInputDigest='e'.repeat(64),workspace='zola-production',principal='blackspire-release-root';
const input={releaseSha,previousMainSha,recoverySha,protectedInputDigest,workspace,principal,inputDigest:createHash('sha256').update(JSON.stringify({releaseSha,previousMainSha,recoverySha,protectedInputDigest,workspace,principal})).digest('hex')};
function journal(events=[]){return{events,stream:()=>({events:()=>structuredClone(events),append:row=>events.push(structuredClone(row))})};}
function adapters(calls,{throwStage}={}){
 return Object.fromEntries(RELEASE_STAGES.map(stage=>[stage,{check:async()=>{calls.push('check:'+stage);return{status:'PASS',evidence:{stage,checked:true}};},
  execute:async()=>{calls.push('execute:'+stage);if(stage===throwStage)throw new Error('unknown');},
  reconcile:async()=>{calls.push('reconcile:'+stage);return{status:'PASS',evidence:stage==='guarded_held_to_open'?{open:true,newMainSha}:stage==='capture_new_main_sha'?{newMainSha}:{stage,reconciled:true}};},
  observe:async()=>{calls.push('observe:'+stage);return{status:'PASS',evidence:stage==='capture_new_main_sha'?{newMainSha}:stage==='guarded_held_to_open'?{open:true,newMainSha}:{stage,observed:true}};}}]));
}
function coldStartFixture({isolation=true,catalogError=false,activationError=false}={}){
 const j=journal(),calls=[],set=adapters(calls);
 const host={roles:false,active:false,writerBound:false,activations:0,isolation,catalogError,catalogReads:0};
 const proof={artifactDigest:'6'.repeat(64),api:{generation:'1'.repeat(32)},worker:{generation:'2'.repeat(32)}};
 const held=createHeldProductionOperations({input,journal:j,release:{activationConfigurationFile:'/protected/activation.json'}},{
  async activate(){
   if(activationError)throw new Error('bootstrap refused');
   if(!host.roles){assert.equal(host.active,false);host.roles=true;host.activations++;}
  },
  async establishHeld(){
   assert.equal(host.roles,true);host.active=true;
   return {status:'HELD_LIFECYCLE_OBSERVED',releaseSha,
    runId:'22222222-2222-4222-8222-222222222222',proof};
  },
  async lifecycle(){assert.equal(host.active,true);return proof;},
  async ensureWriterBinding(bound){
   assert.equal(host.active,true);assert.equal(bound.releaseSha,releaseSha);
   assert.equal(bound.stage,'admission_lease');
   const pending=inspectReleaseSequence(j.events).pending;
   assert.equal(bound.attemptId,pending.attemptId);assert.equal(bound.inputDigest,pending.inputDigest);
   assert.equal(bound.checkOutputDigest,pending.checkOutputDigest);
   host.writerBound=true;calls.push('writer-binding');
   return {status:'HELD_WRITER_BINDING_VERIFIED',releaseSha};
  },
 });
 set.admission_lease=held.admission_lease;
 set.generation_revalidation=held.generation_revalidation;
 set.provider_acl_check=createProviderAclCheckOperation({
  query:async()=>{
   assert.equal(host.writerBound,true);calls.push('catalog');
   host.catalogReads++;
   if(!host.roles||host.catalogError===true||host.catalogError==='second'&&host.catalogReads===2)
    throw new Error('catalog unavailable');
   return {rows:PROVIDER_ACL_FUNCTIONS.map(functionName=>({functionName,arguments:'',
    owner:'supabase_admin',publicExecute:false,ownerExecute:true,postgresExecute:true,
    serviceRoleExecute:true,writerExecute:false}))};
  },
  isolationProof:async()=>host.active&&host.isolation?{status:'PASS',evidence:{
   pgNetIsolationVerified:true,applicationDbCredentialsAbsent:true,gatewayTransportVerified:true,
   arbitrarySqlDenied:true,arbitraryFunctionDenied:true,arbitraryUrlDenied:true,
   applicationPgNetCallSitesZero:true,applicationDbPgNetReferencesZero:true,
   applicationPgNetCallSiteCount:0,applicationDbPgNetReferenceCount:0,
   sourceScanDigest:'b'.repeat(64),functionBodyDigest:'c'.repeat(64),
  }}:{status:'BLOCKED_EXTERNAL'},
 });
 // Stop before any downstream mutation; these are simulated hosts, not live acceptance.
 set.n8n_migration.check=async()=>({status:'BLOCKED_EXTERNAL'});
 return {j,calls,set,host};
}
test('cold start provisions and establishes HELD before full provider isolation observation',async()=>{
 const f=coldStartFixture();
 const result=await runReleaseSequence({input,journal:f.j,adapters:f.set});
 assert.equal(result.stage,'n8n_migration');
 assert.equal(f.host.activations,1);assert.equal(f.host.active,true);
 assert.ok(f.calls.indexOf('writer-binding')<f.calls.indexOf('catalog'));
 const observed=inspectReleaseSequence(f.j.events);
 assert.equal(observed.outputs.admission_lease.intakeOpen,false);
 assert.equal(observed.outputs.provider_acl_check.pgNetIsolationVerified,true);
 assert.equal(f.calls.includes('execute:n8n_migration'),false);
 assert.equal(observed.outputs.guarded_held_to_open,undefined);
});
test('failed post-HELD catalog or runtime isolation blocks every downstream effect and resumes without activation replay',async()=>{
 for(const options of [{isolation:false},{catalogError:true},{catalogError:'second'}]){
  const f=coldStartFixture(options);
  let result=await runReleaseSequence({input,journal:f.j,adapters:f.set});
  assert.equal(result.stage,'provider_acl_check');assert.equal(result.releaseState,'BLOCKED_EXTERNAL');
  assert.equal(result.mutationSent,true);assert.equal(f.host.activations,1);
  assert.equal(inspectReleaseSequence(f.j.events).outputs.admission_lease.intakeOpen,false);
  for(const stage of ['n8n_migration','bounded_writer_e2e','production_migrations','guarded_held_to_open'])
   assert.equal(f.calls.some(value=>value.endsWith(':'+stage)),false);
  f.host.isolation=true;f.host.catalogError=false;
  result=await runReleaseSequence({input,journal:f.j,adapters:f.set});
  assert.equal(result.stage,'n8n_migration');assert.equal(f.host.activations,1);
 }
});
test('failed bootstrap never reaches provider observation or downstream effects',async()=>{
 const f=coldStartFixture({activationError:true});
 const result=await runReleaseSequence({input,journal:f.j,adapters:f.set});
 assert.equal(result.stage,'admission_lease');assert.equal(result.mutationSent,null);
 assert.equal(f.calls.includes('catalog'),false);assert.equal(f.host.active,false);
 assert.equal(inspectReleaseSequence(f.j.events).outputs.guarded_held_to_open,undefined);
});
test('prior ordering journals fail closed without replay or ordinal reinterpretation',async()=>{
 const f=coldStartFixture();await runReleaseSequence({input,journal:f.j,adapters:f.set});
 const legacyStages=[...RELEASE_STAGES].filter(stage=>stage!=='provider_acl_check');
 legacyStages.splice(3,0,'provider_acl_check');
 const legacyDigest=createHash('sha256').update(JSON.stringify(legacyStages.map((stage,ordinal)=>({
  ordinal,stage,mutating:MUTATING_STAGES.has(stage),
 })))).digest('hex');
 const rows=structuredClone(f.j.events);rows[0].registryDigest=legacyDigest;
 assert.throws(()=>inspectReleaseSequence(rows));
 const calls=[],result=await runReleaseSequence({input,journal:journal(rows),adapters:adapters(calls)});
 assert.equal(result.releaseState,'FAIL_CLOSED');assert.deepEqual(calls,[]);
});
test('registry is exact, frozen, unique and contains 34 ordered stages',()=>{
 assert.equal(RELEASE_STAGES.length,34);assert.equal(new Set(RELEASE_STAGES).size,34);assert.ok(Object.isFrozen(RELEASE_STAGES));
 assert.equal(MUTATING_STAGES.size,22);assert.ok(MUTATING_STAGES.has('admission_lease'));assert.ok(MUTATING_STAGES.has('expected_head_merge'));assert.ok(MUTATING_STAGES.has('guarded_held_to_open'));
 for(const stage of ['api_health','worker_readiness','generation_fence','six_live_reads','production_smoke','zero_paid_nexus','zero_unintended_mutation','rollback_verification'])assert.ok(MUTATING_STAGES.has(stage));
 assert.equal(MUTATING_STAGES.add,undefined);assert.throws(()=>{MUTATING_STAGES.size=0;});
});
test('runner rejects missing or extra adapters before any stage dispatch',async()=>{
 for(const mutate of [set=>delete set.exact_sha_verification,set=>set.placeholder={check(){},observe(){}}]){
  const j=journal(),calls=[],set=adapters(calls);mutate(set);const result=await runReleaseSequence({input,journal:j,adapters:set});
  assert.equal(result.releaseState,'FAIL_CLOSED');assert.deepEqual(calls,[]);assert.deepEqual(j.events,[]);
 }
});
test('all 34 stages persist once and a completed resume dispatches nothing',async()=>{
 const j=journal(),calls=[];const result=await runReleaseSequence({input,journal:j,adapters:adapters(calls)});
 assert.equal(result.status,'COMPLETE');assert.equal(result.newMainSha,newMainSha);
 assert.equal(j.events.filter(row=>row.type==='sequence_stage_confirmed').length,34);
 assert.equal(j.events.filter(row=>row.type==='sequence_stage_intent').length,MUTATING_STAGES.size);
 const before=calls.length;assert.equal((await runReleaseSequence({input,journal:j,adapters:adapters(calls)})).status,'COMPLETE');assert.equal(calls.length,before);
 assert.equal(inspectReleaseSequence(j.events).nextOrdinal,34);
});
test('unknown mutation resumes by observation without resending effect',async()=>{
 const j=journal(),calls=[],stage='n8n_migration';
 let result=await runReleaseSequence({input,journal:j,adapters:adapters(calls,{throwStage:stage})});
 assert.equal(result.reason,'MUTATION_OUTCOME_UNKNOWN');assert.equal(result.mutationSent,null);assert.equal(calls.filter(value=>value==='execute:'+stage).length,1);
 result=await runReleaseSequence({input,journal:j,adapters:adapters(calls)});
 assert.equal(result.status,'COMPLETE');assert.equal(calls.filter(value=>value==='execute:'+stage).length,1);assert.equal(calls.filter(value=>value==='check:'+stage).length,1);assert.equal(calls.filter(value=>value==='reconcile:'+stage).length,1);
});
test('immediate and restarted reconciliation receive identical durable attempt bindings',async()=>{
 const j=journal(),seen=[];
 const set=adapters([]);set.n8n_migration.execute=async value=>seen.push(['execute',value]);set.n8n_migration.reconcile=async value=>{seen.push(['reconcile',value]);return{status:'PASS',evidence:{stage:'n8n_migration'}};};
 await runReleaseSequence({input,journal:j,adapters:set});
 const immediate=seen.find(([kind])=>kind==='reconcile')[1],intent=j.events.find(row=>row.type==='sequence_stage_intent'&&row.stage==='n8n_migration');
 assert.equal(immediate.state.pending.attemptId,intent.attemptId);assert.equal(immediate.inputDigest,intent.inputDigest);assert.equal(immediate.checkOutputDigest,intent.checkOutputDigest);
 const pending=journal(j.events.slice(0,j.events.indexOf(intent)+1)),restarted=[];const resumed=adapters([]);resumed.n8n_migration.reconcile=async value=>{restarted.push(value);return{status:'PASS',evidence:{stage:'n8n_migration'}};};
 await runReleaseSequence({input,journal:pending,adapters:resumed});
 assert.equal(restarted[0].inputDigest,immediate.inputDigest);assert.equal(restarted[0].checkOutputDigest,immediate.checkOutputDigest);assert.equal(restarted[0].state.pending.attemptId,intent.attemptId);
});
test('malformed, reordered, mixed-operation and secret-bearing evidence fail closed',async()=>{
 for(const mutate of [
  rows=>rows[0].schema=3,
  rows=>rows[1].ordinal=2,
  rows=>rows[1].operationId='12345678-1234-4234-8234-123456789abc',
  rows=>rows[2].outputDigest='0'.repeat(64),
  rows=>rows.find(row=>row.type==='sequence_stage_confirmed'&&!MUTATING_STAGES.has(row.stage)).checkOutputDigest='0'.repeat(64),
 ]){
  const j=journal(),calls=[];await runReleaseSequence({input,journal:j,adapters:adapters(calls)});const rows=structuredClone(j.events);mutate(rows);
  assert.throws(()=>inspectReleaseSequence(rows));
 }
 const j=journal(),bad=adapters([]);bad.exact_sha_verification.observe=async()=>({status:'PASS',evidence:{apiToken:'never'}});
 const result=await runReleaseSequence({input,journal:j,adapters:bad});assert.equal(result.status,'STOPPED');assert.ok(!JSON.stringify(j.events).includes('never'));
});
test('external block records no mutation intent and remains resumable',async()=>{
 const j=journal(),calls=[],set=adapters(calls);set.vercel_exact_head_preview.check=async()=>({status:'BLOCKED_EXTERNAL'});
 const result=await runReleaseSequence({input,journal:j,adapters:set});assert.equal(result.reason,'EXTERNAL_GATE');assert.equal(result.mutationSent,false);
 assert.equal(inspectReleaseSequence(j.events).nextOrdinal,2);
 assert.equal(j.events.at(-1).type,'sequence_stopped');assert.equal(j.events.at(-1).releaseState,'BLOCKED_EXTERNAL');
});

test('a new exact head may supersede a stopped observation-only prefix but never a mutation intent',async()=>{
 const j=journal(),firstSet=adapters([]);firstSet.receiver_audit.check=async()=>({status:'BLOCKED_EXTERNAL'});
 const first=await runReleaseSequence({input,journal:j,adapters:firstSet});
 assert.equal(first.stage,'receiver_audit');assert.equal(inspectReleaseSequence(j.events).nextOrdinal,1);
 const nextIdentity={...input,releaseSha:'f'.repeat(40),protectedInputDigest:'1'.repeat(64)};
 nextIdentity.inputDigest=createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(nextIdentity).filter(([key])=>key!=='inputDigest')))).digest('hex');
 const secondSet=adapters([]);secondSet.receiver_audit.check=async()=>({status:'BLOCKED_EXTERNAL'});
 const second=await runReleaseSequence({input:nextIdentity,journal:j,adapters:secondSet});
 assert.equal(second.stage,'receiver_audit');assert.equal(inspectReleaseSequence(j.events).context.releaseSha,nextIdentity.releaseSha);
 assert.equal(j.events.filter(row=>row.type==='sequence_started').length,2);
});

test('a pre-effect exact-SHA software failure can be superseded without discarding its audit trail',async()=>{
 const j=journal(),failed=adapters([]);failed.exact_sha_verification.check=async()=>{throw new Error('adapter bug');};
 const first=await runReleaseSequence({input,journal:j,adapters:failed});
 assert.equal(first.stage,'exact_sha_verification');assert.equal(first.mutationSent,false);
 const nextIdentity={...input,releaseSha:'f'.repeat(40),protectedInputDigest:'1'.repeat(64)};
 nextIdentity.inputDigest=createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(nextIdentity).filter(([key])=>key!=='inputDigest')))).digest('hex');
 const second=await runReleaseSequence({input:nextIdentity,journal:j,adapters:adapters([])});
 assert.equal(second.status,'COMPLETE');assert.equal(inspectReleaseSequence(j.events).context.releaseSha,nextIdentity.releaseSha);
 assert.equal(j.events.filter(row=>row.type==='sequence_started').length,2);
 const progressed=journal(),calls=[];await runReleaseSequence({input,journal:progressed,adapters:adapters(calls)});
 assert.equal((await runReleaseSequence({input:nextIdentity,journal:progressed,adapters:adapters([])})).releaseState,'FAIL_CLOSED');
});

test('external block while reconciling a durable mutation intent preserves unknown outcome',async()=>{
 const j=journal(),calls=[],stage='n8n_migration';
 await runReleaseSequence({input,journal:j,adapters:adapters(calls,{throwStage:stage})});
 const set=adapters(calls);set[stage].reconcile=async()=>({status:'BLOCKED_EXTERNAL'});
 const result=await runReleaseSequence({input,journal:j,adapters:set});
 assert.equal(result.releaseState,'BLOCKED_EXTERNAL');assert.equal(result.mutationSent,null);
 assert.equal(inspectReleaseSequence(j.events).pending.stage,stage);
});

test('completed proof and final OPEN binding are recomputed before fast-path success',async()=>{
 const j=journal(),calls=[];await runReleaseSequence({input,journal:j,adapters:adapters(calls)});
 for(const mutate of [
  rows=>rows.at(-1).resultDigest='0'.repeat(64),
  rows=>rows.at(-1).newMainSha='e'.repeat(40),
  rows=>rows.find(row=>row.type==='sequence_stage_confirmed'&&row.stage==='guarded_held_to_open').output.open=false,
 ]){
  const rows=structuredClone(j.events);mutate(rows);assert.throws(()=>inspectReleaseSequence(rows));
  assert.equal((await runReleaseSequence({input,journal:journal(rows),adapters:adapters([])})).status,'STOPPED');
 }
});


test('prepared operation identity starts and resumes exactly, while mismatched or reused authority appends nothing',async()=>{
 const requestedOperationId='11111111-1111-4111-8111-111111111111',j=journal(),calls=[],set=adapters(calls);
 set.exact_sha_verification.check=async()=>({status:'BLOCKED_EXTERNAL'});
 await runReleaseSequence({input,journal:j,adapters:set,requestedOperationId});assert.equal(j.events[0].operationId,requestedOperationId);
 await runReleaseSequence({input,journal:j,adapters:set,requestedOperationId});assert.equal(j.events.filter(e=>e.type==='sequence_started').length,1);
 const before=JSON.stringify(j.events);
 for(const id of ['invalid','22222222-2222-4222-8222-222222222222']){await runReleaseSequence({input,journal:j,adapters:set,requestedOperationId:id});assert.equal(JSON.stringify(j.events),before);}
 const changed={...input,protectedInputDigest:'f'.repeat(64)};const {inputDigest:unused,...body}=changed;changed.inputDigest=createHash('sha256').update(JSON.stringify(body)).digest('hex');
 await runReleaseSequence({input:changed,journal:j,adapters:set,requestedOperationId});assert.equal(JSON.stringify(j.events),before);
});
