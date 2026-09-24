import test from 'node:test';
import assert from 'node:assert/strict';
import {runOwnedMaterializationStages} from '../packages/buyer-writer/owned-postgres-materializer.js';
function fixture(){const records=new Map();let actual=null,calls=0;const stage={name:'effect',before(){assert.equal(actual,null);},apply(){calls++;actual={identity:'owned'};},observe(){return actual;}};return{records,stage,options:{stages:[stage],binding:'fixed',load:k=>records.get(k),save:(k,v)=>{assert.ok(!records.has(k));records.set(k,structuredClone(v));}},calls:()=>calls,set:v=>{actual=v;}};}
test('materializer persists intent before effect and reconciles result without replay',async()=>{const f=fixture();const apply=f.stage.apply;f.stage.apply=()=>{assert.ok(f.records.has('effect.intent'));apply();};await runOwnedMaterializationStages(f.options);await runOwnedMaterializationStages(f.options);assert.equal(f.calls(),1);f.records.delete('effect.result');await runOwnedMaterializationStages(f.options);assert.equal(f.calls(),1);});
test('unknown partial effect cannot be replayed and foreign drift is refused',async()=>{const f=fixture();f.stage.apply=()=>{throw new Error('interrupted');};await assert.rejects(runOwnedMaterializationStages(f.options));await assert.rejects(runOwnedMaterializationStages(f.options));assert.equal(f.calls(),0);f.set({identity:'owned'});await runOwnedMaterializationStages(f.options);f.set({identity:'foreign'});await assert.rejects(runOwnedMaterializationStages(f.options));});
test('retained intent cannot move to another source binding',async()=>{const f=fixture();await runOwnedMaterializationStages(f.options);await assert.rejects(runOwnedMaterializationStages({...f.options,binding:'other'}));});

test('database drop-in and stale unit prevent the start effect',async()=>{
 const {validateOwnedDatabaseStart}=await import('../packages/buyer-writer/owned-postgres-materializer.js');
 const {OWNED_POSTGRES_SERVICE}=await import('../packages/buyer-writer/owned-postgres.js');
 const {createHash}=await import('node:crypto');
 const valid={unitSha256:createHash('sha256').update(OWNED_POSTGRES_SERVICE).digest('hex'),fragmentPath:'/etc/systemd/system/blackspire-owned-postgres.service',dropInPaths:'',needsReload:'no',containerProof:{id:'owned'},networkProof:{id:'internal'},tlsProof:{verified:true},bootstrapRunning:false};
 assert.equal(validateOwnedDatabaseStart(valid),true);
 for(const bad of [{dropInPaths:'/etc/systemd/system/blackspire-owned-postgres.service.d/override.conf'},{needsReload:'yes'},{fragmentPath:'/tmp/foreign.service'},{containerProof:null},{bootstrapRunning:true}]){
  const f=fixture();f.stage.before=()=>validateOwnedDatabaseStart({...valid,...bad});await assert.rejects(runOwnedMaterializationStages(f.options));assert.equal(f.calls(),0);assert.equal(f.records.size,0);
 }
});
