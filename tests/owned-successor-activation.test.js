import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {hash} from '../packages/zola-release/commander-journal.js';
import {PARTIAL_RELEASE as P} from '../packages/zola-release/partial-retirement-history.js';
import {RELEASE_STAGES,runReleaseSequence,inspectReleaseSequenceHistory} from '../packages/zola-release/commander-sequence.js';
import {activateOwnedSuccessorBeforeHeld,readOwnedSuccessorActivationStorePlan} from '../packages/zola-release/owned-successor-activation.js';
const original=JSON.parse(fs.readFileSync(new URL('./fixtures/zola-release/retired-release-2636.json',import.meta.url)));
const releaseSha='a'.repeat(40),defaultOperationId='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
async function fixture(options={}){
 const operationId=options.operationId??defaultOperationId;
 const proof={version:1,runId:P.runId,currentSha:P.releaseSha,hostStopped:true,bindingAbsent:true,retainedEffects:true,n8nJournalDigest:P.n8nJournalDigest,stopPlanDigest:'a'.repeat(64),stopResultDigest:'b'.repeat(64),lineageDigest:'c'.repeat(64)};
 const events=[...structuredClone(original),{schema:5,type:'sequence_retired',operationId:P.operationId,releaseSha:P.releaseSha,attemptId:P.attemptId,ordinal:5,stage:'admission_lease',prefixDigest:P.prefixDigest,segmentDigest:P.segmentDigest,successorReleaseSha:releaseSha,successorOperationId:operationId,backendProfile:'owned-postgres-v1',profileDigest:P.profileDigest,proof,proofDigest:hash(proof)}];
 const journal={stream:()=>({events:()=>structuredClone(events),append:e=>events.push(structuredClone(e))})};
 const sequenceInput={releaseSha,previousMainSha:original[69].previousMainSha,recoverySha:original[69].recoverySha,protectedInputDigest:'d'.repeat(64),workspace:'zola-production',principal:'blackspire-release-root'};sequenceInput.inputDigest=hash(sequenceInput);
 const pass=()=>({status:'PASS',evidence:{modeled:true}}),adapters=Object.fromEntries(RELEASE_STAGES.map(stage=>[stage,{check:pass,observe:pass,reconcile:pass,execute(){if(stage==='admission_lease')throw Error('leave exact pending');}}]));
 await runReleaseSequence({input:sequenceInput,journal,adapters,requestedOperationId:operationId});let p=inspectReleaseSequenceHistory(events).pending;if(options.attemptId){for(const e of events)if(e.attemptId===p.attemptId)e.attemptId=options.attemptId;p=inspectReleaseSequenceHistory(events).pending;}
 const input={releaseSha,operationId,attemptId:p.attemptId,inputDigest:p.inputDigest,checkOutputDigest:p.checkOutputDigest,profileDigest:P.profileDigest,successorLineageFile:`/var/lib/blackspire-operator/owned-migration-successors/${operationId}/plan.json`};
 const records=new Map(),calls=[],state={mode:'stopped-sealed',config:false,unit:false,drift:false};
 const storePlan={version:1,releaseSha,previousSha:P.releaseSha,origin:'https://successor.vercel.app',backendProfile:'owned-postgres-v1',profileDigest:P.profileDigest,retainedDigest:'e'.repeat(64)};
 const host={fence:async()=>({identity:{retirementDigest:'f'.repeat(64),lineageDigest:'c'.repeat(64),profileDigest:P.profileDigest,previewDigest:state.drift?'b'.repeat(64):'a'.repeat(64),frontendOrigin:storePlan.origin,artifactDigest:'d'.repeat(64)},runtime:{mode:state.mode}}),
  prepareConfiguration:async input=>{calls.push('prepare-config');return {input,secret:'disposable-test-secret'};},publishConfiguration:async plan=>{calls.push('publish-config');state.config=true;return {status:'OWNED_SUCCESSOR_CONFIGURATION_PREPARED',releaseSha,profileDigest:P.profileDigest,planDigest:hash(plan),storePlan};},observeConfiguration:async()=>state.config,
  prepareGateway:async input=>{calls.push('prepare-unit');return {input};},installGateway:async()=>{calls.push('install-unit');state.unit=true;return {version:1,status:'OWNED_SUCCESSOR_GATEWAY_UNIT_VERIFIED',releaseSha,operationId,attemptId:input.attemptId,unitDigest:'a'.repeat(64),planDigest:'b'.repeat(64),daemonReloaded:true};},observeGateway:async()=>state.unit};
 const store={read:k=>structuredClone(records.get(k)??null),retain:(k,v)=>{calls.push('record-'+k);if(records.has(k))assert.deepEqual(records.get(k),v);else records.set(k,structuredClone(v));}};
 return {input,journal,events,records,calls,state,host,store,storePlan,run:()=>activateOwnedSuccessorBeforeHeld({...input,journal},{host,store,uid:0})};
}
test('exact pending admission completes separate phases, running replay only observes',async()=>{
 const f=await fixture();assert.equal((await f.run()).status,'OWNED_SUCCESSOR_ACTIVATION_VERIFIED');const before=[...f.calls];f.state.mode='deployed';await f.run();assert.deepEqual(f.calls,before);
 assert.ok(f.calls.indexOf('record-configuration-intent')<f.calls.indexOf('publish-config'));assert.ok(f.calls.indexOf('record-gateway-intent')<f.calls.indexOf('install-unit'));
});
test('wrong attempt or lineage path refuses before any helper or record',async()=>{
 for(const change of [v=>v.attemptId='bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb',v=>v.successorLineageFile=v.successorLineageFile.replace('plan.json','result.json'),v=>v.inputDigest='e'.repeat(64)]){const f=await fixture();change(f.input);await assert.rejects(f.run());assert.deepEqual(f.calls,[]);}
});
test('uncertain configuration outcome retains exact plan and resumes helper reconciliation without preparation',async()=>{
 const f=await fixture(),publish=f.host.publishConfiguration;let first=true;f.host.publishConfiguration=async plan=>{const result=await publish(plan);if(first){first=false;throw Error('ack lost');}return result;};await assert.rejects(f.run());assert.equal(f.records.has('configuration-plan'),true);await f.run();assert.equal(f.calls.filter(x=>x==='prepare-config').length,1);
});
test('changed protected evidence during await blocks next phase and live incomplete activation cannot mutate',async()=>{
 const f=await fixture(),publish=f.host.publishConfiguration;f.host.publishConfiguration=async plan=>{const r=await publish(plan);f.state.drift=true;return r;};await assert.rejects(f.run());assert.equal(f.calls.includes('prepare-unit'),false);
 const g=await fixture();g.state.mode='deployed';await assert.rejects(g.run());assert.equal(g.calls.includes('prepare-config'),false);
});
test('candidate handoff reads exact retained store plan and rejects damaged result binding',async()=>{
 const f=await fixture();await f.run();const read=file=>({value:structuredClone(f.records.get(file.split('/').at(-1).replace('.json',''))),identity:{uid:0,gid:0,mode:0o100600}});
 assert.deepEqual(readOwnedSuccessorActivationStorePlan({...f.input,journal:f.journal},{read}),f.storePlan);
 f.records.get('configuration-result').result.storePlan.previousSha='f'.repeat(40);assert.throws(()=>readOwnedSuccessorActivationStorePlan({...f.input,journal:f.journal},{read}));
});
test('native composition journal argument is supported and conflicting authority is rejected',async()=>{
 const f=await fixture();await activateOwnedSuccessorBeforeHeld(f.input,{journal:f.journal,host:f.host,store:f.store,uid:0});
 await assert.rejects(activateOwnedSuccessorBeforeHeld({...f.input,journal:f.journal},{journal:{},host:f.host,store:f.store,uid:0}));
});
test('candidate handoff rejects internally rehashed invalid envelopes and missing phase intent',async()=>{
 for(const change of [f=>f.records.get('gateway-result').result.status='UNVERIFIED',f=>f.records.delete('configuration-intent')]){
  const f=await fixture();await f.run();change(f);f.records.get('result').gatewayResultDigest=hash(f.records.get('gateway-result'));
  const read=file=>({value:structuredClone(f.records.get(file.split('/').at(-1).replace('.json',''))),identity:{uid:0,gid:0,mode:0o100600}});
  assert.throws(()=>readOwnedSuccessorActivationStorePlan({...f.input,journal:f.journal},{read}));
 }
});

test('actual gateway publication composes with activation and every interrupted deployed phase without replaying effects',{skip:process.getuid?.()!==0},async()=>{
 const {createOwnedSuccessorGatewayUnitFixture}=await import('./owned-successor-gateway-unit-fixture.js');
 const unit=await import('../packages/buyer-writer/owned-successor-gateway-unit.js'),g=createOwnedSuccessorGatewayUnitFixture();
 try{
  const f=await fixture(g.input);const baseFence=f.host.fence;
  f.host.fence=async()=>{const captured=unit.captureOwnedSuccessorRuntimePhase(g.input,g.deps);if(captured.requiresStopped)await g.deps.stopped();return {...await baseFence(),runtime:{mode:captured.sealed?'stopped-sealed':'deployed',phase:captured}};};
  f.host.prepareGateway=input=>unit.prepareOwnedSuccessorGatewayUnit(input,g.deps);f.host.installGateway=plan=>unit.installOwnedSuccessorGatewayUnit(plan);f.host.observeGateway=async input=>(await unit.observeOwnedSuccessorGatewayUnit(input,g.deps)).status==='OWNED_SUCCESSOR_GATEWAY_UNIT_VERIFIED';
  await f.run();const calls=[...f.calls],counts=g.counts();
  for(const transition of [()=>g.newHeld(),()=>g.beginCandidate(),()=>g.addRecord(),()=>g.switchPointer(),()=>g.setRunning()]){transition();await f.run();assert.deepEqual(g.counts(),counts);assert.deepEqual(f.calls,calls);}
 }finally{g.close();}
});
