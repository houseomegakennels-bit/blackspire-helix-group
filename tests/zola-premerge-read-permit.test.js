import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {runPremergeReadPermit,inspectPremergeReadHistory} from '../packages/zola-release/premerge-read-permit.js';
import {runReleaseSequence,RELEASE_STAGES,MUTATING_STAGES} from '../packages/zola-release/commander-sequence.js';
import {RELEASE_ADMISSION_LOCK,withPremergeReadAdmission,withHeldAcceptanceAdmission,heldAcceptanceContext,acquireReleaseAdmissionLock} from '../packages/shared/release-admission.js';
import {hash} from '../packages/zola-release/commander-journal.js';
const rootOnly={skip:process.getuid()!==0};
function fixture(t){
 const root=fs.mkdtempSync('/root/zola-premerge-permit-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const epoch=randomUUID(),releaseSha='a'.repeat(40),apiGeneration='1'.repeat(32),workerGeneration='2'.repeat(32);
 const state={version:1,mode:'held',releaseSha,runId:epoch,apiGeneration:null,workerGeneration:null};
 fs.writeFileSync(path.join(root,'state.json'),JSON.stringify(state),{mode:0o640});
 fs.writeFileSync(path.join(root,'admission.lock'),RELEASE_ADMISSION_LOCK,{mode:0o640});fs.chmodSync(path.join(root,'admission.lock'),0o640);
 const input={releaseSha,previousMainSha:'b'.repeat(40),recoverySha:'c'.repeat(40),protectedInputDigest:'d'.repeat(64),workspace:'zola-production',principal:'blackspire-release-root'};input.inputDigest=hash(input);
 const events=[],journal={stream:()=>({events:()=>structuredClone(events),append:event=>events.push(structuredClone(event))})};
 const context={input,journal},config={version:4,releaseSha,workspace:'blackspire-command',principal:'blackspire-operator',dealId:'DE-0001',runId:epoch};
 const proof={releaseSha,runId:epoch,artifactDigest:'e'.repeat(64),api:{generation:apiGeneration},worker:{generation:workerGeneration}};
 const options={root,observe:async()=>proof};
 const admission=role=>({root,required:()=>true,context:()=>({role,releaseSha,runId:epoch,generation:role==='api'?apiGeneration:workerGeneration,apiGeneration,workerGeneration})});
 const pass=()=>({status:'PASS',evidence:{ok:true}}),stop=()=>({status:'BLOCKED_EXTERNAL'});
 const adapters=Object.fromEntries(RELEASE_STAGES.map(stage=>[stage,{check:stage==='rollback_acceptance'?stop:pass,observe:pass,
  ...(MUTATING_STAGES.has(stage)?{execute(){},reconcile:pass}:{})}]));
 adapters.admission_lease.reconcile=()=>({status:'PASS',evidence:{epochRunId:epoch}});
 const evidence={readCount:6,crossOwnerDenials:6,paidProviderCalls:0,mutationDelta:0,collectorDigest:'f'.repeat(64)};
 return{root,state,input,events,journal,context,config,options,admission,adapters,evidence};
}
test('candidate permit spans only its six-read interval and retained result reconciles without collection',rootOnly,async t=>{
 const f=fixture(t);let calls=0,lastCall;
 f.adapters.six_reads={check:()=>({status:'PASS',evidence:{fixed:true}}),execute(){},observe(){throw new Error('unused');},reconcile:async call=>{
  lastCall=call;const value=await runPremergeReadPermit({context:f.context,call,config:f.config,collect:async()=>{
   calls++;const secret=JSON.parse(fs.readFileSync(path.join(f.root,'premerge-reads-secret.json')));
   const claims=JSON.parse(fs.readFileSync(path.join(f.root,'premerge-reads.json')));
   assert.equal(claims.candidateSha,f.input.releaseSha);assert.equal(claims.workspace,'blackspire-command');
   assert.throws(()=>withHeldAcceptanceAdmission({role:'api',token:secret.token},()=>0,f.admission('api')));
   await withPremergeReadAdmission({role:'api',token:secret.token},async()=>{
    assert.equal(heldAcceptanceContext().reads.length,6);assert.throws(()=>acquireReleaseAdmissionLock({root:f.root,exclusive:true,owner:0,groupId:0}));
   },f.admission('api'));
   assert.equal(withPremergeReadAdmission({role:'worker'},()=>heldAcceptanceContext().operation,f.admission('worker')),'six_reads');
   return f.evidence;
  }},f.options);return{status:'PASS',evidence:value};}};
 const result=await runReleaseSequence({input:f.input,journal:f.journal,adapters:f.adapters});assert.equal(result.stage,'rollback_acceptance');assert.equal(calls,1);
 const history=inspectPremergeReadHistory(f.events);assert.equal(history.retired,true);assert.equal(history.result.evidence.readCount,6);
 assert.equal(fs.existsSync(path.join(f.root,'premerge-reads-active.json')),false);assert.equal(fs.existsSync(path.join(f.root,'acceptance.json')),false);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root,'state.json'))),f.state);
 const index=f.events.findIndex(row=>row.type==='sequence_stage_confirmed'&&row.stage==='six_reads');f.events.splice(index);
 const resumed=await runPremergeReadPermit({context:f.context,call:lastCall,config:f.config,collect:()=>{throw new Error('replayed');}},f.options);
 assert.deepEqual(resumed,f.evidence);
 const original=structuredClone(f.events);for(const mutate of [rows=>rows.find(row=>row.type==='premerge_reads_intent').claims.candidateSha='9'.repeat(40),
  rows=>rows.find(row=>row.type==='premerge_reads_active').attemptId=randomUUID(),rows=>rows.find(row=>row.type==='premerge_reads_result').evidence.paidProviderCalls=1]){
  const rows=structuredClone(original);mutate(rows);assert.throws(()=>inspectPremergeReadHistory(rows));
 }
});
test('unknown collection retires authority and never repeats admissions on resume',rootOnly,async t=>{
 const f=fixture(t);let calls=0,lastCall;
 f.adapters.six_reads={check:()=>({status:'PASS',evidence:{fixed:true}}),execute(){},observe(){throw new Error('unused');},reconcile:async call=>{lastCall=call;
  return runPremergeReadPermit({context:f.context,call,config:f.config,collect:()=>{calls++;throw new Error('lost HTTP response');}},f.options);}};
 assert.equal((await runReleaseSequence({input:f.input,journal:f.journal,adapters:f.adapters})).releaseState,'FAIL_CLOSED');
 assert.equal(inspectPremergeReadHistory(f.events).retired,true);assert.equal(fs.existsSync(path.join(f.root,'premerge-reads-active.json')),false);
 await assert.rejects(()=>runPremergeReadPermit({context:f.context,call:lastCall,config:f.config,collect:()=>{calls++;}},f.options));assert.equal(calls,1);
});

test('retained result resumes retirement after lock contention or interrupted unlink without recollection',rootOnly,async t=>{
 for(const fault of ['exclusive-lock','retired-append']){
  const f=fixture(t);let failing=true,lastCall,collections=0;
  const originalStream=f.journal.stream;
  f.journal.stream=()=>({...originalStream(),append:row=>{if(fault==='retired-append'&&failing&&row.type==='premerge_reads_retired')throw new Error('lost after unlink');f.events.push(structuredClone(row));}});
  const options={...f.options,acquire:input=>{if(fault==='exclusive-lock'&&failing&&f.events.some(row=>row.type==='premerge_reads_result'))throw new Error('worker lease held');return acquireReleaseAdmissionLock(input);}};
  f.adapters.six_reads={check:()=>({status:'PASS',evidence:{fixed:true}}),execute(){},observe(){throw new Error('unused');},reconcile:async call=>{lastCall=call;
   return{status:'PASS',evidence:await runPremergeReadPermit({context:f.context,call,config:f.config,collect:async()=>{collections++;return f.evidence;}},options)};}};
  assert.equal((await runReleaseSequence({input:f.input,journal:f.journal,adapters:f.adapters})).releaseState,'FAIL_CLOSED');
  const before=inspectPremergeReadHistory(f.events);assert.ok(before.result);assert.equal(before.retired,false);assert.equal(collections,1);
  assert.equal(fs.existsSync(path.join(f.root,'premerge-reads-active.json')),fault==='exclusive-lock');
  failing=false;const result=await runPremergeReadPermit({context:f.context,call:lastCall,config:f.config,collect:()=>{collections++;throw new Error('replay');}},options);
  assert.deepEqual(result,f.evidence);assert.equal(collections,1);assert.equal(inspectPremergeReadHistory(f.events).retired,true);
  assert.equal(fs.existsSync(path.join(f.root,'premerge-reads-active.json')),false);
 }
});
test('interrupted secret, claims or active publication never dispatches collection on resume',rootOnly,async t=>{
 for(const name of ['premerge-reads-secret.json','premerge-reads.json','premerge-reads-active.json']){
  const f=fixture(t);let lastCall,collections=0;
  const io={...fs,writeFileSync(fd,bytes){fs.writeFileSync(fd,bytes);if(fs.readlinkSync('/proc/self/fd/'+fd).endsWith('/'+name))throw new Error('publication interruption');}};
  f.adapters.six_reads={check:()=>({status:'PASS',evidence:{fixed:true}}),execute(){},observe(){throw new Error('unused');},reconcile:async call=>{lastCall=call;
   return runPremergeReadPermit({context:f.context,call,config:f.config,collect:()=>{collections++;return f.evidence;}},{...f.options,io});}};
  assert.equal((await runReleaseSequence({input:f.input,journal:f.journal,adapters:f.adapters})).releaseState,'FAIL_CLOSED');
  assert.ok(inspectPremergeReadHistory(f.events).intent);assert.equal(collections,0);
  await assert.rejects(()=>runPremergeReadPermit({context:f.context,call:lastCall,config:f.config,collect:()=>{collections++;return f.evidence;}},f.options));
  assert.equal(collections,0);assert.equal(fs.existsSync(path.join(f.root,'acceptance.json')),false);
 }
});
