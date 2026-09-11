import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../packages/zola-release/commander-journal.js';
import {inspectVpsCutoverHistory,runVpsCutover,rollbackVpsCutover} from '../packages/zola-release/commander-vps.js';

const snapshot={current:'/opt/blackspire-command/releases/'+'a'.repeat(40),state:{mode:'held'},api:{active:false},worker:{active:false}};
const plan={operationId:'11111111-1111-4111-8111-111111111111',commanderRunId:'22222222-2222-4222-8222-222222222222',
 epochRunId:'33333333-3333-4333-8333-333333333333',newMainSha:'b'.repeat(40),rollbackSha:'a'.repeat(40),artifactDigest:'c'.repeat(64),
 backupDigest:'d'.repeat(64),admissionDigest:'e'.repeat(64),snapshotDigest:hash(snapshot)};
function journal(events=[]){return{events,stream:()=>({events:()=>structuredClone(events),append:value=>events.push(structuredClone(value))})};}
function host({throwAt,observable=true}={}){
 const done=new Set(),calls=[];let rollback=false,thrown=false;
 return{calls,snapshot:()=>structuredClone(snapshot),async execute(step){calls.push('execute:'+step);done.add(step);if(step===throwAt&&!thrown){thrown=true;throw new Error('lost');}},
  async observe(step){calls.push('observe:'+step);return done.has(step)&&observable;},
  async rollback(){calls.push('rollback');rollback=true;},async observeRollback(){calls.push('observeRollback');return rollback;}};
}
test('journaled VPS cutover executes seven exact substeps once and completed replay is inert',async()=>{
 const j=journal(),h=host();const result=await runVpsCutover({plan,journal:j},{host:h});
 assert.equal(result.status,'VPS_CUTOVER_COMPLETE');assert.equal(inspectVpsCutoverHistory(j.events).completed,true);
 assert.equal(j.events.filter(row=>row.type==='vps_step_intent').length,7);
 const before=h.calls.length;assert.equal((await runVpsCutover({plan,journal:j,reconcile:true},{host:h})).replayed,true);assert.equal(h.calls.length,before);
});
test('unknown substep is observed on resume and never dispatched twice',async()=>{
 const j=journal(),h=host({throwAt:'pointer'});let result=await runVpsCutover({plan,journal:j},{host:h});
 assert.equal(result.reason,'VPS_STEP_OUTCOME_UNKNOWN');
 result=await runVpsCutover({plan,journal:j,reconcile:true},{host:h});assert.equal(result.status,'VPS_CUTOVER_COMPLETE');
 assert.equal(h.calls.filter(value=>value==='execute:pointer').length,1);
});
test('unconfirmed unknown substep rolls back once and rollback resume only observes',async()=>{
 const j=journal(),h=host({throwAt:'pointer'});await runVpsCutover({plan,journal:j},{host:h});
 h.observe=async step=>step!=='pointer';let result=await runVpsCutover({plan,journal:j,reconcile:true},{host:h});
 assert.equal(result.reason,'VPS_CUTOVER_ROLLED_BACK');assert.equal(h.calls.filter(value=>value==='rollback').length,1);
 result=await rollbackVpsCutover({plan,journal:j},{host:h});assert.equal(result.replayed,true);assert.equal(h.calls.filter(value=>value==='rollback').length,1);
});
test('VPS history rejects reordering, duplicates and changed bindings',async()=>{
 const j=journal(),h=host();await runVpsCutover({plan,journal:j},{host:h});
 for(const mutate of [rows=>rows[2].type='vps_step_intent',rows=>rows[1].newMainSha='f'.repeat(40),rows=>rows.push(rows.at(-1))]){
  const rows=structuredClone(j.events);mutate(rows);assert.throws(()=>inspectVpsCutoverHistory(rows));
 }
});
