import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {acquireReleaseAdmissionLock,createReleaseAdmissionGuard,withHeldWriterPreparation,
 heldWriterPreparationContext,RELEASE_ADMISSION_LOCK} from '../packages/shared/release-admission.js';
import {createBuyerWriterAvailability,createBuyerWriterPreparation} from '../packages/buyer-writer/availability.js';
import {createBuyerWriterHttpServer} from '../packages/buyer-writer/http.js';
const releaseSha='a'.repeat(40),apiGeneration='b'.repeat(32),workerGeneration='c'.repeat(32);
const runId='11111111-1111-4111-8111-111111111111';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'held-writer-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'admission.lock'),RELEASE_ADMISSION_LOCK,{mode:0o640});fs.chmodSync(path.join(root,'admission.lock'),0o640);
 const binding={role:'api',releaseSha,runId,generation:apiGeneration,apiGeneration,workerGeneration};
 const state={version:1,mode:'held',releaseSha,runId,apiGeneration:null,workerGeneration:null};
 const acquire=options=>acquireReleaseAdmissionLock({root,owner:process.getuid(),groupId:process.getgid(),checkDirectory:()=>{},...options});
 const deps={required:()=>true,acquire,context:()=>binding,readState:()=>structuredClone(state)};
 const admit=createReleaseAdmissionGuard(deps),prepare=fn=>withHeldWriterPreparation(fn,deps);
 const worker={required:true,ok:true,state:'idle',heartbeatAgeMs:1,generationId:workerGeneration,restartDetected:false};
 const identity={state:'VERIFIED',build:{value:releaseSha},environment:{value:'production'}};
 const health={ok:true,service:'blackspire-command-api',lifecycle:'ready',database:'available',emergencyStop:false,dependencies:{worker:{...worker},scheduler:{ok:true}},deploymentIdentity:identity};
 const ready={ok:false,service:'blackspire-command-api',lifecycle:'ready',database:'compatible',productionConfig:{ok:true},
  checks:{releaseAdmission:false,lifecycle:true,database:true,productionConfig:true,worker:true,scheduler:true,deploymentIdentity:true},
  dependencies:{worker:{...worker},scheduler:{ok:true}},deploymentIdentity:identity};
 let observations=0;
 const options={workspace:'blackspire-command',releaseSha,apiGeneration,environment:'production',
  getHealth:()=>health,getReadiness:()=>ready,observeBinding:async()=>{observations++;return{approved:true,credentialsSeparated:true,workspace:'blackspire-command',releaseSha,apiGeneration,workerGeneration};}};
 return{root,binding,state,acquire,deps,admit,prepare,health,ready,options,get observations(){return observations;}};
}
test('HELD API preparation spans a shared lease while ordinary admission and availability remain closed',async t=>{
 const f=fixture(t),prepared=createBuyerWriterPreparation(f.options),available=createBuyerWriterAvailability(f.options);
 assert.equal(await prepared(),false);
 for(const minted of [false,true]){
  if(minted)Object.assign(f.state,{apiGeneration,workerGeneration});
  assert.equal(await f.prepare(async()=>{
   assert.equal(heldWriterPreparationContext().role,'api');
   assert.throws(()=>f.acquire({exclusive:true}),/held/);
   assert.throws(()=>f.admit.run(()=>assert.fail('ordinary dispatch')),/held/);
   assert.deepEqual(f.admit.status(),{required:true,open:false});
   assert.equal(await available(),false);return prepared();
  }),true);
  assert.equal(heldWriterPreparationContext(),null);f.acquire({exclusive:true}).close();
 }
});
test('wrong mode, role, source, run and partial or mismatched generations refuse before callback',t=>{
 const changes=[f=>{f.state.mode='open';Object.assign(f.state,{apiGeneration,workerGeneration});},f=>{f.binding.role='worker';},
  f=>{f.state.releaseSha='d'.repeat(40);},f=>{f.state.runId='22222222-2222-4222-8222-222222222222';},
  f=>{f.state.apiGeneration=apiGeneration;},f=>{f.state.workerGeneration=workerGeneration;},
  f=>{f.binding.workerGeneration=apiGeneration;},f=>{f.binding.generation='e'.repeat(32);},
  f=>{Object.assign(f.state,{apiGeneration,workerGeneration:'e'.repeat(32)});}];
 for(const mutate of changes){const f=fixture(t);mutate(f);assert.throws(()=>f.prepare(()=>assert.fail('callback')),/held/);f.acquire({exclusive:true}).close();}
});
test('end-of-callback state/context drift and rejection close the lease without leaking scope',async t=>{
 for(const mutate of [f=>{f.binding.workerGeneration='d'.repeat(32);},f=>{f.state.mode='open';Object.assign(f.state,{apiGeneration,workerGeneration});}]){
  const f=fixture(t);await assert.rejects(f.prepare(async()=>{await Promise.resolve();mutate(f);return true;}),/held/);
  assert.equal(heldWriterPreparationContext(),null);f.acquire({exclusive:true}).close();
 }
 const f=fixture(t);let releaseChild,child;
 await f.prepare(async()=>{child=new Promise(resolve=>{releaseChild=resolve;}).then(()=>heldWriterPreparationContext());});
 releaseChild();assert.equal(await child,null);
 await assert.rejects(f.prepare(async()=>{throw new Error('callback');}),/callback/);f.acquire({exclusive:true}).close();
});
test('only closed release admission is tolerated; unrelated or missing checks fail before binding observation',async t=>{
 const changes=[...['lifecycle','database','productionConfig','worker','scheduler','deploymentIdentity'].map(key=>f=>{f.ready.checks[key]=false;}),
  f=>{delete f.ready.checks.worker;},f=>{f.ready.checks.unknown=false;},f=>{f.ready.checks.releaseAdmission=true;},
  f=>{f.ready.ok=true;},f=>{f.health.emergencyStop=true;},f=>{f.health.dependencies.scheduler.ok=false;},
  f=>{f.ready.dependencies.worker.restartDetected=true;},f=>{f.ready.dependencies.worker.generationId='e'.repeat(32);},
  f=>{f.health.dependencies.worker.heartbeatAgeMs=30001;},f=>{f.ready.productionConfig.ok=false;}];
 for(const mutate of changes){const f=fixture(t);mutate(f);assert.equal(await f.prepare(createBuyerWriterPreparation(f.options)),false);assert.equal(f.observations,0);}
});
test('readiness or generation drift during binding observation prevents preparation success',async t=>{
 for(const mutate of [f=>{f.ready.checks.scheduler=false;},f=>{f.health.dependencies.worker.generationId='e'.repeat(32);}]){
  const f=fixture(t),observe=f.options.observeBinding;f.options.observeBinding=async()=>{const proof=await observe();mutate(f);return proof;};
  assert.equal(await f.prepare(createBuyerWriterPreparation(f.options)),false);
 }
});
test('actual authenticated preparation route alone enters the HELD observer scope and sends no writer queries',async t=>{
 const f=fixture(t);let scopes=0,queries=0;
 const credential='q'.repeat(43),issuerCredential='r'.repeat(43);
 const server=createBuyerWriterHttpServer({credential,workspace:'blackspire-command',query:async()=>{queries++;},
  issuer:{credential:issuerCredential,query:async()=>{queries++;}},
  isAvailable:createBuyerWriterAvailability(f.options),isPrepared:createBuyerWriterPreparation(f.options)},
  {admit:fn=>f.admit.run(fn),prepareAdmit:fn=>{scopes++;return f.prepare(fn);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
 const base=`http://127.0.0.1:${server.address().port}/api/internal/buyer-writer/v1`;
 assert.equal((await fetch(base+'/preparation')).status,401);assert.equal(scopes,0);
 const response=await fetch(base+'/preparation',{headers:{'x-buyer-issuer-key':issuerCredential}});
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,prepared:true});assert.equal(scopes,1);
 const refused=await fetch(base+'/jobs/00000000-0000-4000-8000-000000000001/operations',{
  method:'POST',headers:{'content-type':'application/json','x-buyer-writer-key':credential},body:'{}'});
 assert.equal(refused.status,503);assert.equal(queries,0);assert.deepEqual(f.admit.status(),{required:true,open:false});
 f.ready.checks.scheduler=false;
 assert.equal((await fetch(base+'/preparation',{headers:{'x-buyer-issuer-key':issuerCredential}})).status,503);
 assert.equal(queries,0);
});
