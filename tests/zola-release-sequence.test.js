import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {RELEASE_STAGES,MUTATING_STAGES,inspectReleaseSequence,runReleaseSequence} from '../packages/zola-release/commander-sequence.js';

const releaseSha='a'.repeat(40),previousMainSha='b'.repeat(40),recoverySha='c'.repeat(40),newMainSha='d'.repeat(40);
const input={releaseSha,previousMainSha,recoverySha,inputDigest:createHash('sha256').update(JSON.stringify({releaseSha,previousMainSha,recoverySha})).digest('hex')};
function journal(events=[]){return{events,stream:()=>({events:()=>structuredClone(events),append:row=>events.push(structuredClone(row))})};}
function adapters(calls,{throwStage}={}){
 return Object.fromEntries(RELEASE_STAGES.map(stage=>[stage,{check:async()=>{calls.push('check:'+stage);return{status:'PASS',evidence:{stage,checked:true}};},
  execute:async()=>{calls.push('execute:'+stage);if(stage===throwStage)throw new Error('unknown');},
  reconcile:async()=>{calls.push('reconcile:'+stage);return{status:'PASS',evidence:stage==='guarded_held_to_open'?{open:true,newMainSha}:stage==='capture_new_main_sha'?{newMainSha}:{stage,reconciled:true}};},
  observe:async()=>{calls.push('observe:'+stage);return{status:'PASS',evidence:stage==='capture_new_main_sha'?{newMainSha}:stage==='guarded_held_to_open'?{open:true,newMainSha}:{stage,observed:true}};}}]));
}
test('registry is exact, frozen, unique and contains 34 ordered stages',()=>{
 assert.equal(RELEASE_STAGES.length,34);assert.equal(new Set(RELEASE_STAGES).size,34);assert.ok(Object.isFrozen(RELEASE_STAGES));
 assert.equal(MUTATING_STAGES.size,16);assert.ok(MUTATING_STAGES.has('admission_lease'));assert.ok(MUTATING_STAGES.has('expected_head_merge'));assert.ok(MUTATING_STAGES.has('guarded_held_to_open'));
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
  rows=>rows[0].schema=4,
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
 const j=journal(),calls=[],set=adapters(calls);set.provider_acl_check.check=async()=>({status:'BLOCKED_EXTERNAL'});
 const result=await runReleaseSequence({input,journal:j,adapters:set});assert.equal(result.reason,'EXTERNAL_GATE');assert.equal(result.mutationSent,false);
 assert.equal(inspectReleaseSequence(j.events).nextOrdinal,3);
 assert.equal(j.events.at(-1).type,'sequence_stopped');assert.equal(j.events.at(-1).releaseState,'BLOCKED_EXTERNAL');
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
