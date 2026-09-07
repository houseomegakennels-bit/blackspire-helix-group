import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {checkBuyerWriterActivationReadiness} from '../packages/buyer-writer/activation-readiness.js';
async function fixture(run){
  const generation='c'.repeat(32),releaseSha='a'.repeat(40);
  const shared={ok:true,service:'blackspire-command-api',lifecycle:'ready',deploymentIdentity:{state:'VERIFIED',build:{value:releaseSha},environment:{value:'disposable-staging'}},dependencies:{worker:{required:true,ok:true,state:'idle',heartbeatAgeMs:1,generationId:generation},buyerWriter:{enabled:true,ok:true}}};
  const health={...structuredClone(shared),database:'available',emergencyStop:false};
  const ready={...structuredClone(shared),ok:false,checks:{lifecycle:true,database:true,productionConfig:true,worker:true,scheduler:true,deploymentIdentity:true,buyerWriter:false}};
  const preparation={ok:true,prepared:true},requests=[];
  const server=http.createServer((req,res)=>{requests.push({url:req.url,key:req.headers['x-buyer-issuer-key']});const value=req.url==='/api/internal/buyer-writer/v1/preparation'?preparation:req.url==='/health'?health:ready;res.writeHead(value.ok?200:503,{'content-type':'application/json'});res.end(JSON.stringify(value));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const options={host:'127.0.0.1',port:server.address().port,apiPid:process.pid,releaseSha,environment:'disposable-staging',workerGeneration:generation,requireWriterReady:false,inspectListener:async()=>true};
  try{await run({health,ready,preparation,requests,options});}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
test('real loopback HTTP distinguishes base readiness from postpublication writer readiness',async()=>fixture(async f=>{
  assert.equal((await checkBuyerWriterActivationReadiness(f.options)).verified,true);
  await assert.rejects(checkBuyerWriterActivationReadiness({...f.options,requireWriterReady:true}));
  f.ready.checks.buyerWriter=true;f.ready.ok=true;
  assert.equal((await checkBuyerWriterActivationReadiness({...f.options,requireWriterReady:true})).verified,true);
}));
test('wrong owner, generation, release, stale heartbeat or emergency stop cannot approve publication',async()=>{
  for(const mutate of [f=>{f.options.inspectListener=async()=>false;},f=>{f.health.emergencyStop=true;},f=>{f.health.dependencies.worker.heartbeatAgeMs=30001;},
    f=>{f.ready.dependencies.worker.generationId='d'.repeat(32);},f=>{f.ready.deploymentIdentity.build.value='d'.repeat(40);},f=>{f.ready.checks.extra=true;},
    f=>{f.ready.checks.database=false;},f=>{f.health.dependencies.buyerWriter.ok=false;},
  ])await fixture(async f=>{mutate(f);await assert.rejects(checkBuyerWriterActivationReadiness(f.options),error=>error.message==='Buyer writer activation prerequisites rejected'&&!error.cause);});
});
test('a changed listener after HTTP observation invalidates the result',async()=>fixture(async f=>{
  let calls=0;f.options.inspectListener=async()=>++calls===1;
  await assert.rejects(checkBuyerWriterActivationReadiness(f.options));assert.equal(calls,2);
}));
test('actual kernel listener ownership must match the API process for real loopback reads',async()=>fixture(async f=>{
  delete f.options.inspectListener;
  assert.equal((await checkBuyerWriterActivationReadiness(f.options)).verified,true);
  await assert.rejects(checkBuyerWriterActivationReadiness({...f.options,apiPid:process.pid+1}));
}));

test('provisional preparation requires exact authenticated proof while public readiness stays denied',async()=>fixture(async f=>{
  const options={...f.options,requirePreparation:true,preparationCredential:'x'.repeat(43)};
  assert.equal((await checkBuyerWriterActivationReadiness(options)).verified,true);
  assert.equal(f.requests.find(r=>r.url.endsWith('/preparation'))?.key,options.preparationCredential);
  assert.ok(f.requests.filter(r=>!r.url.endsWith('/preparation')).every(r=>r.key===undefined));
  f.preparation.extra=true;await assert.rejects(checkBuyerWriterActivationReadiness(options));delete f.preparation.extra;
  f.preparation.prepared=false;await assert.rejects(checkBuyerWriterActivationReadiness(options));
  await assert.rejects(checkBuyerWriterActivationReadiness({...options,preparationCredential:undefined}));
  await assert.rejects(checkBuyerWriterActivationReadiness({...options,requireWriterReady:true}));
}));
