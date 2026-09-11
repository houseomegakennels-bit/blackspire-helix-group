import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {hash} from '../packages/zola-release/commander-journal.js';
import {HELD_ACCEPTANCE_CAPABILITIES,HELD_ACCEPTANCE_OPERATIONS,inspectHeldAcceptanceHistory,mintHeldAcceptancePermit}
 from '../packages/zola-release/held-acceptance-authority.js';
import {FIXED_LIVE_SIX_READ_CONFIGURATION,FIXED_PREMERGE_SIX_READ_CONFIGURATION,createHeldProductionOperations,wrapHeldAcceptanceOperations}
 from '../packages/zola-release/production-held-operations.js';
import {RELEASE_ADMISSION_LOCK,acquireReleaseAdmissionLock} from '../packages/shared/release-admission.js';

const candidate='a'.repeat(40),merged='b'.repeat(40),apiGeneration='1'.repeat(32),workerGeneration='2'.repeat(32);
const operationId='11111111-1111-4111-8111-111111111111',epochRunId='22222222-2222-4222-8222-222222222222';
const input={releaseSha:candidate,previousMainSha:'c'.repeat(40),recoverySha:'d'.repeat(40),protectedInputDigest:'e'.repeat(64),
 workspace:'zola-production',principal:'blackspire-release-root',inputDigest:'f'.repeat(64)};

function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'production-held-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'admission.lock'),RELEASE_ADMISSION_LOCK,{mode:0o640});
 fs.writeFileSync(path.join(root,'state.json'),JSON.stringify({version:1,mode:'held',releaseSha:merged,runId:epochRunId,apiGeneration:null,workerGeneration:null})+'\n',{mode:0o640});
 const events=[],journal={stream:()=>({events:()=>structuredClone(events),append:event=>events.push(structuredClone(event))})};
 const acquire=options=>acquireReleaseAdmissionLock({...options,checkDirectory:()=>{}}),verifyGenerations=()=>({apiGeneration,workerGeneration});
 const deps={root,owner:process.getuid(),groupId:process.getgid(),secretGroupId:process.getgid(),acquire,getuid:()=>0,verifyGenerations,
  readState:()=>JSON.parse(fs.readFileSync(path.join(root,'state.json'))),readAuthority:()=>JSON.parse(fs.readFileSync(path.join(root,'acceptance.json'))),
  readSecret:()=>JSON.parse(fs.readFileSync(path.join(root,'acceptance-secret.json')))};
 const reads=HELD_ACCEPTANCE_CAPABILITIES.map((capability,index)=>{const idempotencyKey=`zola-six:${epochRunId}:${index}`,request=`read-${index}`;
  return{index,idempotencyKey,capability,permission:capability.replace(/\.(search|get|status)$/,'.read'),request,
   requestDigest:hash({channel:'jarvis',workspaceId:input.workspace,text:request,idempotencyKey,executionIntent:'read_only'})};});
 mintHeldAcceptancePermit({commanderRunId:operationId,mergeMainSha:merged,expectedDeploymentSha:merged,epochRunId,workspace:input.workspace,
  principal:input.principal,apiGeneration,workerGeneration,reads,journal,verifyGenerations},deps);
 const state={context:{operationId,releaseSha:candidate,workspace:input.workspace,principal:input.principal},
  outputs:{capture_new_main_sha:{newMainSha:merged}},pending:{stage:'api_health',attemptId:'33333333-3333-4333-8333-333333333333'}};
 const call={input,state,ordinal:24,attemptId:state.pending.attemptId,inputDigest:'4'.repeat(64),checkOutputDigest:'5'.repeat(64)};
 return{root,events,journal,deps,call};
}

test('outer HELD operation authorizes before dispatch and reconciles the same pending inner attempt',{skip:process.getuid()!==0},async t=>{
 const f=fixture(t),order=[],primitive={execute(){assert.equal(inspectHeldAcceptanceHistory(f.events).pending.operation,'api_health');order.push('primitive');throw new Error('lost response');},async reconcile(){
  order.push('reconcile');const core={stage:'api_health',newMainSha:merged};return{status:'PASS',evidence:{...core,observationDigest:hash(core)}};}};
 const primitives=Object.fromEntries(HELD_ACCEPTANCE_OPERATIONS.map(name=>[name,name==='api_health'?primitive:{execute(){},reconcile(){throw new Error('unused');}}]));
 const wrapped=wrapHeldAcceptanceOperations({input,journal:f.journal},primitives,{options:()=>f.deps,readSecret:()=>f.deps.readSecret()});
 await assert.rejects(()=>wrapped.api_health.execute(f.call),/lost response/);
 assert.deepEqual(order,['primitive']);assert.equal(inspectHeldAcceptanceHistory(f.events).pending.operation,'api_health');
 const result=await wrapped.api_health.reconcile(f.call);assert.equal(result.status,'PASS');assert.deepEqual(order,['primitive','reconcile']);
 const history=inspectHeldAcceptanceHistory(f.events);assert.deepEqual(history.completed,['api_health']);assert.equal(history.pending,null);
});

test('premerge and HELD collectors use distinct immutable protected configurations',()=>{
 assert.notEqual(FIXED_PREMERGE_SIX_READ_CONFIGURATION,FIXED_LIVE_SIX_READ_CONFIGURATION);
 assert.match(FIXED_PREMERGE_SIX_READ_CONFIGURATION,/premerge-config\.json$/);assert.match(FIXED_LIVE_SIX_READ_CONFIGURATION,/live-config\.json$/);
 const context={input,release:{activationConfigurationFile:'/protected/activation.json'},journal:{stream:()=>({events:()=>[],append(){}})}};
 assert.deepEqual(Object.keys(createHeldProductionOperations(context)).sort(),['admission_lease','candidate_six_reads','final_release_record','generation_fence',
  'generation_revalidation','guarded_held_to_open','mint_acceptance_permit','post_merge_held_epoch','six_live_reads','six_reads','worker_readiness'].sort());
});
