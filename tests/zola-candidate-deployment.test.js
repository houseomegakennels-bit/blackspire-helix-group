import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {hash} from '../packages/zola-release/commander-journal.js';
import {createCandidateDeploymentHost,prepareCandidateDeployment,inspectCandidateDeploymentHistory,verifyCandidateDeploymentForStart} from '../packages/zola-release/candidate-deployment.js';
const input={operationId:'11111111-1111-4111-8111-111111111111',releaseSha:'a'.repeat(40),recoverySha:'b'.repeat(40)};
const receiverOrigin={schema:1,mode:'preview',releaseSha:input.releaseSha,origin:'https://fixture.vercel.app',deploymentId:'dpl_fixture',previousOrigin:null,previousDropin:false};
const previousSha='c'.repeat(40),runId='22222222-2222-4222-8222-222222222222';
function fixture(){
 const events=[],calls=[],done=new Set(),state={mode:'held',releaseSha:input.releaseSha,runId,apiGeneration:null,workerGeneration:null};
 const plan={...input,runId,previousSha,artifactDigest:'1'.repeat(64),recoveryArtifactDigest:'2'.repeat(64),previousArtifactDigest:'3'.repeat(64),stateDigest:hash(state),receiverOrigin};
 const journal={stream:()=>({events:()=>structuredClone(events),append:v=>events.push(structuredClone(v))})};let locked=false;
 const host={lease:()=>{assert.equal(locked,false);locked=true;return{assertIdentity(){assert.equal(locked,true);},close(){locked=false;}};},prepare:async()=>plan,check(){assert.equal(state.mode,'held');},
  execute:async step=>{calls.push(step);done.add(step);},observe:async step=>done.has(step)};
 return{events,calls,done,state,plan,journal,host};
}
test('candidate journal preserves distinct current, candidate and recovery identities and completed replay is inert',async()=>{
 const f=fixture();await prepareCandidateDeployment(input,f);assert.deepEqual(f.calls,['pointer','runtime','receivers','reload']);
 const s=inspectCandidateDeploymentHistory(f.events);assert.equal(s.completed,true);assert.equal(s.plan.previousSha,previousSha);assert.equal(s.plan.recoverySha,input.recoverySha);
 await prepareCandidateDeployment(input,f);assert.equal(f.calls.length,4);
 await verifyCandidateDeploymentForStart({releaseSha:input.releaseSha,runId,journal:f.journal},{host:f.host});
 f.state.mode='open';await assert.rejects(verifyCandidateDeploymentForStart({releaseSha:input.releaseSha,runId,journal:f.journal},{host:f.host}));
});
for(const step of ['pointer','runtime','receivers','reload'])test(`unknown ${step} outcome is observed without repeating effects`,async()=>{
 const f=fixture(),execute=f.host.execute;let once=true;f.host.execute=async s=>{await execute(s);if(s===step&&once){once=false;throw new Error('lost acknowledgement');}};
 await assert.rejects(prepareCandidateDeployment(input,f));assert.equal(inspectCandidateDeploymentHistory(f.events).pending,step);
 await prepareCandidateDeployment(input,f);assert.equal(f.calls.filter(s=>s===step).length,1);assert.equal(inspectCandidateDeploymentHistory(f.events).completed,true);
});
test('unobservable interrupted pointer never retries or advances under a new identity',async()=>{
 const f=fixture();f.host.execute=async step=>{f.calls.push(step);throw new Error('unknown');};
 await assert.rejects(prepareCandidateDeployment(input,f));await assert.rejects(prepareCandidateDeployment(input,f));
 await assert.rejects(prepareCandidateDeployment({...input,operationId:runId},f));assert.deepEqual(f.calls,['pointer']);assert.equal(f.events.length,2);
});
test('strict candidate grammar rejects reordered, duplicated, foreign or extra events',async()=>{
 const f=fixture();await prepareCandidateDeployment(input,f);
 for(const mutate of [r=>r.push(r.at(-1)),r=>r[1].step='runtime',r=>r[2].recoverySha=input.releaseSha,r=>r[1].extra=true,r=>r[1].type='candidate_deployment_unknown']){
  const rows=structuredClone(f.events);mutate(rows);assert.throws(()=>inspectCandidateDeploymentHistory(rows));
 }
});
test('native candidate host switches real pointer, writes protected epoch file and verifies reload before readiness', {skip:process.getuid?.()!==0},async()=>{
 const root=fs.mkdtempSync('/run/zola-candidate-'),admission=path.join(root,'admission'),events=[],calls=[];
 try{
  fs.mkdirSync(admission,{mode:0o750});fs.mkdirSync(path.join(root,'releases'));
  for(const s of [previousSha,input.releaseSha,input.recoverySha])fs.mkdirSync(path.join(root,'releases',s));
  fs.symlinkSync(path.join(root,'releases',previousSha),path.join(root,'current'));
  const state={version:1,mode:'held',releaseSha:input.releaseSha,runId,apiGeneration:null,workerGeneration:null};fs.writeFileSync(path.join(admission,'state.json'),JSON.stringify(state),{mode:0o640});
  const proof=async ({releaseSha})=>({releaseSha,environment:'production',artifactDigest:releaseSha===input.releaseSha?'1'.repeat(64):releaseSha===input.recoverySha?'2'.repeat(64):'3'.repeat(64)});
  let receiversPrepared=false;
  const host=createCandidateDeploymentHost({receiver:{prepare:async()=>receiverOrigin,publish:async()=>{assert.equal(inspectCandidateDeploymentHistory(events).pending,'receivers');receiversPrepared=true;},observe:()=>receiversPrepared},root,admission,inspectSealed:proof,inspectDeployed:proof,stopped(){calls.push('stopped');},acquire:()=>({assertIdentity(){},close(){}}),run(file,args,env){
   calls.push(args.includes('daemon-reload')?'reload':args[0]);
   if(args[0].endsWith('release-switch.sh')){assert.equal(env.BLACKSPIRE_DEPLOYMENT_ENVIRONMENT,'production');assert.equal(inspectCandidateDeploymentHistory(events).pending,'pointer');fs.unlinkSync(path.join(root,'current'));fs.symlinkSync(path.join(root,'releases',args[1]),path.join(root,'current'));}
   if(args.includes('show'))return `NeedDaemonReload=no\nWorkingDirectory=${root}/current\n`;return '';
  }});
  const journal={stream:()=>({events:()=>structuredClone(events),append:v=>events.push(structuredClone(v))})};
  await prepareCandidateDeployment(input,{host,journal});assert.equal(fs.realpathSync(path.join(root,'current')),path.join(root,'releases',input.releaseSha));
  const file=path.join(admission,'runtime.env');assert.equal(fs.readFileSync(file,'utf8'),`BLACKSPIRE_RELEASE_RUN_ID=${runId}\n`);assert.equal(fs.statSync(file).mode&0o777,0o640);assert.equal(calls.filter(x=>x==='reload').length,1);
  fs.writeFileSync(file,'BLACKSPIRE_RELEASE_RUN_ID=drift\n');await assert.rejects(verifyCandidateDeploymentForStart({releaseSha:input.releaseSha,runId,journal},{host}));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('composed confirmed HELD rerun does not re-enter the stopped-only hold or repeat candidate effects',async()=>{
 const {establishCandidateHeld}=await import('../packages/zola-release/production-held-operations.js');
 const f=fixture(),hold={schema:1,type:'release_hold_result',releaseSha:input.releaseSha,runId,stateDigest:f.plan.stateDigest};
 let engages=0,lifecycles=0;
 const context={input,journal:f.journal},deps={root:'/unused',groupId:0,
  engage(){engages++;f.events.push({...hold,type:'release_hold_intent'},hold);},sequence:()=>({context:{operationId:input.operationId}}),
  prepare:(value)=>prepareCandidateDeployment(value,f),lifecycle:async()=>{lifecycles++;return{status:'HELD_LIFECYCLE_OBSERVED'};}};
 await establishCandidateHeld(context,deps);await establishCandidateHeld(context,deps);
 assert.equal(engages,1);assert.equal(lifecycles,2);assert.deepEqual(f.calls,['pointer','runtime','receivers','reload']);
 f.events.find(e=>e.type==='release_hold_result').releaseSha=previousSha;
 await assert.rejects(establishCandidateHeld(context,deps));assert.equal(lifecycles,2);
});
