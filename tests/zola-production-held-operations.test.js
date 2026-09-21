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
   requestDigest:hash({channel:'jarvis',workspaceId:'blackspire-command',text:request,idempotencyKey,executionIntent:'read_only'})};});
 mintHeldAcceptancePermit({commanderRunId:operationId,mergeMainSha:merged,expectedDeploymentSha:merged,epochRunId,workspace:'blackspire-command',
  principal:'blackspire-operator',apiGeneration,workerGeneration,reads,journal,verifyGenerations},deps);
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

test('admission activates the exact buyer writer attempt before any HELD service start',async()=>{
 const events=[],journal={stream:()=>({events:()=>structuredClone(events),append:event=>events.push(structuredClone(event))})};
 const context={input,release:{activationConfigurationFile:'/protected/activation.json'},journal};
 const attemptId='33333333-3333-4333-8333-333333333333',state={context:{operationId,
  releaseSha:candidate,workspace:input.workspace,principal:input.principal},outputs:{},
  pending:{stage:'admission_lease',attemptId}};
 const call={input,state,ordinal:1,attemptId,inputDigest:'4'.repeat(64),checkOutputDigest:'5'.repeat(64)};
 const order=[];
 const operations=createHeldProductionOperations(context,{
  async ensureWriterBinding(bound){order.push('binding');assert.equal(bound.stage,'admission_lease');assert.equal(bound.attemptId,attemptId);return {status:'HELD_WRITER_BINDING_VERIFIED',releaseSha:candidate};},
  async activate(binding){order.push('activate');assert.deepEqual(binding,{releaseSha:candidate,
   operationId,attemptId,inputDigest:call.inputDigest,checkOutputDigest:call.checkOutputDigest});
   return {status:'BUYER_WRITER_PRE_HELD_READY'};},
  async establishHeld(){order.push('held');return {status:'HELD_LIFECYCLE_OBSERVED',releaseSha:candidate,
   runId:epochRunId,proof:{artifactDigest:'6'.repeat(64),api:{generation:apiGeneration},worker:{generation:workerGeneration}}};},
 });
 await operations.admission_lease.execute(call);
 assert.deepEqual(order,['activate','held','binding']);
});


test('mint maps fixed runtime identity without substituting release journal authority',async()=>{
 const journal={stream:()=>({events:()=>[],append(){}})},context={input,release:{},journal};
 const attemptId='33333333-3333-4333-8333-333333333333';
 const state={context:{operationId,releaseSha:candidate,workspace:input.workspace,principal:input.principal},
  outputs:{capture_new_main_sha:{newMainSha:merged}},pending:{stage:'mint_acceptance_permit',attemptId}};
 const call={input,state,ordinal:23,attemptId,inputDigest:'4'.repeat(64),checkOutputDigest:'5'.repeat(64)};
 let config={workspace:'blackspire-command',principal:'blackspire-operator',dealId:'DE-0001'},minted=null;
 const operations=createHeldProductionOperations(context,{
  liveConfig:()=>config,options:()=>({}),observePostMerge:()=>({status:'PASS',evidence:{epochRunId}}),
  lifecycle:async()=>({api:{generation:apiGeneration},worker:{generation:workerGeneration}}),
  mint:value=>{minted=value;},
 });
 assert.equal((await operations.mint_acceptance_permit.check({...call,attemptId:null})).status,'PASS');
 await operations.mint_acceptance_permit.execute(call);
 assert.equal(minted.commanderRunId,operationId);assert.equal(minted.workspace,'blackspire-command');
 assert.equal(minted.principal,'blackspire-operator');assert.equal(input.workspace,'zola-production');
 for(const row of minted.reads)assert.equal(row.requestDigest,hash({channel:'jarvis',workspaceId:'blackspire-command',text:row.request,idempotencyKey:row.idempotencyKey,executionIntent:'read_only'}));
 for(const bad of [{...config,workspace:input.workspace},{...config,principal:input.principal}]){
  config=bad;minted=null;
  await assert.rejects(()=>operations.mint_acceptance_permit.check({...call,attemptId:null}),/rejected/);
  await assert.rejects(()=>operations.mint_acceptance_permit.execute(call),/rejected/);
  assert.equal(minted,null);
 }
});

test('resumed six-read intents revalidate fixed identity, version, release and live epoch before collection',{skip:process.getuid()!==0},async t=>{
 for(const stage of ['six_reads','six_live_reads']){
  const f=fixture(t),live=stage==='six_live_reads',context={input,release:{},journal:f.journal};
  const good={runId:epochRunId,version:live?5:4,workspace:'blackspire-command',principal:'blackspire-operator',releaseSha:live?merged:candidate,
   ...(live?{releaseRunId:epochRunId}:{})};
  let config=good,collections=0;
  const operation=createHeldProductionOperations(context,{premergeConfig:()=>config,liveConfig:()=>config,premergeReadPermit:async({collect})=>collect(),
   collect:async observed=>{collections++;assert.deepEqual(observed,good);throw new Error('collector reached');}})[stage];
  const call={...f.call,state:{...f.call.state,outputs:{...f.call.state.outputs,admission_lease:{epochRunId}},pending:{stage,attemptId:f.call.attemptId}}};
  assert.equal(operation.check({...call,attemptId:null}).status,'PASS');
  operation.execute(call);
  const mutations=[{workspace:input.workspace},{principal:input.principal},{version:live?4:5},{releaseSha:'9'.repeat(40)},
   ...(live?[{releaseRunId:randomUUID()}]:[])];
  for(const mutation of mutations){
   config={...good,...mutation};
   assert.equal((await operation.reconcile(call)).status,'BLOCKED_EXTERNAL');
   assert.equal(collections,0,`${stage} must reject configuration drift before dispatch`);
  }
  config=good;
  assert.equal((await operation.reconcile(call)).status,'BLOCKED_EXTERNAL');
  assert.equal(collections,1,'unchanged configuration reaches the collector');
 }
});

test('postmerge writer publication binds the current HELD lifecycle before acceptance',async()=>{
 const journal={stream:()=>({events:()=>[],append(){}})},context={input,release:{},journal};
 const attemptId=randomUUID(),state={context:{operationId,releaseSha:candidate,workspace:input.workspace,principal:input.principal},
  outputs:{capture_new_main_sha:{newMainSha:merged}},pending:{stage:'post_merge_held_epoch',attemptId}};
 const call={input,state,ordinal:22,attemptId,inputDigest:'4'.repeat(64),checkOutputDigest:'5'.repeat(64)},calls=[];
 let bad=false;
 const operation=createHeldProductionOperations(context,{
  observePostMerge:()=>({status:'PASS',evidence:{newMainSha:merged,epochRunId}}),
  lifecycle:async()=>{calls.push('lifecycle');return{api:{generation:apiGeneration},worker:{generation:workerGeneration}};},
  ensureWriterBinding:async bound=>{calls.push('binding');assert.deepEqual(bound,{releaseSha:merged,journal,stage:'post_merge_held_epoch',operationId,attemptId,
   inputDigest:call.inputDigest,checkOutputDigest:call.checkOutputDigest});return{status:'HELD_WRITER_BINDING_VERIFIED',releaseSha:merged,runId:epochRunId,
    apiGeneration:bad?'9'.repeat(32):apiGeneration,workerGeneration,bindingDigest:'6'.repeat(64),commitDigest:'7'.repeat(64)};},
 }).post_merge_held_epoch;
 await operation.execute(call);const result=await operation.reconcile(call);
 assert.equal(result.status,'PASS');assert.deepEqual(calls,['lifecycle','binding','lifecycle','binding']);
 bad=true;await assert.rejects(()=>operation.reconcile(call),/rejected/);
});

test('owned premerge collector requires its distinct version and immutable database profile',()=>{
 const profileDigest='8'.repeat(64),context={input,release:{backendProfile:'owned-postgres-v1',profileDigest},journal:{stream:()=>({events:()=>[]})}};
 const state={context:{operationId,releaseSha:candidate,workspace:input.workspace,principal:input.principal},outputs:{admission_lease:{epochRunId}},pending:null};
 const call={input,state,ordinal:13};
 let config={version:6,releaseSha:candidate,runId:epochRunId,workspace:'blackspire-command',principal:'blackspire-operator',backendProfile:'owned-postgres-v1',profileDigest};
 const operations=createHeldProductionOperations(context,{premergeConfig:()=>config});
 assert.equal(operations.six_reads.check(call).status,'PASS');
 for(const mutation of [{version:4},{profileDigest:'9'.repeat(64)},{backendProfile:undefined},{runId:operationId}]){
  const original=config;config={...original,...mutation};assert.equal(operations.six_reads.check(call).status,'BLOCKED_EXTERNAL');config=original;
 }
 const legacy=createHeldProductionOperations({...context,release:{}},{premergeConfig:()=>config});
 assert.equal(legacy.six_reads.check(call).status,'BLOCKED_EXTERNAL');
});


test('owned admission proves current source freeze and target hardening before activation on apply and reconcile',async()=>{
 const events=[],journal={stream:()=>({events:()=>events,append:e=>events.push(e)})};
 const release={backendProfile:'owned-postgres-v1',profileDigest:'a'.repeat(64),sourceSecurityConfigurationFile:'/fixed/source',ownedMigrationConfigurationFile:'/fixed/copy'};
 const context={input,release,journal},attemptId='33333333-3333-4333-8333-333333333333';
 const call={input,state:{context:{operationId,releaseSha:candidate,workspace:input.workspace,principal:input.principal},outputs:{},pending:{stage:'admission_lease',attemptId}},ordinal:5,attemptId,inputDigest:'4'.repeat(64),checkOutputDigest:'5'.repeat(64)};
 const order=[];let frozen=true;
 const operations=createHeldProductionOperations(context,{verifyOwnedPrerequisites:async bound=>{order.push('proof');assert.equal(bound.sourceSecurityConfigurationFile,release.sourceSecurityConfigurationFile);return{status:'OWNED_MIGRATION_PREREQUISITES_VERIFIED',...bound,sourceWritesDenied:frozen,targetBrowserSecurityVerified:true,originalSourceMigrationsReapplied:false};},
 activate:async()=>{order.push('activate');},establishHeld:async()=>{order.push('held');return{status:'HELD_LIFECYCLE_OBSERVED',releaseSha:candidate,runId:epochRunId,proof:{artifactDigest:'6'.repeat(64),api:{generation:apiGeneration},worker:{generation:workerGeneration}}};},
 ensureWriterBinding:async()=>{order.push('binding');return{status:'HELD_WRITER_BINDING_VERIFIED',releaseSha:candidate};}});
 await operations.admission_lease.execute(call);assert.deepEqual(order,['proof','activate','held','binding']);order.length=0;
 await operations.admission_lease.reconcile(call);assert.deepEqual(order,['proof','activate','held','binding']);order.length=0;frozen=false;
 await assert.rejects(operations.admission_lease.execute(call));assert.deepEqual(order,['proof']);
});
