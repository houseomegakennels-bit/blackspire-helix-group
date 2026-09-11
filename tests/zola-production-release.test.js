import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {RELEASE_STAGES,MUTATING_STAGES} from '../packages/zola-release/commander-sequence.js';
import {buildProductionAdapters,runProductionRelease} from '../packages/zola-release/production-release.js';

const a='a'.repeat(40),b='b'.repeat(40),c='c'.repeat(40),protectedDigest='d'.repeat(64);
const value={schema:1,kind:'zola_production_release',releaseSha:a,previousMainSha:b,recoverySha:c,workspace:'zola-production',principal:'blackspire-release-root',
 preparationRoot:'/var/lib/blackspire-operator/preparation',packageConfigurationFile:'/var/lib/blackspire-operator/preparation/package.json',n8nBackupFile:'/var/lib/blackspire-operator/preparation/n8n.json',diskConfigurationFile:'/var/lib/blackspire-operator/preparation/disk.json',backupManifestFile:'/var/lib/blackspire-operator/preparation/backup.json',migrationConfigurationFile:'/var/lib/blackspire-operator/preparation/migration.json',activationConfigurationFile:'/var/lib/blackspire-operator/preparation/activation.json'};
const loadedInput={value,inputDigest:protectedDigest,source:{releaseSha:a,clean:true}};
const journal={stream(){return{events:()=>[],append(){}};}};
function operations(seen){return context=>{
 seen.push(context);return Object.fromEntries(RELEASE_STAGES.map(stage=>[stage,{
  check:async()=>({status:'PASS',evidence:{stage}}),observe:async()=>({status:'PASS',evidence:{stage}}),
  ...(MUTATING_STAGES.has(stage)?{execute:async()=>{},reconcile:async()=>({status:'PASS',evidence:{stage}})}:{}),
 }]));
};}

test('production composition binds the exact immutable 34-stage registry',()=>{
 const seen=[],adapters=buildProductionAdapters({loadedInput,journal},{operations:operations(seen)});
 assert.deepEqual(Object.keys(adapters),RELEASE_STAGES);assert.ok(Object.isFrozen(adapters));assert.equal(seen.length,1);
 assert.equal(seen[0].release,value);assert.equal(seen[0].journal,journal);
 assert.deepEqual(seen[0].input,{releaseSha:a,previousMainSha:b,recoverySha:c,protectedInputDigest:protectedDigest,workspace:value.workspace,principal:value.principal,
  inputDigest:createHash('sha256').update(JSON.stringify({releaseSha:a,previousMainSha:b,recoverySha:c,protectedInputDigest:protectedDigest,workspace:value.workspace,principal:value.principal})).digest('hex')});
 for(const stage of RELEASE_STAGES){assert.ok(Object.isFrozen(adapters[stage]));assert.equal(typeof adapters[stage].check,'function');assert.equal(typeof adapters[stage].observe,'function');
  assert.equal(typeof adapters[stage].execute,MUTATING_STAGES.has(stage)?'function':'undefined');assert.equal(typeof adapters[stage].reconcile,MUTATING_STAGES.has(stage)?'function':'undefined');}
});

test('composition rejects missing, extra and incomplete fixed operations',()=>{
 for(const mutate of [map=>delete map.receiver_audit,map=>map.unregistered={},map=>delete map.n8n_migration.reconcile]){
  const create=context=>{const map=operations([])(context);mutate(map);return map;};
  assert.throws(()=>buildProductionAdapters({loadedInput,journal},{operations:create}),/composition rejected/);
 }
 assert.throws(()=>buildProductionAdapters({loadedInput:{...loadedInput,inputDigest:'invalid'},journal},{operations:operations([])}),/composition rejected/);
});

test('runner passes only normalized sequence input and the composed map',async()=>{
 let received;
 const result=await runProductionRelease({loadedInput,journal},{operations:operations([]),sequence:args=>{received=args;return{status:'STOPPED',releaseState:'BLOCKED_EXTERNAL'};}});
 assert.equal(result.releaseState,'BLOCKED_EXTERNAL');assert.equal(received.journal,journal);assert.deepEqual(Object.keys(received.adapters),RELEASE_STAGES);
 assert.equal(received.input.protectedInputDigest,protectedDigest);assert.equal(received.input.inputDigest,hashSequenceInput(received.input));
});

function hashSequenceInput(input){const {inputDigest:_,...identity}=input;return createHash('sha256').update(JSON.stringify(identity)).digest('hex');}
