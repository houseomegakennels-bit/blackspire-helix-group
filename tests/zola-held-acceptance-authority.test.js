import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {acquireReleaseAdmissionLock,RELEASE_ADMISSION_LOCK} from '../packages/shared/release-admission.js';
import {HELD_ACCEPTANCE_CAPABILITIES,HELD_ACCEPTANCE_OPERATIONS,authorizeHeldAcceptanceOperation,consumeHeldAcceptancePermit,finishHeldAcceptancePermit,inspectHeldAcceptanceHistory,mintHeldAcceptancePermit} from '../packages/zola-release/held-acceptance-authority.js';

const releaseSha='a'.repeat(40),apiGeneration='1'.repeat(32),workerGeneration='2'.repeat(32);
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'held-acceptance-'));fs.writeFileSync(path.join(root,'admission.lock'),RELEASE_ADMISSION_LOCK,{mode:0o640});
 const epochRunId=randomUUID(),state={version:1,mode:'held',releaseSha,runId:epochRunId,apiGeneration:null,workerGeneration:null};fs.writeFileSync(path.join(root,'state.json'),JSON.stringify(state)+'\n',{mode:0o640});
 const events=[],journal={stream:()=>({events:()=>structuredClone(events),append:row=>events.push(structuredClone(row))})};
 const acquire=options=>acquireReleaseAdmissionLock({...options,checkDirectory:()=>{}}),reads=HELD_ACCEPTANCE_CAPABILITIES.map((capability,index)=>({index,idempotencyKey:`zola-six:${epochRunId}:${index}`,capability,permission:capability.replace(/\.(search|get|status)$/,'.read'),requestDigest:String(index+3).repeat(64)}));
 const input={commanderRunId:randomUUID(),mergeMainSha:releaseSha,expectedDeploymentSha:releaseSha,epochRunId,workspace:'blackspire-command',apiGeneration,workerGeneration,reads,journal,
  verifyGenerations:()=>({apiGeneration,workerGeneration})};
 const deps={root,owner:process.getuid(),groupId:process.getgid(),secretGroupId:process.getgid(),acquire,readState:()=>JSON.parse(fs.readFileSync(path.join(root,'state.json'),'utf8')),
  readAuthority:()=>JSON.parse(fs.readFileSync(path.join(root,'acceptance.json'),'utf8')),
  readSecret:()=>JSON.parse(fs.readFileSync(path.join(root,'acceptance-secret.json'),'utf8')),verifyGenerations:()=>({apiGeneration,workerGeneration}),getuid:()=>0};
 return{root,events,journal,acquire,input,deps,cleanup:()=>fs.rmSync(root,{recursive:true,force:true})};
}
test('single-use HELD permit binds exact epoch/deployment/generations and is permanently consumed',()=>{
 const f=fixture();try{
  const minted=mintHeldAcceptancePermit(f.input,f.deps);assert.equal(inspectHeldAcceptanceHistory(f.events).status,'MINTED');
  const session=consumeHeldAcceptancePermit({token:minted.token,journal:f.journal},f.deps);
  const binding={mergeMainSha:releaseSha,expectedDeploymentSha:releaseSha,epochRunId:f.input.epochRunId,workspace:f.input.workspace,apiGeneration,workerGeneration};
  for(const operation of HELD_ACCEPTANCE_OPERATIONS)authorizeHeldAcceptanceOperation(session,operation,binding);
  const result=finishHeldAcceptancePermit(session);assert.equal(result.status,'CONSUMED');assert.equal(inspectHeldAcceptanceHistory(f.events).status,'CONSUMED');assert.equal(fs.existsSync(path.join(f.root,'acceptance.json')),false);
  assert.throws(()=>consumeHeldAcceptancePermit({token:minted.token,journal:f.journal},f.deps));
 }finally{f.cleanup();}
});
test('wrong token, drift, replay, omitted operation and expiry fail closed without OPEN state',()=>{
 for(const mode of ['token','generation','secret','duplicate','unfinished','expiry']){
  const f=fixture();try{
   let clock=1000;const minted=mintHeldAcceptancePermit({...f.input,now:()=>clock},f.deps);
   if(mode==='generation')f.deps.verifyGenerations=()=>({apiGeneration:'3'.repeat(32),workerGeneration});
   if(mode==='secret')fs.unlinkSync(path.join(f.root,'acceptance-secret.json'));
   if(mode==='expiry')clock+=15*60*1000;
   if(['token','generation','secret','expiry'].includes(mode)){assert.throws(()=>consumeHeldAcceptancePermit({token:mode==='token'?'x'.repeat(43):minted.token,journal:f.journal,now:()=>clock},f.deps));continue;}
   const session=consumeHeldAcceptancePermit({token:minted.token,journal:f.journal,now:()=>clock},f.deps);
   const binding={mergeMainSha:releaseSha,expectedDeploymentSha:releaseSha,epochRunId:f.input.epochRunId,workspace:f.input.workspace,apiGeneration,workerGeneration};
   authorizeHeldAcceptanceOperation(session,HELD_ACCEPTANCE_OPERATIONS[0],binding);
   if(mode==='duplicate')assert.throws(()=>authorizeHeldAcceptanceOperation(session,HELD_ACCEPTANCE_OPERATIONS[0],binding));
   assert.throws(()=>finishHeldAcceptancePermit(session));assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'state.json'))).mode,'held');
  }finally{f.cleanup();}
 }
});
test('lost mint acknowledgement recovers the same protected token without reminting or disclosure',()=>{
 const f=fixture();try{
  let fail=true;const append=f.journal.stream().append;
  f.journal.stream=()=>({events:()=>structuredClone(f.events),append:row=>{if(fail&&row.type==='held_acceptance_minted')throw new Error('lost append');append(row);}});
  assert.throws(()=>mintHeldAcceptancePermit(f.input,f.deps));assert.equal(inspectHeldAcceptanceHistory(f.events).status,'MINT_UNKNOWN');
  const secret=JSON.parse(fs.readFileSync(path.join(f.root,'acceptance-secret.json'),'utf8'));assert.equal(JSON.stringify(f.events).includes(secret.token),false);
  assert.throws(()=>mintHeldAcceptancePermit({...f.input,workspace:'other-workspace'},f.deps));assert.equal(inspectHeldAcceptanceHistory(f.events).status,'MINT_UNKNOWN');
  fail=false;const recovered=mintHeldAcceptancePermit(f.input,f.deps);assert.equal(recovered.token,secret.token);assert.equal(inspectHeldAcceptanceHistory(f.events).status,'MINTED');
 }finally{f.cleanup();}
});
