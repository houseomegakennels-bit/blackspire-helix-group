import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../packages/zola-release/commander-journal.js';
import {createDeploymentProductionOperations} from '../packages/zola-release/production-deployment-operations.js';

const releaseSha='a'.repeat(40),previousMainSha='b'.repeat(40),recoverySha='c'.repeat(40),newMainSha='d'.repeat(40);
const operationId='11111111-1111-4111-8111-111111111111',attemptId='22222222-2222-4222-8222-222222222222';
const ci={ciMergeSha:'e'.repeat(40),ciTreeSha:'f'.repeat(40)};
function journal(){const events=[];return{events,stream:()=>({events:()=>structuredClone(events),append:value=>events.push(structuredClone(value))})};}
function fixture(overrides={}){
 const j=journal(),input={releaseSha,previousMainSha,recoverySha,protectedInputDigest:'1'.repeat(64),workspace:'zola-production',principal:'blackspire-release-root',inputDigest:'2'.repeat(64)};
 const context={input,release:{releaseSha,backupManifestFile:'/protected/backup.json'},journal:j};
 const outputs={expected_head_merge:{newMainSha},capture_new_main_sha:{newMainSha},rollback_acceptance:{artifactDigest:'3'.repeat(64),backupProofDigest:'4'.repeat(64)}};
 const state={context:{operationId,releaseSha,previousMainSha,workspace:input.workspace,principal:input.principal},outputs};
 const args=(ordinal,{attempt=false}={})=>({input,state,ordinal,...attempt?{attemptId,inputDigest:'5'.repeat(64),checkOutputDigest:'6'.repeat(64)}:{}});
 const deps={readCiProof:()=>ci,readArtifactDigest:()=> '7'.repeat(64),observeMergeability:()=>({status:'PR_MERGEABLE'}),
  observeMerge:()=>({status:'MERGED_EXACT_HEAD',newMainSha}),requestMerge:()=>({status:'MERGE_REQUEST_SENT'}),
  verifyMerged:()=>({status:'MERGED_IDENTITY_VERIFIED'}),readVercelToken:()=> 'token'.repeat(8),
  observeVercel:async()=>({status:'VERCEL_PRODUCTION_EXACT',deploymentId:'dpl_fixed'}),
  beginHeld:async()=>({status:'POST_MERGE_HELD',newMainSha,epochRunId:'33333333-3333-4333-8333-333333333333'}),admissionGroup:()=>0,stopAndVerify:async()=>{},
  prepareVps:async({plan})=>({plan:{...plan,snapshotDigest:'8'.repeat(64)},snapshot:{fixed:true}}),
  runVps:async({plan})=>({status:'VPS_CUTOVER_COMPLETE',newMainSha:plan.newMainSha,replayed:false}),...overrides};
 return{operations:createDeploymentProductionOperations(context,deps),args,journal:j};
}

test('merge binding enforces expected head and reconciles an unknown request outcome without redispatch',async()=>{
 let requests=0,merged=false;const f=fixture({requestMerge:()=>{requests++;merged=true;throw new Error('transport lost');},observeMerge:()=>merged?{status:'MERGED_EXACT_HEAD',newMainSha}:{status:'OPEN_EXACT_HEAD'}});
 assert.equal(f.operations.expected_head_merge.check(f.args(17)).evidence.mergeable,true);
 assert.throws(()=>f.operations.expected_head_merge.execute(f.args(17,{attempt:true})));
 const proof=await f.operations.expected_head_merge.reconcile(f.args(17,{attempt:true}));
 assert.equal(proof.evidence.newMainSha,newMainSha);assert.equal(requests,1);
});

test('capture, main verification and Vercel observer use the exact merged SHA',async()=>{
 let verified,vercel;const f=fixture({verifyMerged:value=>{verified=value;return{status:'MERGED_IDENTITY_VERIFIED'};},observeVercel:async value=>{vercel=value;return{status:'VERCEL_PRODUCTION_EXACT',deploymentId:'dpl_fixed'};}});
 assert.equal(f.operations.capture_new_main_sha.observe(f.args(18)).evidence.newMainSha,newMainSha);
 f.operations.verify_main.observe(f.args(19));assert.equal(verified.newMainSha,newMainSha);assert.deepEqual({ciMergeSha:verified.ciMergeSha,ciTreeSha:verified.ciTreeSha},ci);
 const proof=await f.operations.verify_vercel_production_sha.observe(f.args(20));assert.equal(proof.evidence.newMainSha,newMainSha);assert.equal(vercel.newMainSha,newMainSha);
});

test('unavailable fixed Vercel credential is a genuine external block',async()=>{
 const f=fixture({readVercelToken:()=>{throw new Error('not provisioned');}});
 assert.deepEqual(await f.operations.verify_vercel_production_sha.check(f.args(20)),{status:'BLOCKED_EXTERNAL'});
});

test('VPS binding establishes HELD then supplies exact attempt, SHAs and digests to the real cutover interface',async()=>{
 let heldInput,prepared,ran;const f=fixture({beginHeld:async value=>{heldInput=value;return{status:'POST_MERGE_HELD',newMainSha,epochRunId:'33333333-3333-4333-8333-333333333333'};},
  prepareVps:async({plan})=>{prepared=plan;return{plan:{...plan,snapshotDigest:hash({fixed:true})},snapshot:{fixed:true}};},
  runVps:async(value,options)=>{ran={value,options};return{status:'VPS_CUTOVER_COMPLETE',newMainSha:value.plan.newMainSha,replayed:false};}});
 await f.operations.journaled_vps_cutover.execute(f.args(21,{attempt:true}));
 assert.equal(heldInput.commanderRunId,operationId);assert.equal(heldInput.newMainSha,newMainSha);
 assert.equal(prepared.operationId,attemptId);assert.equal(prepared.commanderRunId,operationId);assert.equal(prepared.rollbackSha,recoverySha);
 assert.equal(prepared.artifactDigest,'7'.repeat(64));assert.equal(prepared.rollbackArtifactDigest,'3'.repeat(64));assert.equal(prepared.backupDigest,'4'.repeat(64));
 assert.deepEqual(ran.options.snapshot,{fixed:true});
});
