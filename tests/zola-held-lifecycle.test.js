import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {runHeldLifecycle,inspectHeldLifecycleHistory,observeHeldLifecycle} from '../packages/zola-release/held-lifecycle.js';
import {engageReleaseAdmissionHold} from '../packages/zola-release/admission-hold.js';
import {acquireReleaseAdmissionLock,RELEASE_ADMISSION_LOCK} from '../packages/shared/release-admission.js';
import {inspectReleaseCommander,runReleasePreflight} from '../packages/zola-release/commander.js';

const releaseSha='a'.repeat(40);
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'held-lifecycle-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.writeFileSync(path.join(root,'admission.lock'),RELEASE_ADMISSION_LOCK,{mode:0o640});fs.chmodSync(path.join(root,'admission.lock'),0o640);
  const events=[],stream={events:()=>structuredClone(events),append:e=>events.push(structuredClone(e))},journal={stream:()=>stream};
  const readState=file=>JSON.parse(fs.readFileSync(file,'utf8'));
  const acquire=o=>acquireReleaseAdmissionLock({...o,checkDirectory:()=>{}});
  const options={root,groupId:process.getgid(),owner:process.getuid(),acquire,readState,stopped:()=>{},checkDirectory:()=>{}};
  const held=engageReleaseAdmissionHold({releaseSha,journal},options);
  let calls=0;
  const proof={releaseSha,runId:held.runId,artifactDigest:'d'.repeat(64),api:{role:'api',generation:'b'.repeat(32),pid:101,startTime:'123'},worker:{role:'worker',generation:'c'.repeat(32),pid:102,startTime:'124'}};
  options.observe=async()=>structuredClone(proof);options.start=async()=>{calls++;assert.throws(()=>acquire({...options,exclusive:true}));};
  return{root,events,journal,options,proof,calls:()=>calls,input:{releaseSha,journal}};
}
test('HELD start serializes through kernel lease and preserves marker and closed intake',async t=>{
  const f=fixture(t),before=fs.readFileSync(path.join(f.root,'state.json'));
  const result=await runHeldLifecycle(f.input,f.options);
  assert.equal(result.intakeOpen,false);assert.equal(result.productionAccepted,false);assert.equal(result.lifecycleSerializationComplete,false);
  assert.equal(f.calls(),1);assert.equal(inspectHeldLifecycleHistory(f.events),null);
  assert.deepEqual(fs.readFileSync(path.join(f.root,'state.json')),before);assert.ok(fs.existsSync(path.join(f.root,'pending.json')));
  await runHeldLifecycle(f.input,f.options);assert.equal(f.calls(),1);
});
test('default native start refuses before lifecycle intent',async t=>{
  const f=fixture(t);delete f.options.start;
  await assert.rejects(runHeldLifecycle(f.input,f.options),/reconcile/);assert.equal(f.events.length,2);
});
test('lost systemctl response retains intent, blocks replay, and reconciles by observation only',async t=>{
  const f=fixture(t);let calls=0;f.options.start=async()=>{calls++;throw new Error('timeout');};
  await assert.rejects(runHeldLifecycle(f.input,f.options));assert.ok(inspectHeldLifecycleHistory(f.events));
  const inspected=inspectReleaseCommander(f.journal);assert.equal(inspected.lifecycleReconciliationRequired,true);assert.equal(inspected.mutationSent,null);
  await assert.rejects(runHeldLifecycle(f.input,f.options));assert.equal(calls,1);
  let sourceCalls=0;const blocked=await runReleasePreflight({input:{releaseSha,packageConfigurationFile:'/a',backupFile:'/b',diskConfigurationFile:'/c',backupManifestFile:'/d'},journal:f.journal},{verifySource:()=>sourceCalls++});assert.equal(blocked.preflightCompleted,false);assert.equal(sourceCalls,0);
  const result=await runHeldLifecycle({...f.input,reconcile:true},f.options);assert.equal(result.intakeOpen,false);assert.equal(calls,1);
});
test('partial or unknown running state cannot reconcile or retry',async t=>{
  const f=fixture(t);f.options.start=async()=>{throw new Error('unknown');};
  await assert.rejects(runHeldLifecycle(f.input,f.options));f.options.observe=async()=>{throw new Error('worker stopped');};
  await assert.rejects(runHeldLifecycle({...f.input,reconcile:true},f.options));assert.ok(inspectHeldLifecycleHistory(f.events));
});
test('exact source run role generations PID and retained proofs refuse mismatch',async t=>{
  for(const mutate of [p=>p.releaseSha='e'.repeat(40),p=>p.runId='wrong',p=>p.api.role='worker',p=>p.worker.generation=p.api.generation,p=>p.worker.pid=p.api.pid,p=>p.api.startTime='0']){
    const f=fixture(t);mutate(f.proof);await assert.rejects(runHeldLifecycle(f.input,f.options));assert.ok(inspectHeldLifecycleHistory(f.events));
  }
  const f=fixture(t);await runHeldLifecycle(f.input,f.options);f.proof.worker.generation='f'.repeat(32);await assert.rejects(runHeldLifecycle(f.input,f.options));assert.equal(f.calls(),1);
});
test('unsafe state and active lease deny before start',async t=>{
  for(const kind of ['open','marker','lease','stopped']){
    const f=fixture(t);let lease;
    if(kind==='open'){const file=path.join(f.root,'state.json'),state=f.options.readState(file);state.mode='open';fs.writeFileSync(file,JSON.stringify(state));}
    if(kind==='marker')fs.writeFileSync(path.join(f.root,'pending.json'),'{}');
    if(kind==='lease')lease=f.options.acquire({...f.options,exclusive:true});
    if(kind==='stopped')f.options.stopped=()=>{throw new Error('active');};
    try{await assert.rejects(runHeldLifecycle(f.input,f.options));assert.equal(f.calls(),0);}finally{lease?.close();}
  }
});
test('generation movement during post-start observation cannot confirm',async t=>{
  const f=fixture(t);let n=0;f.options.observe=async()=>{const p=structuredClone(f.proof);if(n++)p.worker.generation='f'.repeat(32);return p;};
  await assert.rejects(runHeldLifecycle(f.input,f.options));assert.ok(inspectHeldLifecycleHistory(f.events));
});
test('journal corruption and duplicate completed run refuse',async t=>{
  const f=fixture(t);await runHeldLifecycle(f.input,f.options);
  assert.throws(()=>inspectHeldLifecycleHistory([...f.events,f.events[2]]));
  const bad=structuredClone(f.events);bad[3].proof.api.role='worker';assert.throws(()=>inspectHeldLifecycleHistory(bad));
});
test('native observer rejects unknown systemctl without collecting processes or exposing output',async()=>{
  let captured=0;
  await assert.rejects(observeHeldLifecycle({releaseSha,runId:'12345678-1234-4234-8234-123456789abc'},{run:()=>({status:null,error:new Error('secret'),stderr:'secret',stdout:'secret'}),capture:()=>captured++}),e=>!e.message.includes('secret'));
  assert.equal(captured,0);
});

test('unknown global mutation blocks before lifecycle start or intent',async t=>{const f=fixture(t);f.events.push({type:'future_release_mutation'});await assert.rejects(runHeldLifecycle(f.input,f.options));assert.equal(f.calls(),0);assert.equal(f.events.length,3);});

test('native process observer checks real-role policy, production environment and repeat identity with sanitized output',async()=>{
  const runId='12345678-1234-4234-8234-123456789abc';
  function native(){
    const proc=(pid,uid,gid)=>({pid,uid,euid:uid,suid:uid,fsuid:uid,gid,egid:gid,sgid:gid,fsgid:gid,groups:[gid],noNewPrivileges:true,
      capEffective:'0000',capPermitted:'0000',capAmbient:'0000',capInheritable:'0000',startTime:String(1000+pid)});
    const pairs={api:{supervisor:proc(101,1001,1001),child:proc(102,1001,1001)},worker:{supervisor:proc(201,1002,1002),child:proc(202,1002,1002)}};
    const env=pid=>{const role=pid<200?'api':'worker';return Object.entries({NODE_ENV:'production',BLACKSPIRE_RUNTIME_MODE:'production',BLACKSPIRE_STATE_OWNER:'vps-production',
      UNIFIED_IPHONE_TEST_MODE:'false',BLACKSPIRE_DB_PATH:'/opt/blackspire-command/shared/database/command.sqlite',BLACKSPIRE_RUNTIME_USER:'blackspire-'+role,
      BLACKSPIRE_RELEASE_RUN_ID:runId,INVOCATION_ID:(role==='api'?'b':'c').repeat(32),SECRET:'never-output'}).map(([k,v])=>k+'='+v).join('\0')+'\0';};
    const options={uid:0,run:(_bin,args)=>{const unit=args.at(-1),role=unit==='blackspire-command.service'?'api':'worker';return{status:0,stderr:'',stdout:
      `Id=${unit}\nActiveState=active\nSubState=running\nMainPID=${pairs[role].supervisor.pid}\nInvocationID=${(role==='api'?'b':'c').repeat(32)}\nUser=blackspire-${role}\nControlGroup=/system.slice/${unit}\n`};},
      capture:({role})=>structuredClone(pairs[role]),identity:async()=>({uid:1001,workerUid:1002,credentialGroupId:1001}),
      artifact:async()=>({releaseSha,environment:'production',artifactDigest:'d'.repeat(64)}),readEnvironment:env};
    return{options,pairs};
  }
  const baseline=native();const proof=await observeHeldLifecycle({releaseSha,runId},baseline.options);assert.equal(proof.api.role,'api');assert.ok(!JSON.stringify(proof).includes('never-output'));
  for(const mutate of [f=>f.pairs.worker.child.groups.push(1001),f=>f.pairs.worker.supervisor.egid=0,
    f=>f.pairs.api.child.capEffective='0001',f=>{const original=f.options.readEnvironment;f.options.readEnvironment=pid=>original(pid).replace('NODE_ENV=production','NODE_ENV=test');},
    f=>{const original=f.options.readEnvironment;f.options.readEnvironment=pid=>original(pid).replace('BLACKSPIRE_RELEASE_RUN_ID='+runId,'BLACKSPIRE_RELEASE_RUN_ID=wrong');},
    f=>{f.options.artifact=async()=>({releaseSha:'e'.repeat(40),environment:'production',artifactDigest:'d'.repeat(64)});},
    f=>{const capture=f.options.capture;let calls=0;f.options.capture=args=>{const value=capture(args);if(calls++>1)value.child.startTime='9999';return value;};}]){
    const f=native();mutate(f);await assert.rejects(observeHeldLifecycle({releaseSha,runId},f.options),e=>e.code==='HELD_LIFECYCLE_REJECTED'&&!e.message.includes('never-output'));
  }
});

test('malformed recognized history cannot bypass commander validation',async t=>{const f=fixture(t);f.events.push({type:'preflight_passed'});await assert.rejects(runHeldLifecycle(f.input,f.options));assert.equal(f.calls(),0);assert.equal(f.events.length,3);});
