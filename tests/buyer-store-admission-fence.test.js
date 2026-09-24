import {spawnSync} from 'node:child_process';
import {acquireReleaseAdmissionLock,RELEASE_ADMISSION_LOCK} from '../packages/shared/release-admission.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createBuyerStoreAdmissionFence} from '../packages/buyer-store/admission-fence.js';
import {createBuyerStoreLocalServer} from '../packages/buyer-store/local-server.js';
import {mac} from '../packages/buyer-store/local-protocol.js';
const binding={releaseSha:'a'.repeat(40),runId:'00000000-0000-0000-0000-000000000001',apiGeneration:'b'.repeat(32),workerGeneration:'c'.repeat(32)};
test('daemon lease survives actual IPC disconnect until handler commit/drain finishes',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-fence-')),socketPath=dir+'/s';let closed=0,entered,finish;
 const started=new Promise(resolve=>{entered=resolve;}),blocked=new Promise(resolve=>{finish=resolve;});
 const lockPath=dir+'/admission.lock';fs.writeFileSync(lockPath,RELEASE_ADMISSION_LOCK,{mode:0o640});
 const exclusive=()=>spawnSync('/usr/bin/flock',['--exclusive','--nonblock',lockPath,'/usr/bin/true']).status;
 const actualFence=createBuyerStoreAdmissionFence({groupId:process.getgid(),attestation:{binding:()=>binding},readState:()=>({version:1,mode:'open',...binding}),
  acquire:()=>{const lease=acquireReleaseAdmissionLock({root:dir,owner:process.getuid(),groupId:process.getgid(),checkDirectory(){}});return {assertIdentity:()=>lease.assertIdentity(),close(){lease.close();closed++;}};}});
 const configuration={version:1,releaseSha:binding.releaseSha,profileDigest:'d'.repeat(64),key:'e'.repeat(43)};
 const server=createBuyerStoreLocalServer({configuration,fence:actualFence,validateInput:(_op,input)=>input,readCapabilityProfiles:async()=>{},
  userHandler:async()=>{entered();await blocked;assert.equal(closed,0);return {ok:true};}});
 await new Promise(resolve=>server.listen(socketPath,resolve));
 try{
  const request={version:1,releaseSha:binding.releaseSha,profileDigest:configuration.profileDigest,id:'f'.repeat(32),timestamp:Date.now(),lane:'user',body:{operation:'job-create',accessToken:'synthetic',input:{}}};
  const socket=net.createConnection({path:socketPath});socket.on('error',()=>{});await new Promise(resolve=>socket.once('connect',resolve));
  socket.end(JSON.stringify({...request,mac:mac(request,configuration.key)})+'\n');await started;assert.equal(exclusive(),1);socket.destroy();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(closed,0);
  finish();for(let n=0;n<20&&closed===0;n++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(closed,1);assert.equal(exclusive(),0);
 }finally{finish();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
});
test('HELD rejects user writes before handler but allows bound read-only lane',async()=>{
 let called=0,closed=0;
 const fence=createBuyerStoreAdmissionFence({groupId:1,attestation:{binding:()=>binding},readState:()=>({version:1,mode:'held',...binding,apiGeneration:null,workerGeneration:null}),acquire:()=>({assertIdentity(){},close(){closed++;}})});
 await assert.rejects(fence.run('user',async()=>{called++;}));assert.equal(called,0);
 await fence.run('profiles-read',async()=>{called++;});assert.equal(called,1);assert.equal(closed,2);
 const wrong=createBuyerStoreAdmissionFence({groupId:1,attestation:{binding:()=>binding},readState:()=>({version:1,mode:'open',...binding,runId:'00000000-0000-0000-0000-000000000002'}),acquire:()=>({assertIdentity(){},close(){}})});
 await assert.rejects(wrong.run('user',async()=>{called++;}));assert.equal(called,1);
});

test('stamped live HELD permits exact read-only generation pair but denies mixed or drifted bindings',async()=>{
 for(const [apiGeneration,workerGeneration,allowed]of [[binding.apiGeneration,binding.workerGeneration,true],[null,null,true],[null,binding.workerGeneration,false],[binding.apiGeneration,null,false],['d'.repeat(32),binding.workerGeneration,false]]){
  let entered=false;
  const fence=createBuyerStoreAdmissionFence({groupId:1,attestation:{binding:()=>binding},readState:()=>({version:1,mode:'held',...binding,apiGeneration,workerGeneration}),acquire:()=>({assertIdentity(){},close(){}})});
  const run=()=>fence.run('profiles-read',async()=>{entered=true;});if(allowed)await run();else await assert.rejects(run());
  assert.equal(entered,allowed);await assert.rejects(fence.run('user',async()=>assert.fail()));
 }
});

test('real pending marker allows only the exact HELD profiles lane and retains the shared lock',async()=>{
 const dir=fs.mkdtempSync('/run/buyer-held-pending-');
 const lockPath=dir+'/admission.lock';
 fs.writeFileSync(lockPath,RELEASE_ADMISSION_LOCK,{mode:0o640});
 fs.writeFileSync(dir+'/pending.json','{}\n',{mode:0o600});
 let state={version:1,mode:'held',...binding,apiGeneration:null,workerGeneration:null},entered=0;
 const fence=createBuyerStoreAdmissionFence({groupId:process.getgid(),attestation:{binding:()=>binding},
  readState:()=>structuredClone(state),
  acquire:options=>acquireReleaseAdmissionLock({...options,root:dir,owner:process.getuid(),checkDirectory(){}})});
 const exclusive=()=>spawnSync('/usr/bin/flock',['--exclusive','--nonblock',lockPath,'/usr/bin/true']).status;
 try{
  await fence.run('profiles-read',async()=>{entered++;assert.equal(exclusive(),1);await new Promise(resolve=>setImmediate(resolve));assert.equal(exclusive(),1);});
  assert.equal(entered,1);assert.equal(exclusive(),0);
  await assert.rejects(fence.run('user',async()=>{entered++;}));
  state={version:1,mode:'open',...binding};
  await assert.rejects(fence.run('profiles-read',async()=>{entered++;}));
  state={version:1,mode:'held',...binding,workerGeneration:'d'.repeat(32)};
  await assert.rejects(fence.run('profiles-read',async()=>{entered++;}));
  assert.equal(entered,1);assert.equal(exclusive(),0);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('HELD observation cannot authorize a read after state switches OPEN before locking',async()=>{
 let reads=0,entered=false,closed=false;
 const fence=createBuyerStoreAdmissionFence({groupId:1,attestation:{binding:()=>binding},
  readState:()=>({version:1,...binding,mode:++reads===1?'held':'open'}),
  acquire:options=>{assert.equal(options.allowPending,true);return{assertIdentity(){},close(){closed=true;}};}});
 await assert.rejects(fence.run('profiles-read',async()=>{entered=true;}));
 assert.equal(entered,false);assert.equal(closed,true);
});
