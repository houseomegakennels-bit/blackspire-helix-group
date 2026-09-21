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


test('owned composition retains protected selector and proof paths without changing sequence identity',()=>{
 const owned={...value,schema:2,backendProfile:'owned-postgres-v1',profileDigest:'e'.repeat(64),
  sourceSecurityConfigurationFile:'/var/lib/blackspire-operator/owned-source-security/11111111-1111-4111-8111-111111111111/configuration.json',
  ownedMigrationConfigurationFile:'/var/lib/blackspire-operator/owned-buyer-migration/11111111-1111-4111-8111-111111111111/manifest.json'};
 const seen=[];buildProductionAdapters({loadedInput:{...loadedInput,value:owned},journal},{operations:operations(seen)});
 assert.equal(seen[0].release,owned);assert.equal(seen[0].input.protectedInputDigest,protectedDigest);
 for(const key of ['profileDigest','sourceSecurityConfigurationFile','ownedMigrationConfigurationFile']){
  const invalid={...owned};delete invalid[key];
  assert.throws(()=>buildProductionAdapters({loadedInput:{...loadedInput,value:invalid},journal},{operations:operations([])}));
 }
});

test('retirement history is validated before constructing any production operations or starting a sequence',async()=>{
 let constructed=0,started=0;
 const malformed={stream:()=>({events:()=>[{type:'sequence_retired'}]})};
 const result=await runProductionRelease({loadedInput,journal:malformed},{operations:()=>{constructed++;},sequence:()=>{started++;}});
 assert.equal(result.reason,'PRODUCTION_COMPOSITION_REJECTED');assert.equal(constructed,0);assert.equal(started,0);
});


test('production binds the prepared operation only from matching protected owned prerequisite paths',async()=>{
 const op='11111111-1111-4111-8111-111111111111',owned={...value,schema:2,backendProfile:'owned-postgres-v1',profileDigest:'e'.repeat(64),sourceSecurityConfigurationFile:`/var/lib/blackspire-operator/owned-source-security/${op}/configuration.json`,ownedMigrationConfigurationFile:`/var/lib/blackspire-operator/owned-buyer-migration/${op}/manifest.json`};
 let received;await runProductionRelease({loadedInput:{...loadedInput,value:owned},journal},{operations:operations([]),sequence:args=>{received=args;return{status:'STOPPED'};}});assert.equal(received.requestedOperationId,op);
 let called=false;const invalid={...owned,ownedMigrationConfigurationFile:owned.ownedMigrationConfigurationFile.replace(op,'22222222-2222-4222-8222-222222222222')};
 const result=await runProductionRelease({loadedInput:{...loadedInput,value:invalid},journal},{operations:()=>{called=true;},sequence:()=>{called=true;}});assert.equal(result.reason,'PRODUCTION_COMPOSITION_REJECTED');assert.equal(called,false);
});

test('successor production selects a fresh explicit operation while retaining original migration paths',async()=>{
 const original='95a11ea1-289f-46a9-b5cd-cc7805497242',operationId='11111111-1111-4111-8111-111111111111';
 const successor={...value,schema:3,operationId,backendProfile:'owned-postgres-v1',profileDigest:'2563185421523bf337e382a38ca389c5991406cb2adecc952048cdf5cf058505',sourceSecurityConfigurationFile:`/var/lib/blackspire-operator/owned-source-security/${original}/configuration.json`,ownedMigrationConfigurationFile:`/var/lib/blackspire-operator/owned-buyer-migration/${original}/manifest.json`,successorLineageFile:`/var/lib/blackspire-operator/owned-migration-successors/${operationId}/plan.json`};
 let received;await runProductionRelease({loadedInput:{...loadedInput,value:successor},journal},{operations:operations([]),sequence:args=>{received=args;return{status:'STOPPED'};}});assert.equal(received.requestedOperationId,operationId);
 for(const patch of [{operationId:original},{successorLineageFile:successor.successorLineageFile.replace(operationId,original)},{schema:2},{sourceSecurityConfigurationFile:successor.sourceSecurityConfigurationFile.replace(original,operationId)}]){
  let called=false;const result=await runProductionRelease({loadedInput:{...loadedInput,value:{...successor,...patch}},journal},{operations:()=>{called=true;},sequence:()=>{called=true;}});assert.equal(result.reason,'PRODUCTION_COMPOSITION_REJECTED');assert.equal(called,false);
 }
});
