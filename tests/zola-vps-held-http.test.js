import test from 'node:test';
import assert from 'node:assert/strict';
import {observeVpsHeldHttp,validateVpsHeldHttp,requestVpsHeldJson} from '../packages/zola-release/vps-held-http.js';
const releaseSha='a'.repeat(40),workerGeneration='b'.repeat(32);
function fixture(workerExpected){
 const dependencies={worker:{required:true,ok:workerExpected,state:workerExpected?'idle':'stopped',heartbeatAgeMs:workerExpected?50:null,activeTask:false,restartDetected:false,generationId:workerExpected?workerGeneration:null},
  scheduler:{required:false,ok:true,state:'disabled'},buyerWriter:{enabled:true,ok:true}};
 const common={service:'blackspire-command-api',lifecycle:'ready',deploymentIdentity:{state:'VERIFIED',build:{value:releaseSha},environment:{value:'production'}},dependencies};
 return{health:{status:200,value:{...structuredClone(common),ok:workerExpected,database:'available',emergencyStop:false}},
  ready:{status:503,value:{...structuredClone(common),ok:false,database:'compatible',productionConfig:{ok:true},
   checks:{releaseAdmission:false,lifecycle:true,database:true,productionConfig:true,worker:workerExpected,scheduler:true,deploymentIdentity:true,buyerWriter:false}}}};
}
test('API-first probe accepts only an actual unhealthy stopped worker and deliberately closed admission',()=>{
 const f=fixture(false);assert.equal(validateVpsHeldHttp(f,{releaseSha,workerExpected:false}),true);
 for(const mutate of [x=>x.health.value.ok=true,x=>x.health.value.dependencies.worker.ok=true,x=>x.ready.value.checks.worker=true,x=>x.health.value.dependencies.worker.state='idle',x=>x.ready.value.checks.releaseAdmission=true]){
  const changed=structuredClone(f);mutate(changed);assert.throws(()=>validateVpsHeldHttp(changed,{releaseSha,workerExpected:false}));
 }
});
test('postworker HELD probe requires current generation and refuses unrelated readiness failures',()=>{
 const f=fixture(true),binding={releaseSha,workerExpected:true,workerGeneration};assert.equal(validateVpsHeldHttp(f,binding),true);
 for(const mutate of [x=>x.health.value.deploymentIdentity.build.value='c'.repeat(40),x=>x.ready.value.deploymentIdentity.environment.value='staging',
  x=>x.health.value.database='unavailable',x=>x.health.value.emergencyStop=true,x=>x.ready.value.checks.productionConfig=false,
  x=>x.ready.value.checks.unexpected=false,x=>delete x.ready.value.checks.releaseAdmission,x=>x.ready.value.dependencies.worker.generationId='d'.repeat(32),
  x=>x.health.value.dependencies.worker.heartbeatAgeMs=30001,x=>x.health.value.dependencies.buyerWriter.ok=false,
  x=>x.ready.value.dependencies.scheduler.ok=false,x=>x.ready.value.dependencies.worker.state='starting',x=>x.ready.status=200]){
  const changed=structuredClone(f);mutate(changed);assert.throws(()=>validateVpsHeldHttp(changed,binding));
 }
 assert.throws(()=>validateVpsHeldHttp(f,{releaseSha,workerExpected:true}));
});
test('composed observer validates independent health and readiness responses',async()=>{
 const f=fixture(true),paths=[];
 assert.equal(await observeVpsHeldHttp({releaseSha,workerExpected:true,workerGeneration},{request:async pathname=>{paths.push(pathname);return pathname==='/health'?f.health:f.ready;}}),true);
 assert.deepEqual(paths,['/health','/ready']);
});
test('native transport fixes loopback port and refuses redirects, bad media, oversized and malformed bodies',async()=>{
 let url,options;
 const fetchImpl=async(u,o)=>{url=u;options=o;return new Response('{"ok":false}',{status:503,headers:{'content-type':'application/json'}});};
 assert.deepEqual(await requestVpsHeldJson('/ready',{fetchImpl}),{status:503,value:{ok:false}});
 assert.equal(url,'http://127.0.0.1:8789/ready');assert.equal(options.redirect,'error');assert.equal(options.method,'GET');assert.ok(options.signal instanceof AbortSignal);
 for(const response of [new Response('{}',{status:302,headers:{'content-type':'application/json'}}),new Response('{}',{headers:{'content-type':'text/html'}}),
  new Response(' '.repeat(65537),{headers:{'content-type':'application/json'}}),new Response('{',{headers:{'content-type':'application/json'}})])
  await assert.rejects(requestVpsHeldJson('/health',{fetchImpl:async()=>response}));
 await assert.rejects(requestVpsHeldJson('/other',{fetchImpl}));
});

test('owned readiness requires its explicit healthy Buyer store check without widening legacy keys',()=>{
 const f=fixture(true),binding={releaseSha,workerExpected:true,workerGeneration,backendProfile:'owned-postgres-v1',profileDigest:'d'.repeat(64)};
 assert.throws(()=>validateVpsHeldHttp(f,binding));f.ready.value.checks.buyerStore=true;
 assert.equal(validateVpsHeldHttp(f,binding),true);
 assert.throws(()=>validateVpsHeldHttp(f,{releaseSha,workerExpected:true,workerGeneration}));
 f.ready.value.checks.buyerStore=false;assert.throws(()=>validateVpsHeldHttp(f,binding));
 f.ready.value.checks.buyerStore=true;assert.throws(()=>validateVpsHeldHttp(f,{...binding,profileDigest:undefined}));
});

test('owned API-first phase requires unpublished store manifest, then healthy store after worker start',()=>{
 const binding={releaseSha,workerExpected:false,backendProfile:'owned-postgres-v1',profileDigest:'d'.repeat(64)},f=fixture(false);
 f.ready.value.checks.buyerStore=false;assert.equal(validateVpsHeldHttp(f,binding),true);
 f.ready.value.checks.buyerStore=true;assert.throws(()=>validateVpsHeldHttp(f,binding));
 delete f.ready.value.checks.buyerStore;assert.throws(()=>validateVpsHeldHttp(f,binding));
});
