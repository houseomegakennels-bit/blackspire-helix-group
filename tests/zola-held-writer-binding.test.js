import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../packages/zola-release/commander-journal.js';
import {RELEASE_STAGES,MUTATING_STAGES,runReleaseSequence} from '../packages/zola-release/commander-sequence.js';
import {ensureHeldWriterBinding,inspectHeldWriterBindingHistory,verifyHeldCanonicalWriter} from '../packages/zola-release/held-writer-binding.js';
import {inspectReleaseCommander} from '../packages/zola-release/commander.js';
const candidate='a'.repeat(40),main='b'.repeat(40);
function fixture({lostStep=null,noEffect=false,alterInput=null,omitCandidate=false}={}){
 const input={releaseSha:candidate,previousMainSha:'c'.repeat(40),recoverySha:'d'.repeat(40),protectedInputDigest:'e'.repeat(64),workspace:'zola-production',principal:'blackspire-release-root'};input.inputDigest=hash(input);
 const events=[],journal={stream:()=>({events:()=>structuredClone(events),append:e=>events.push(structuredClone(e))})},calls=[],effects=new Set();let lost=false,drift=false;
 const host={async lease(sha){calls.push('lease:'+sha);},async prepare(input,prior){return {...input,runId:'11111111-1111-4111-8111-111111111111',apiGeneration:'1'.repeat(32),workerGeneration:'2'.repeat(32),artifactDigest:'3'.repeat(64),configurationDigest:'4'.repeat(64),priorBindingDigest:prior?.result.bindingDigest??null,priorCommitDigest:prior?.result.commitDigest??null};},
  async check(){if(drift)throw new Error('drift');},async execute(step,p){assert.equal(events.at(-1).type,'held_writer_binding_step_intent');calls.push('effect:'+p.stage+':'+step);if(!noEffect)effects.add(p.stage+':'+step);if(step===lostStep&&!lost){lost=true;throw new Error('unknown');}},
  async observe(step,p){return effects.has(p.stage+':'+step);},async inspect(p){if(!effects.has(p.stage+':publish'))throw new Error('not committed');return{bindingDigest:(p.stage==='admission_lease'?'5':'7').repeat(64),commitDigest:(p.stage==='admission_lease'?'6':'8').repeat(64)};},close(){calls.push('close');}};
 const invoke=(call,stage)=>ensureHeldWriterBinding({journal,releaseSha:stage==='admission_lease'?candidate:main,stage,operationId:call.state.context.operationId,attemptId:call.attemptId,inputDigest:call.inputDigest,checkOutputDigest:call.checkOutputDigest,...(alterInput??{})},{host});
 const pass=()=>({status:'PASS',evidence:{ok:true}}),adapters=Object.fromEntries(RELEASE_STAGES.map(stage=>[stage,{check:stage==='mint_acceptance_permit'?()=>({status:'BLOCKED_EXTERNAL'}):pass,observe:stage==='capture_new_main_sha'?()=>({status:'PASS',evidence:{newMainSha:main}}):pass,...(MUTATING_STAGES.has(stage)?{execute(){},reconcile:pass}:{})}]));
 for(const stage of ['admission_lease','post_merge_held_epoch'])adapters[stage]={check:pass,observe:pass,execute:call=>invoke(call,stage),reconcile:async call=>({status:'PASS',evidence:await invoke(call,stage)})};
 if(omitCandidate)adapters.admission_lease={check:pass,observe:pass,execute(){},reconcile:pass};
 return{events,journal,calls,host,effects,run:()=>runReleaseSequence({input,journal,adapters}),drift:()=>{drift=true;}};
}
test('composed candidate and postmerge publish fresh bindings with strict outer stage history and inert replay',async()=>{
 const f=fixture();assert.equal((await f.run()).stage,'mint_acceptance_permit');
 const records=inspectHeldWriterBindingHistory(f.events);assert.equal(records.size,2);assert.equal(records.get('post_merge_held_epoch').plan.priorBindingDigest,records.get('admission_lease').result.bindingDigest);
 assert.equal(inspectReleaseCommander(f.journal).mutationSent,true);const effects=f.calls.filter(c=>c.startsWith('effect:')).length;await f.run();assert.equal(f.calls.filter(c=>c.startsWith('effect:')).length,effects);
 assert.equal((await verifyHeldCanonicalWriter({releaseSha:main,journal:f.journal},{host:f.host})).status,'HELD_WRITER_BINDING_VERIFIED');f.drift();await assert.rejects(verifyHeldCanonicalWriter({releaseSha:main,journal:f.journal},{host:f.host}));
});
test('each lost step acknowledgement observes effects without redispatch',async()=>{
 for(const lostStep of ['retire_commit','retire_binding','publish']){const f=fixture({lostStep});const stopped=await f.run();assert.equal(stopped.stage,'admission_lease');await f.run();assert.equal(f.calls.filter(c=>c==='effect:admission_lease:'+lostStep).length,1);assert.equal(inspectHeldWriterBindingHistory(f.events).get('admission_lease').result!==null,true);}
});
test('unobserved outcome remains blocked without republishing or advancing to n8n',async()=>{
 const f=fixture({lostStep:'publish',noEffect:true});await f.run();await f.run();assert.equal(f.calls.filter(c=>c.startsWith('effect:')).length,1);assert.equal(inspectHeldWriterBindingHistory(f.events).get('admission_lease').result,null);
});
test('unknown schema, attempt drift, late/duplicate results and unbound retirement fail closed',async()=>{
 for(const mutate of [rows=>rows.push({schema:1,type:'held_writer_binding_future'}),rows=>{rows.find(r=>r.type==='held_writer_binding_intent').plan.attemptId='99999999-9999-4999-8999-999999999999';},rows=>{rows.find(r=>r.type==='held_writer_binding_step_result').step='publish';},rows=>rows.push(rows.find(r=>r.type==='held_writer_binding_result')),rows=>{const r=rows.find(r=>r.type==='held_writer_binding_intent'&&r.plan.stage==='post_merge_held_epoch');r.plan.priorBindingDigest='0'.repeat(64);},rows=>{rows.find(r=>r.type==='held_writer_binding_result').extra=true;}]){const f=fixture();await f.run();mutate(f.events);assert.throws(()=>inspectReleaseCommander(f.journal));}
});

test('native host retires only exact prior protected files while holding shared admission lease',async t=>{
 const fs=await import('node:fs'),path=await import('node:path');const {createHeldWriterBindingHost}=await import('../packages/zola-release/held-writer-binding.js');
 if(process.getuid()!==0)return t.skip('protected root-owned host fixture');
 const root=fs.mkdtempSync('/run/zola-held-binding-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const filename=path.join(root,'binding.json'),runId='11111111-1111-4111-8111-111111111111',apiGeneration='1'.repeat(32),workerGeneration='2'.repeat(32);
 const state={version:1,mode:'held',releaseSha:main,runId,apiGeneration:null,workerGeneration:null};
 fs.writeFileSync(path.join(root,'state.json'),JSON.stringify(state)+'\n',{mode:0o600});
 const previousBinding=JSON.stringify({prior:'binding'})+'\n',previousCommit=JSON.stringify({prior:'commit'})+'\n';
 fs.writeFileSync(filename,previousBinding,{mode:0o600});fs.writeFileSync(filename+'.commit.json',previousCommit,{mode:0o600});
 const profile={context:{filename,credentialGroupId:0,apiGeneration,apiPid:123,releaseSha:main},artifactDigest:'3'.repeat(64),configurationDigest:'4'.repeat(64),workerGeneration,preparationCredential:'x'.repeat(43)};
 const proof={releaseSha:main,runId,artifactDigest:profile.artifactDigest,api:{role:'api',generation:apiGeneration,pid:123,startTime:'100'},worker:{role:'worker',generation:workerGeneration,pid:124,startTime:'101'}};
 let held=false,reads=0;
 const host=createHeldWriterBindingHost({root,profile:async()=>structuredClone(profile),observe:async()=>structuredClone(proof),acquire:options=>{
  assert.equal(options.exclusive,false);assert.equal(options.allowPending,true);held=true;return{assertIdentity(){assert.equal(held,true);},close(){held=false;}};},
  publish:async()=>{assert.equal(held,true);assert.equal(fs.existsSync(filename),false);assert.equal(fs.existsSync(filename+'.commit.json'),false);fs.writeFileSync(filename,JSON.stringify({current:'binding'})+'\n',{mode:0o600});fs.writeFileSync(filename+'.commit.json',JSON.stringify({current:'commit'})+'\n',{mode:0o600});},
  inspectBinding:async()=>({approved:true,credentialsSeparated:true,apiGeneration,workerGeneration,releaseSha:main,workspace:'blackspire-command'}),
  checkReadiness:async options=>{assert.equal(held,true);options.verifyHeld();reads++;return{verified:true,workerGeneration};}});
 const input={stage:'post_merge_held_epoch',releaseSha:main,operationId:'22222222-2222-4222-8222-222222222222',attemptId:'33333333-3333-4333-8333-333333333333',inputDigest:'a'.repeat(64),checkOutputDigest:'b'.repeat(64)};
 try{
  await host.lease(main);const p=await host.prepare(input,{result:{bindingDigest:hash(previousBinding),commitDigest:hash(previousCommit)}});
  for(const step of ['retire_commit','retire_binding','publish']){await host.execute(step,p);assert.equal(await host.observe(step,p),true);}
  assert.equal(fs.readFileSync(filename+'.retired-'+input.attemptId,'utf8'),previousBinding);
  assert.equal(fs.readFileSync(filename+'.commit.json.retired-'+input.attemptId,'utf8'),previousCommit);assert.equal(reads,1);
  state.runId='44444444-4444-4444-8444-444444444444';fs.writeFileSync(path.join(root,'state.json'),JSON.stringify(state)+'\n');await assert.rejects(host.check(p));
 }finally{host.close();}assert.equal(held,false);
});


test('unsupported prior history and wrong enclosing binding refuse before any event append',async()=>{
 for(const options of [{omitCandidate:true},{alterInput:{stage:'post_merge_held_epoch'}},{alterInput:{attemptId:'99999999-9999-4999-8999-999999999999'}},{alterInput:{inputDigest:'0'.repeat(64)}},{alterInput:{checkOutputDigest:'0'.repeat(64)}}]){
  const f=fixture(options);await f.run();assert.equal(f.events.filter(e=>String(e.type).startsWith('held_writer_binding_')).length,0);assert.equal(f.calls.filter(c=>c.startsWith('effect:')).length,0);assert.doesNotThrow(()=>inspectReleaseCommander(f.journal));
 }
});
