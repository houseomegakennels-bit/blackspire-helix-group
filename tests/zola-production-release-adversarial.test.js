import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {hash} from '../packages/zola-release/commander-journal.js';
import {MUTATING_STAGES,RELEASE_STAGES,inspectReleaseSequence} from '../packages/zola-release/commander-sequence.js';
import {buildProductionAdapters,runProductionRelease} from '../packages/zola-release/production-release.js';

const releaseSha='a'.repeat(40),previousMainSha='b'.repeat(40),recoverySha='c'.repeat(40),newMainSha='d'.repeat(40);
const value=Object.freeze({schema:1,kind:'zola_production_release',releaseSha,previousMainSha,recoverySha,
 workspace:'zola-production',principal:'blackspire-release-root',preparationRoot:'/var/lib/blackspire-operator/preparation',
 packageConfigurationFile:'/var/lib/blackspire-operator/preparation/n8n-package.json',
 n8nBackupFile:'/var/lib/blackspire-operator/preparation/n8n-backup.json',
 diskConfigurationFile:'/var/lib/blackspire-operator/preparation/disk.json',
 backupManifestFile:'/var/lib/blackspire-operator/preparation/backup.json',
 migrationConfigurationFile:'/var/lib/blackspire-operator/preparation/migration.json',
 activationConfigurationFile:'/var/lib/blackspire-operator/preparation/activation.json'});
const loadedInput=Object.freeze({value,inputDigest:'e'.repeat(64),source:Object.freeze({releaseSha,clean:true})});

function memoryJournal(events=[],beforeAppend=()=>{}){
 return {events,stream:name=>{
  assert.equal(name,'release');
  return {events:()=>structuredClone(events),append:event=>{beforeAppend(event);events.push(structuredClone(event));}};
 }};
}

function evidence(stage){
 if(stage==='capture_new_main_sha')return {newMainSha};
 if(stage==='guarded_held_to_open')return {open:true,newMainSha};
 return {stage,verified:true};
}

function operationFactory(calls,{blockCheck,throwExecute,throwReconcile,blockReconcile}={}){
 return context=>Object.fromEntries(RELEASE_STAGES.map(stage=>[stage,{
  check:async args=>{calls.push({kind:'check',stage,args,context});return stage===blockCheck?{status:'BLOCKED_EXTERNAL'}:{status:'PASS',evidence:evidence(stage)};},
  observe:async args=>{calls.push({kind:'observe',stage,args,context});return {status:'PASS',evidence:evidence(stage)};},
  execute:async args=>{calls.push({kind:'execute',stage,args,context});if(stage===throwExecute)throw new Error('unknown mutation outcome');},
  reconcile:async args=>{calls.push({kind:'reconcile',stage,args,context});if(stage===throwReconcile)throw new Error('observation interrupted');
   return stage===blockReconcile?{status:'BLOCKED_EXTERNAL'}:{status:'PASS',evidence:evidence(stage)};},
 }]));
}

test('production composition binds exactly 34 concrete adapters and rejects map or method placeholders',()=>{
 const calls=[],journal=memoryJournal(),adapters=buildProductionAdapters({loadedInput,journal},{operations:operationFactory(calls)});
 assert.deepEqual(Object.keys(adapters).sort(),[...RELEASE_STAGES].sort());
 assert.equal(Object.keys(adapters).length,34);assert.ok(Object.isFrozen(adapters));
 for(const stage of RELEASE_STAGES){
  assert.equal(typeof adapters[stage].check,'function');assert.equal(typeof adapters[stage].observe,'function');
  assert.equal(typeof adapters[stage].execute,MUTATING_STAGES.has(stage)?'function':'undefined');
  assert.equal(typeof adapters[stage].reconcile,MUTATING_STAGES.has(stage)?'function':'undefined');
  assert.ok(Object.isFrozen(adapters[stage]));
 }
 for(const mutate of [
  map=>delete map.receiver_audit,
  map=>{map.placeholder=map.receiver_audit;},
  map=>{map.receiver_audit={check:true,observe:()=>{}};},
  map=>{map.n8n_migration={check:()=>{},observe:()=>{},execute:()=>{},reconcile:true};},
 ])assert.throws(()=>buildProductionAdapters({loadedInput,journal},{operations:context=>{const map=operationFactory([])(context);mutate(map);return map;}}));
});

test('default production composition binds every fixed executable host operation',()=>{
 const adapters=buildProductionAdapters({loadedInput,journal:memoryJournal()});
 assert.deepEqual(Object.keys(adapters),RELEASE_STAGES);
 for(const stage of RELEASE_STAGES){assert.equal(typeof adapters[stage].check,'function');assert.equal(typeof adapters[stage].observe,'function');}
});

test('malformed protected identity stops before operation construction or journal mutation',async()=>{
 for(const bad of [
  {...loadedInput,value:{...value,releaseSha:'wrong'}},
  {...loadedInput,value:{...value,unexpectedApproval:true}},
  {...loadedInput,inputDigest:'0'.repeat(63)},
 ]){
  let constructed=false;const journal=memoryJournal();
  const result=await runProductionRelease({loadedInput:bad,journal},{operations:()=>{constructed=true;return operationFactory([])({});}});
  assert.equal(result.status,'STOPPED');assert.equal(result.reason,'PRODUCTION_COMPOSITION_REJECTED');
  assert.equal(constructed,false);assert.deepEqual(journal.events,[]);
 }
});

test('production runner passes immutable release identity to the fixed operation registry',async()=>{
 let captured,sequenceCall;
 const journal=memoryJournal();
 const result=await runProductionRelease({loadedInput,journal},{operations:context=>{captured=context;return operationFactory([])(context);},sequence:async call=>{sequenceCall=call;return {status:'STOPPED'};}});
 assert.equal(result.status,'STOPPED');assert.ok(Object.isFrozen(captured));
 assert.equal(captured.release,value);assert.equal(captured.source,loadedInput.source);assert.equal(captured.journal,journal);
 assert.deepEqual(sequenceCall.input,{releaseSha,previousMainSha,recoverySha,protectedInputDigest:loadedInput.inputDigest,
  workspace:value.workspace,principal:value.principal,inputDigest:hash({releaseSha,previousMainSha,recoverySha,protectedInputDigest:loadedInput.inputDigest,workspace:value.workspace,principal:value.principal})});
 assert.deepEqual(Object.keys(sequenceCall.adapters).sort(),[...RELEASE_STAGES].sort());
});

test('external gate blocks before mutation and OPEN is unreachable',async()=>{
 const calls=[],journal=memoryJournal();
 const result=await runProductionRelease({loadedInput,journal},{operations:operationFactory(calls,{blockCheck:'receiver_audit'})});
 assert.equal(result.releaseState,'BLOCKED_EXTERNAL');assert.equal(result.stage,'receiver_audit');assert.equal(result.mutationSent,false);
 assert.equal(calls.some(call=>call.kind==='execute'),false);
 assert.equal(calls.some(call=>call.stage==='guarded_held_to_open'),false);
 assert.equal(inspectReleaseSequence(journal.events).nextOrdinal,1);
});

test('duplicate completed invocation dispatches no operation and OPEN remains last',async()=>{
 const calls=[],journal=memoryJournal(),operations=operationFactory(calls);
 const first=await runProductionRelease({loadedInput,journal},{operations});
 assert.equal(first.status,'COMPLETE');
 const openCalls=calls.filter(call=>call.stage==='guarded_held_to_open');assert.deepEqual(openCalls.map(call=>call.kind),['check','execute','reconcile']);
 const firstOpenIndex=calls.findIndex(call=>call.stage==='guarded_held_to_open');
 assert.ok(calls.slice(0,firstOpenIndex).some(call=>call.stage==='final_release_record'&&call.kind==='reconcile'));
 assert.equal(calls.slice(firstOpenIndex+1).some(call=>call.stage!=='guarded_held_to_open'),false);
 const count=calls.length,second=await runProductionRelease({loadedInput,journal},{operations});
 assert.equal(second.status,'COMPLETE');assert.equal(second.resumed,true);assert.equal(calls.length,count);
});

for(const stage of ['n8n_migration','production_migrations','expected_head_merge','journaled_vps_cutover','post_merge_held_epoch']){
 test(`unknown ${stage} outcome resumes by reconciling the same durable attempt without redispatch`,async()=>{
  const calls=[],journal=memoryJournal();
  const stopped=await runProductionRelease({loadedInput,journal},{operations:operationFactory(calls,{throwExecute:stage})});
  assert.equal(stopped.reason,'MUTATION_OUTCOME_UNKNOWN');assert.equal(stopped.stage,stage);assert.equal(stopped.mutationSent,null);
  const intent=journal.events.find(event=>event.type==='sequence_stage_intent'&&event.stage===stage);assert.ok(intent);
  const complete=await runProductionRelease({loadedInput,journal},{operations:operationFactory(calls)});assert.equal(complete.status,'COMPLETE');
  assert.equal(calls.filter(call=>call.stage===stage&&call.kind==='execute').length,1);
  assert.equal(calls.filter(call=>call.stage===stage&&call.kind==='check').length,1);
  const reconciled=calls.find(call=>call.stage===stage&&call.kind==='reconcile');
  assert.equal(reconciled.args.attemptId,intent.attemptId);assert.equal(reconciled.args.inputDigest,intent.inputDigest);
  assert.equal(reconciled.args.checkOutputDigest,intent.checkOutputDigest);
 });
}

test('restart after execute or reconciliation interruption retains pending intent and never reaches OPEN',async()=>{
 for(const failure of ['reconcile_throw','confirmation_append']){
  const calls=[];let failConfirmation=failure==='confirmation_append';
  const journal=memoryJournal([],event=>{
   if(failConfirmation&&event.type==='sequence_stage_confirmed'&&event.stage==='n8n_migration'){
    failConfirmation=false;throw new Error('crash before confirmation durability');
   }
  });
  const options=failure==='reconcile_throw'?{throwReconcile:'n8n_migration'}:{};
  const stopped=await runProductionRelease({loadedInput,journal},{operations:operationFactory(calls,options)});
  assert.equal(stopped.status,'STOPPED');assert.equal(inspectReleaseSequence(journal.events).pending.stage,'n8n_migration');
  assert.equal(calls.some(call=>call.stage==='guarded_held_to_open'),false);
  const complete=await runProductionRelease({loadedInput,journal},{operations:operationFactory(calls)});assert.equal(complete.status,'COMPLETE');
  assert.equal(calls.filter(call=>call.stage==='n8n_migration'&&call.kind==='execute').length,1);
  assert.equal(calls.filter(call=>call.stage==='n8n_migration'&&call.kind==='reconcile').length,2);
 }
});

test('blocked reconciliation preserves uncertainty and cannot OPEN',async()=>{
 const calls=[],journal=memoryJournal();
 await runProductionRelease({loadedInput,journal},{operations:operationFactory(calls,{throwExecute:'journaled_vps_cutover'})});
 const result=await runProductionRelease({loadedInput,journal},{operations:operationFactory(calls,{blockReconcile:'journaled_vps_cutover'})});
 assert.equal(result.releaseState,'BLOCKED_EXTERNAL');assert.equal(result.mutationSent,null);
 assert.equal(inspectReleaseSequence(journal.events).pending.stage,'journaled_vps_cutover');
 assert.equal(calls.some(call=>call.stage==='guarded_held_to_open'),false);
});

test('production CLI owns composition and exposes no adapter or command injection flags',()=>{
 const filename=fileURLToPath(new URL('../scripts/zola-release-command.js',import.meta.url)),source=fs.readFileSync(filename,'utf8');
 assert.match(source,/--release/);assert.match(source,/runProductionRelease/);
 assert.doesNotMatch(source,/process\.env\.(?:ADAPTER|COMMAND)|--adapter|--command|JSON\.parse\(process\.argv/);
});
