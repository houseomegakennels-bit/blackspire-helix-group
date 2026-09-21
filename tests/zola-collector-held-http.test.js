import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {observeCollectorHttpGeneration,createCollectorHttpBoundary} from '../packages/zola-six-reads/collector-host.js';
const releaseSha='a'.repeat(40),workerGeneration='b'.repeat(32);
function fixture(){
 const dependencies={worker:{required:true,ok:true,state:'idle',heartbeatAgeMs:50,activeTask:false,restartDetected:false,generationId:workerGeneration},scheduler:{required:false,ok:true,state:'disabled'},buyerWriter:{enabled:true,ok:true}};
 const common={service:'blackspire-command-api',lifecycle:'ready',deploymentIdentity:{state:'VERIFIED',build:{value:releaseSha},environment:{value:'production'}},dependencies};
 return {health:{status:200,data:{...structuredClone(common),ok:true,database:'available',emergencyStop:false}},ready:{status:503,data:{...structuredClone(common),ok:false,database:'compatible',productionConfig:{ok:true},checks:{releaseAdmission:false,lifecycle:true,database:true,productionConfig:true,worker:true,scheduler:true,deploymentIdentity:true,buyerWriter:false}}}};
}
test('collector composes bounded real HTTP with strict HELD health and readiness checks',async()=>{
 let responses=fixture();const paths=[];
 const server=http.createServer((req,res)=>{paths.push(req.url);const row=req.url==='/health'?responses.health:responses.ready;res.writeHead(row.status,{'content-type':'application/json'});res.end(JSON.stringify(row.data));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const config={version:5,releaseSha,port:server.address().port};
  await observeCollectorHttpGeneration(config,workerGeneration);assert.deepEqual(paths,['/health','/ready']);
  await observeCollectorHttpGeneration({...config,version:4},workerGeneration);
  for(const mutate of [x=>x.ready.status=200,x=>x.ready.data.checks.releaseAdmission=true,x=>x.ready.data.checks.database=false,x=>x.ready.data.checks.unknown=false,x=>x.health.data.dependencies.worker.generationId='c'.repeat(32),x=>x.health.data.deploymentIdentity.build.value='d'.repeat(40),x=>x.health.data.emergencyStop=true,x=>x.ready.data.dependencies.buyerWriter.ok=false]){
   responses=fixture();mutate(responses);await assert.rejects(observeCollectorHttpGeneration(config,workerGeneration),/RUNTIME_HEALTH_PAIRING_MISMATCH/);
  }
  responses=fixture();await assert.rejects(observeCollectorHttpGeneration({...config,version:3},workerGeneration));
  responses.ready.status=200;responses.ready.data.ok=true;responses.ready.data.checks.releaseAdmission=true;
  await observeCollectorHttpGeneration({...config,version:3},workerGeneration);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('candidate and postmerge HTTP transports keep their protected permit headers distinct',async()=>{
 const seen=[];const server=http.createServer((req,res)=>{seen.push(req.headers);res.writeHead(202,{'content-type':'application/json'});res.end('{}');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{for(const version of [4,5])await createCollectorHttpBoundary({version,port:server.address().port},{bearer:'test-bearer',heldAcceptanceToken:'test-permit'}).admit({text:'read'});
 assert.equal(seen[0]['x-blackspire-held-premerge'],'test-permit');assert.equal(seen[0]['x-blackspire-held-acceptance'],undefined);
 assert.equal(seen[1]['x-blackspire-held-acceptance'],'test-permit');assert.equal(seen[1]['x-blackspire-held-premerge'],undefined);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
