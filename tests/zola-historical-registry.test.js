import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../packages/zola-release/commander-journal.js';
import {RELEASE_STAGES,RELEASE_REGISTRY_DIGEST,inspectReleaseSequence,inspectReleaseSequenceHistory,runReleaseSequence} from '../packages/zola-release/commander-sequence.js';

const identity={releaseSha:'a'.repeat(40),previousMainSha:'b'.repeat(40),recoverySha:'c'.repeat(40),protectedInputDigest:'d'.repeat(64),workspace:'zola-production',principal:'blackspire-release-root'};
const input={...identity,inputDigest:hash(identity)};
const operationId='11111111-1111-4111-8111-111111111111';
const historicalDigest='9120f95adee2011d44979c4eab4b83f4ab7f35295cc2a2c86871c736da313916';
function history(){
 const output={historical:true},checkOutputDigest=hash({checked:true});
 return [
  {schema:4,type:'sequence_started',operationId,...input,registryDigest:historicalDigest},
  {schema:4,type:'sequence_stage_confirmed',operationId,ordinal:0,stage:'exact_sha_verification',attemptId:null,
   inputDigest:hash({sequence:input.inputDigest,stage:'exact_sha_verification',ordinal:0,check:checkOutputDigest}),checkOutputDigest,outputDigest:hash(JSON.stringify(output)),output},
  {schema:4,type:'sequence_stopped',operationId,ordinal:1,stage:'receiver_audit',releaseState:'BLOCKED_EXTERNAL',reason:'EXTERNAL_GATE'},
 ];
}
function fixture(rows=history()){
 const calls=[];
 const journal={stream:()=>({events:()=>structuredClone(rows),append:row=>rows.push(structuredClone(row))})};
 const adapters=Object.fromEntries(RELEASE_STAGES.map(stage=>[stage,{
  check:async()=>{calls.push('check:'+stage);return stage==='receiver_audit'?{status:'BLOCKED_EXTERNAL'}:{status:'PASS',evidence:{checked:true}};},
  observe:async()=>{calls.push('observe:'+stage);return{status:'PASS',evidence:{fresh:true}};},
  execute:async()=>{calls.push('execute:'+stage);},reconcile:async()=>{throw new Error('unexpected mutation');},
 }]));
 return{rows,calls,journal,adapters};
}

test('strict parser rejects historical registry; explicit history inspector carries no observations',()=>{
 const rows=history();assert.throws(()=>inspectReleaseSequence(rows));
 const state=inspectReleaseSequenceHistory(rows);
 assert.equal(state.started,false);assert.equal(state.nextOrdinal,0);assert.deepEqual(state.outputs,{});assert.equal(state.context,null);
});
test('same-input history starts fresh at ordinal zero and retains every original row',async()=>{
 const f=fixture(),before=JSON.stringify(f.rows);
 const result=await runReleaseSequence({input,...f});
 assert.equal(result.releaseState,'BLOCKED_EXTERNAL');assert.equal(result.stage,'receiver_audit');
 assert.equal(JSON.stringify(f.rows.slice(0,3)),before);
 assert.notEqual(f.rows[3].operationId,operationId);assert.equal(f.rows[3].registryDigest,RELEASE_REGISTRY_DIGEST);
 assert.deepEqual(f.calls,['check:exact_sha_verification','observe:exact_sha_verification','check:receiver_audit']);
 const current=inspectReleaseSequenceHistory(f.rows);assert.deepEqual(current.outputs,{exact_sha_verification:{fresh:true}});
 f.calls.length=0;await runReleaseSequence({input,...f});assert.deepEqual(f.calls,['check:receiver_audit']);
});
test('interruption after durable current start resumes without adding or replaying historical state',async()=>{
 const f=fixture();f.rows.push({schema:4,type:'sequence_started',operationId:'22222222-2222-4222-8222-222222222222',...input,registryDigest:RELEASE_REGISTRY_DIGEST});
 await runReleaseSequence({input,...f});
 assert.equal(f.rows.filter(row=>row.type==='sequence_started').length,2);
 assert.equal(f.calls[0],'check:exact_sha_verification');
});
test('unknown, altered, unfinished, mutating and reverse histories fail before adapter calls',async()=>{
 const mutations=[
  rows=>{rows[0].registryDigest='f'.repeat(64);},
  rows=>{rows[0].inputDigest='f'.repeat(64);},
  rows=>{rows[1].ordinal=3;rows[1].stage='n8n_backup_check';},
  rows=>{rows[1].output.historical=false;},
  rows=>{rows.pop();},
  rows=>{rows.splice(1,0,{schema:4,type:'sequence_stage_intent',operationId});},
  rows=>{rows.push({schema:4,type:'sequence_completed',operationId});},
  rows=>{rows.push({...rows[0],registryDigest:RELEASE_REGISTRY_DIGEST});},
  rows=>{rows.push({...rows[0],operationId:'22222222-2222-4222-8222-222222222222',registryDigest:RELEASE_REGISTRY_DIGEST},...history());},
 ];
 for(const mutate of mutations){
  const f=fixture();mutate(f.rows);const before=JSON.stringify(f.rows);
  assert.throws(()=>inspectReleaseSequenceHistory(f.rows));
  const result=await runReleaseSequence({input,...f});
  assert.equal(result.releaseState,'FAIL_CLOSED');assert.deepEqual(f.calls,[]);assert.equal(JSON.stringify(f.rows),before);
 }
});
test('multiple properly stopped historical attempts retain ordering and distinct identities',()=>{
 const first=history(),second=history();for(const row of second)row.operationId='22222222-2222-4222-8222-222222222222';
 assert.equal(inspectReleaseSequenceHistory([...first,...second]).started,false);
 assert.throws(()=>inspectReleaseSequenceHistory([...first,...first]));
});
