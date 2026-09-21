import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {hash} from '../packages/zola-release/commander-journal.js';
import {BLOCKED_RELEASE,partitionRetiredReleaseHistory} from '../packages/zola-release/retired-release-history.js';
import {retireBlockedRelease} from '../packages/zola-release/blocked-release-retirement.js';
import {inspectReleaseCommander} from '../packages/zola-release/commander.js';
import {RELEASE_STAGES,runReleaseSequence,inspectReleaseSequenceHistory} from '../packages/zola-release/commander-sequence.js';
import {inspectBuyerWriterActivationHistory} from '../packages/zola-release/buyer-writer-activation.js';
import {inspectCandidateSixReadsHistory} from '../packages/zola-release/production-stage-history.js';
import {OWNED_POSTGRES_TARGET} from '../packages/buyer-writer/owned-postgres.js';
const original=JSON.parse(fs.readFileSync(new URL('./fixtures/zola-release/retired-release-7bd.json',import.meta.url)));
const successor='a'.repeat(40),profile={version:1,...OWNED_POSTGRES_TARGET,creatorOid:16384,systemIdentifier:'1234567890123456789',caSha256:'b'.repeat(64)};
function fixture(){
 const events=structuredClone(original),workflow=JSON.parse(fs.readFileSync(new URL('./fixtures/zola-release/retired-release-n8n.json',import.meta.url))),retained=[];
 const journal={stream:name=>({events:()=>structuredClone(name==='release'?events:workflow),append:row=>events.push(structuredClone(row))})};
 const dependencies={uid:0,verifySource:async sha=>assert.equal(sha,successor),readProfile:()=>profile,now:()=>100000,retain:p=>retained.push(p),
  observeHost:()=>({hostStopped:true,currentSha:BLOCKED_RELEASE.currentSha,admissionAbsent:true,provisioningDigest:BLOCKED_RELEASE.provisioningDigest}),
  observeDatabase:async()=>({rolesAbsent:true,providerAclDigest:'c'.repeat(64)})};
 return {events,journal,dependencies,retained};
}
test('exact blocked mutation retires append-only and keeps historical effects truth',async()=>{
 const f=fixture();assert.equal(hash(f.events),BLOCKED_RELEASE.prefixDigest);
 assert.equal(inspectReleaseSequenceHistory(f.events).mutationState,null);
 const r=await retireBlockedRelease({successorReleaseSha:successor,journal:f.journal},f.dependencies);
 assert.equal(r.status,'BLOCKED_RELEASE_RETIRED');assert.equal(f.events.length,69);assert.deepEqual(f.events.slice(0,68),original);
 const state=inspectReleaseSequenceHistory(f.events);assert.equal(state.started,false);assert.equal(state.retired.historicalMutationState,true);
 assert.equal(inspectReleaseCommander(f.journal).retiredRelease.status,'RETIRED_WITH_RETAINED_EFFECTS');
 assert.equal(inspectReleaseCommander(f.journal).mutationSent,true);
 assert.equal(inspectBuyerWriterActivationHistory(f.events).intent,null);
 assert.equal(inspectCandidateSixReadsHistory(f.events).intent,null);
 assert.equal(f.retained.length,1);
 assert.equal((await retireBlockedRelease({successorReleaseSha:successor,journal:f.journal},f.dependencies)).status,'BLOCKED_RELEASE_ALREADY_RETIRED');
 assert.equal(f.events.length,69);
});
test('only specified successor starts fresh; old pending mutation is never replayed',async()=>{
 const f=fixture();await retireBlockedRelease({successorReleaseSha:successor,journal:f.journal},f.dependencies);
 const input={releaseSha:successor,previousMainSha:BLOCKED_RELEASE.previousMainSha,recoverySha:BLOCKED_RELEASE.recoverySha,protectedInputDigest:'d'.repeat(64),workspace:'zola-production',principal:'blackspire-release-root'};input.inputDigest=hash(input);
 const adapters=Object.fromEntries(RELEASE_STAGES.map(stage=>[stage,{check:async()=>({status:'BLOCKED_EXTERNAL'}),observe:async()=>{throw new Error('unreachable');},execute:async()=>{throw new Error('unreachable');},reconcile:async()=>{throw new Error('old mutation replayed');}}]));
 const wrong={...input,releaseSha:'f'.repeat(40)};delete wrong.inputDigest;wrong.inputDigest=hash(wrong);
 const rejected=await runReleaseSequence({input:wrong,journal:f.journal,adapters});assert.equal(rejected.status,'STOPPED');assert.equal(f.events.length,69);
 await runReleaseSequence({input,journal:f.journal,adapters});
 const active=inspectReleaseSequenceHistory(f.events);assert.equal(active.started,true);assert.equal(active.nextOrdinal,0);assert.equal(active.context.releaseSha,successor);assert.notEqual(active.context.operationId,BLOCKED_RELEASE.operationId);
 const bad=structuredClone(f.events);bad[69].releaseSha='f'.repeat(40);assert.throws(()=>partitionRetiredReleaseHistory(bad));
});
test('unknown roles, drift, changed old evidence and tampered terminal proof all refuse',async()=>{
 for(const patch of [{observeDatabase:async()=>({rolesAbsent:false,providerAclDigest:'c'.repeat(64)})},{observeHost:()=>({hostStopped:false,currentSha:BLOCKED_RELEASE.currentSha,admissionAbsent:true,provisioningDigest:BLOCKED_RELEASE.provisioningDigest})}]){
  const f=fixture();await assert.rejects(retireBlockedRelease({successorReleaseSha:successor,journal:f.journal},{...f.dependencies,...patch}));assert.equal(f.events.length,68);
 }
 const f=fixture();f.events[67].reason='OTHER_REASON';await assert.rejects(retireBlockedRelease({successorReleaseSha:successor,journal:f.journal},f.dependencies));
 const g=fixture();await retireBlockedRelease({successorReleaseSha:successor,journal:g.journal},g.dependencies);
 g.events[68].proof.rolesAbsent=false;assert.throws(()=>inspectReleaseSequenceHistory(g.events));assert.throws(()=>inspectBuyerWriterActivationHistory(g.events));assert.throws(()=>inspectCandidateSixReadsHistory(g.events));
});
test('new candidate and owned activation histories coexist with preserved retired effects',async()=>{
 const f=fixture();await retireBlockedRelease({successorReleaseSha:successor,journal:f.journal},f.dependencies);
 const input={releaseSha:successor,previousMainSha:BLOCKED_RELEASE.previousMainSha,recoverySha:BLOCKED_RELEASE.recoverySha,protectedInputDigest:'d'.repeat(64),workspace:'zola-production',principal:'blackspire-release-root'};input.inputDigest=hash(input);
 const adapters=Object.fromEntries(RELEASE_STAGES.map(stage=>[stage,{check:async()=>({status:'PASS',evidence:{stage,checked:true}}),observe:async()=>({status:'PASS',evidence:{stage,observed:true}}),reconcile:async()=>({status:'PASS',evidence:{stage,observed:true}}),execute:async context=>{
  if(stage==='candidate_six_reads'){
   f.events.push({schema:1,type:'candidate_six_reads_intent',attemptId:context.attemptId,releaseSha:successor});
   f.events.push({schema:1,type:'candidate_six_reads_result',attemptId:context.attemptId,releaseSha:successor,status:'PASS',reportDigest:'e'.repeat(64)});
  }
  if(stage==='admission_lease'){
   const binding={releaseSha:successor,operationId:context.state.context.operationId,attemptId:context.attemptId,inputDigest:context.inputDigest,checkOutputDigest:context.checkOutputDigest,backendProfile:'owned-postgres-v1',profileDigest:'f'.repeat(64)};
   const bindingDigest=hash(binding);
   f.events.push({schema:1,type:'buyer_writer_activation_intent',binding,bindingDigest});
   f.events.push({schema:1,type:'buyer_writer_activation_result',phase:'source_v1',bindingDigest,status:'BUYER_WRITER_SOURCE_V1_PREPARED',evidenceDigest:'1'.repeat(64)});
   throw new Error('synthetic stop before more effects');
  }
 }}]));
 const result=await runReleaseSequence({input,journal:f.journal,adapters});assert.equal(result.status,'STOPPED');assert.equal(result.stage,'admission_lease');
 assert.equal(inspectCandidateSixReadsHistory(f.events).result.releaseSha,successor);
 const activation=inspectBuyerWriterActivationHistory(f.events);assert.equal(activation.intent.binding.releaseSha,successor);assert.equal(activation.completed.size,1);
 assert.equal(inspectReleaseCommander(f.journal).retiredRelease.historicalMutationState,true);
 assert.deepEqual(f.events.slice(0,68),original);
});
test('lost append acknowledgement reconciles retained terminal event without appending twice',async()=>{
 const f=fixture(),base=f.journal.stream.bind(f.journal);let fail=true;
 f.journal.stream=name=>{const stream=base(name);return {...stream,append:row=>{stream.append(row);if(fail){fail=false;throw new Error('synthetic lost acknowledgement');}}};};
 await assert.rejects(retireBlockedRelease({successorReleaseSha:successor,journal:f.journal},f.dependencies));
 assert.equal(f.events.length,69);assert.equal(f.retained.length,1);
 const result=await retireBlockedRelease({successorReleaseSha:successor,journal:f.journal},f.dependencies);
 assert.equal(result.status,'BLOCKED_RELEASE_ALREADY_RETIRED');assert.equal(f.events.length,69);assert.equal(f.retained.length,1);
});
