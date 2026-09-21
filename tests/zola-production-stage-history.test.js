import {HELD_ACCEPTANCE_CAPABILITIES,HELD_ACCEPTANCE_OPERATIONS} from '../packages/zola-release/held-acceptance-authority.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../packages/zola-release/commander-journal.js';
import {RELEASE_STAGES,MUTATING_STAGES,RELEASE_REGISTRY_DIGEST,runReleaseSequence} from '../packages/zola-release/commander-sequence.js';
import {createHeldProductionOperations} from '../packages/zola-release/production-held-operations.js';
import {activateBuyerWriterBeforeHeld} from '../packages/zola-release/buyer-writer-activation.js';
import {inspectReleaseCommander,runReleasePreflight} from '../packages/zola-release/commander.js';
const input={releaseSha:'a'.repeat(40),previousMainSha:'b'.repeat(40),recoverySha:'c'.repeat(40),
 protectedInputDigest:'d'.repeat(64),workspace:'blackspire-command',principal:'blackspire-release-root'};
input.inputDigest=hash(input);
function fixture(){
 const events=[],journal={stream:()=>({events:()=>structuredClone(events),append:row=>events.push(structuredClone(row))})};
 const pass=()=>({status:'PASS',evidence:{ok:true}}),stop=()=>({status:'BLOCKED_EXTERNAL'});
 const adapters=Object.fromEntries(RELEASE_STAGES.map(stage=>[stage,{check:stage==='generation_revalidation'?stop:pass,observe:pass,
  ...(MUTATING_STAGES.has(stage)?{execute:()=>{},reconcile:pass}:{})}]));
 const statuses={'source-v1':'BUYER_WRITER_SOURCE_V1_PREPARED','gateway-v4':'BUYER_WRITER_GATEWAY_V4_PREPARED',
  'upgrade-buyer':'UPGRADED','zola-config-install':'INSTALLED_RELOAD_REQUIRED'};
 const held=createHeldProductionOperations({input,journal,release:{}},{
  candidate:()=>({releaseSha:input.releaseSha,candidatePass:true}),
  activate:bound=>activateBuyerWriterBeforeHeld(bound,{journal,
   io:{lstatSync(){throw Object.assign(new Error('absent'),{code:'ENOENT'});}},
   run:async(script,args)=>script.includes('provision-buyer')?{status:args[0]==='--inspect'?'NONCOMPLIANT':'PROVISIONED'}
    :{status:Object.entries(statuses).find(([key])=>script.includes(key))[1],candidateDigest:'e'.repeat(64)},
   inspectArtifact:async()=>({status:'SEALED_ARTIFACT_VERIFIED',releaseSha:input.releaseSha,artifactDigest:'f'.repeat(64),deployed:false,productionAccepted:false}),
   reloadSystemd:async()=>({status:'SYSTEMD_RELOADED'}),
  }),
  establishHeld:async()=>{
   assert.equal(inspectReleaseCommander(journal).status,'OBSERVED');
   return {status:'HELD_LIFECYCLE_OBSERVED',releaseSha:input.releaseSha,runId:'22222222-2222-4222-8222-222222222222',
    proof:{artifactDigest:'e'.repeat(64),api:{generation:'1'.repeat(32)},worker:{generation:'2'.repeat(32)}}};
  },
 });
 adapters.candidate_six_reads=held.candidate_six_reads;adapters.admission_lease=held.admission_lease;
 return {events,journal,run:()=>runReleaseSequence({input,journal,adapters})};
}
test('commander accepts composed candidate and real activation journal producers without losing mutation state',async()=>{
 const f=fixture(),result=await f.run();assert.equal(result.stage,'generation_revalidation');
 assert.equal(f.events.filter(row=>row.type==='buyer_writer_activation_result').length,5);
 assert.equal(inspectReleaseCommander(f.journal).mutationSent,true);
 let reads=0;
 const preflight=await runReleasePreflight({input:{releaseSha:input.releaseSha,packageConfigurationFile:'/a',backupFile:'/b',diskConfigurationFile:'/c',backupManifestFile:'/d'},journal:f.journal},{verifySource:()=>reads++});
 assert.equal(preflight.preflightCompleted,false);assert.equal(reads,0);
 const before=f.events.filter(row=>row.type==='buyer_writer_activation_intent').length;
 await f.run();assert.equal(f.events.filter(row=>row.type==='buyer_writer_activation_intent').length,before);
});
test('strict stage histories reject unknown, mixed, reordered, extra-field and forged completion events',async()=>{
 for(const mutate of [
  rows=>rows.push({schema:1,type:'candidate_six_reads_future'}),
  rows=>{rows.find(row=>row.type==='candidate_six_reads_result').attemptId='99999999-9999-4999-8999-999999999999';},
  rows=>{rows.find(row=>row.type==='buyer_writer_activation_result').status='UNVERIFIED';},
  rows=>{rows.find(row=>row.type==='buyer_writer_activation_result').secret='forbidden';},
  rows=>{rows.find(row=>row.type==='buyer_writer_activation_intent').binding.operationId='99999999-9999-4999-8999-999999999999';},
  rows=>{const i=rows.findIndex(row=>row.type==='candidate_six_reads_intent');rows.splice(i,1);},
  rows=>rows.push({schema:1,type:'held_acceptance_future'}),
  rows=>rows.push({schema:1,type:'final_release_record_intent',record:{}}),
 ]){
  const f=fixture();await f.run();mutate(f.events);assert.throws(()=>inspectReleaseCommander(f.journal));
 }
});

test('final record histories bind completed-stage evidence and reject tampered records',async()=>{
 const events=[],journal={stream:()=>({events:()=>structuredClone(events),append:row=>events.push(structuredClone(row))})};
 let record;
 const pass=()=>({status:'PASS',evidence:{ok:true}});
 const adapters=Object.fromEntries(RELEASE_STAGES.map(stage=>[stage,{check:stage==='guarded_held_to_open'?()=>({status:'BLOCKED_EXTERNAL'}):pass,
  observe:stage==='capture_new_main_sha'?()=>({status:'PASS',evidence:{newMainSha:'e'.repeat(40)}}):pass,
  ...(MUTATING_STAGES.has(stage)?{execute:()=>{},reconcile:pass}:{})}]));
 adapters.final_release_record.execute=call=>{
  record={schema:1,kind:'zola_release_accepted_held',releaseSha:input.releaseSha,previousMainSha:input.previousMainSha,
   newMainSha:'e'.repeat(40),operationId:call.state.context.operationId,attemptId:call.attemptId,
   stageInputDigest:call.inputDigest,checkOutputDigest:call.checkOutputDigest,sequenceInputDigest:input.inputDigest,
   registryDigest:RELEASE_REGISTRY_DIGEST,acceptedStagesDigest:hash(call.state.outputs),
   epochRunId:'33333333-3333-4333-8333-333333333333',permitId:'44444444-4444-4444-8444-444444444444',
   permitDigest:'f'.repeat(64),apiGeneration:'1'.repeat(32),workerGeneration:'2'.repeat(32),
   rollbackAcceptanceDigest:'e'.repeat(64),acceptedAt:'2026-09-21T00:00:00.000Z'};
  events.push({schema:1,type:'final_release_record_intent',record});
 };
 assert.equal((await runReleaseSequence({input,journal,adapters})).stage,'guarded_held_to_open');
 assert.equal(inspectReleaseCommander(journal).status,'OBSERVED');
 record.stageInputDigest='0'.repeat(64);assert.throws(()=>inspectReleaseCommander(journal));
});

test('HELD journal distinguishes runtime principal and inner permit attempts from coordinator identities',async()=>{
 const events=[],journal={stream:()=>({events:()=>structuredClone(events),append:row=>events.push(structuredClone(row))})};
 const pass=()=>({status:'PASS',evidence:{ok:true}}),coordinator={...input,workspace:'zola-production'};
 delete coordinator.inputDigest;coordinator.inputDigest=hash(coordinator);
 const adapters=Object.fromEntries(RELEASE_STAGES.map(stage=>[stage,{check:stage==='worker_readiness'?()=>({status:'BLOCKED_EXTERNAL'}):pass,
  observe:stage==='capture_new_main_sha'?()=>({status:'PASS',evidence:{newMainSha:'e'.repeat(40)}}):pass,
  ...(MUTATING_STAGES.has(stage)?{execute:()=>{},reconcile:pass}:{})}]));
 let claims,claimsDigest;
 adapters.mint_acceptance_permit.execute=call=>{
  const epochRunId='33333333-3333-4333-8333-333333333333',workspace='blackspire-command';
  claims={schema:1,kind:'held-epoch-acceptance',permitId:'44444444-4444-4444-8444-444444444444',
   commanderRunId:call.state.context.operationId,mergeMainSha:'e'.repeat(40),expectedDeploymentSha:'e'.repeat(40),epochRunId,
   workspace,principal:'blackspire-operator',apiGeneration:'1'.repeat(32),workerGeneration:'2'.repeat(32),
   issuedAt:1000,expiresAt:2000,operations:[...HELD_ACCEPTANCE_OPERATIONS],tokenDigest:'f'.repeat(64),
   reads:HELD_ACCEPTANCE_CAPABILITIES.map((capability,index)=>{
    const request=`read-${index}`,idempotencyKey=`zola-six:${epochRunId}:${index}`;
    return {index,idempotencyKey,capability,permission:capability.replace(/\.(search|get|status)$/,'.read'),request,
     requestDigest:hash({channel:'jarvis',workspaceId:workspace,text:request,idempotencyKey,executionIntent:'read_only'})};
   })};claimsDigest=hash(claims);
  events.push({schema:1,type:'held_acceptance_mint_intent',claims,claimsDigest},
   {schema:1,type:'held_acceptance_minted',permitId:claims.permitId,claimsDigest});
 };
 adapters.api_health.execute=call=>{
  const attemptId='55555555-5555-4555-8555-555555555555';assert.notEqual(attemptId,call.attemptId);
  events.push({schema:1,type:'held_acceptance_consume_intent',permitId:claims.permitId,claimsDigest},
   {schema:1,type:'held_acceptance_operation_intent',permitId:claims.permitId,claimsDigest,operation:'api_health',attemptId});
 };
 const result=await runReleaseSequence({input:coordinator,journal,adapters});assert.equal(result.stage,'worker_readiness');
 assert.equal(inspectReleaseCommander(journal).status,'OBSERVED');
 claims.principal='blackspire-release-root';events.find(row=>row.type==='held_acceptance_mint_intent').claimsDigest=hash(claims);
 for(const row of events.filter(row=>row.claimsDigest!==undefined))row.claimsDigest=hash(claims);
 assert.throws(()=>inspectReleaseCommander(journal));
});
