import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import http from 'node:http';
import {createBuyerWriterRuntime} from '../packages/buyer-writer/runtime.js';
function fixture(){
  const releaseSha='a'.repeat(40),apiGeneration='b'.repeat(32),workerGeneration='c'.repeat(32);
  const config={version:1,workspace:'isolated',bindingFile:'/etc/blackspire/binding.json',writerCredential:randomBytes(32).toString('base64url'),issuerCredential:randomBytes(32).toString('base64url'),runtime:{host:'isolated.test',port:5432,database:'postgres',password:randomBytes(32).toString('base64url')},issuer:{host:'isolated.test',port:5432,database:'postgres',password:randomBytes(32).toString('base64url')}};
  const base={ok:true,service:'blackspire-command-api',lifecycle:'ready',database:'available',emergencyStop:false,deploymentIdentity:{state:'VERIFIED',build:{value:releaseSha},environment:{value:'disposable-staging'}},dependencies:{worker:{required:true,ok:true,state:'idle',heartbeatAgeMs:1,generationId:workerGeneration}}};
  let closes=0,reads=0,poolCreates=0,healthy=true,approved=false;
  const options={configurationFile:'/etc/blackspire/config.json',workspace:'isolated',releaseSha,apiGeneration,environment:'disposable-staging',getHealth:()=>base,getReadiness:()=>base,
    resolveIdentity:async()=>({uid:994,credentialGroupId:984,workerUid:993}),
    readConfiguration:(filename,options)=>{assert.equal(filename,'/etc/blackspire/config.json');assert.equal(options.groupId,984);reads++;return config;},
    createPostgres:async values=>{poolCreates++;assert.deepEqual(values.runtime,config.runtime);return{runtimeQuery:async()=>({rows:[]}),issuerQuery:async()=>({rows:[]}),isHealthy:()=>healthy,close:async()=>{closes++;}};},
    createBinding:values=>{assert.equal(values.workerUid,993);assert.equal(values.filename,config.bindingFile);return async()=>approved?{approved:true,credentialsSeparated:true,workspace:'isolated',releaseSha,apiGeneration,workerGeneration}:null;},
  };
  return{config,base,options,counts:()=>({closes,reads,poolCreates}),approve:()=>{approved=true;},unhealthy:()=>{healthy=false;}};
}
test('composition boots closed without approval, requires fresh availability, and closes pools once',async()=>{
  const f=fixture(),runtime=await createBuyerWriterRuntime(f.options);
  assert.equal(runtime.isHealthy(),true);assert.equal(await runtime.checkAvailability(),false);
  f.approve();assert.equal(await runtime.checkAvailability(),true);
  f.unhealthy();assert.equal(await runtime.checkAvailability(),false);
  await Promise.all([runtime.close(),runtime.close()]);assert.equal(runtime.isHealthy(),false);assert.equal(await runtime.checkAvailability(),false);
  assert.deepEqual(f.counts(),{closes:1,reads:1,poolCreates:1});
  assert.equal(JSON.stringify(runtime).includes(f.config.writerCredential),false);
});
test('identity denial occurs before protected configuration or PostgreSQL access',async()=>{
  const f=fixture();f.options.resolveIdentity=async()=>{throw new Error('PRIVATE');};
  await assert.rejects(createBuyerWriterRuntime(f.options),error=>error.message==='Buyer writer runtime initialization failed'&&!error.cause);
  assert.deepEqual(f.counts(),{closes:0,reads:0,poolCreates:0});
});
test('invalid configuration and context cannot create pools',async()=>{
  for(const mutate of [f=>{f.config.runtime.user='postgres';},f=>{f.options.environment='development';},f=>{f.config.bindingFile=f.options.configurationFile;},f=>{f.options.apiGeneration='invalid';}]){
    const f=fixture();mutate(f);await assert.rejects(createBuyerWriterRuntime(f.options),/Buyer writer runtime initialization failed/);assert.equal(f.counts().poolCreates,0);
  }
});
test('a composition failure after database initialization closes owned pools and sanitizes errors',async()=>{
  const f=fixture();f.options.createBinding=()=>{throw new Error('PRIVATE');};
  await assert.rejects(createBuyerWriterRuntime(f.options),error=>error.message==='Buyer writer runtime initialization failed'&&!error.cause);
  assert.equal(f.counts().closes,1);
});
test('shutdown drains an admitted query even after its HTTP client disconnects',async()=>{
  const f=fixture();f.approve();let complete,entered,closes=0;
  const pending=new Promise(resolve=>{complete=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  f.options.createPostgres=async()=>({runtimeQuery:async()=>{entered();await pending;return{rows:[{result:{ok:true,operation:'start',chunkIndex:0}}]};},issuerQuery:async()=>({rows:[]}),isHealthy:()=>true,close:async()=>{closes++;}});
  const runtime=await createBuyerWriterRuntime(f.options),server=http.createServer(runtime.handleRequest);
  const controller=new AbortController();
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const request=fetch(`http://127.0.0.1:${server.address().port}/api/internal/buyer-writer/v1/jobs/00000000-0000-4000-8000-000000000001/operations`,{
      method:'POST',signal:controller.signal,headers:{'content-type':'application/json','x-buyer-writer-key':f.config.writerCredential,'x-buyer-job-permit':randomBytes(32).toString('base64url')},
      body:JSON.stringify({version:1,dispatchId:'00000000-0000-4000-8000-000000000002',generation:1,operation:'start',chunkIndex:0,chunkCount:1,payload:{}}),
    }).catch(()=>null);
    await started;controller.abort();await request;
    const closing=runtime.close();await new Promise(resolve=>setImmediate(resolve));
    assert.equal(closes,0,'active database work closed before drain');
    complete();await closing;assert.equal(closes,1);
  }finally{
    complete();controller.abort();await runtime.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
  }
});
