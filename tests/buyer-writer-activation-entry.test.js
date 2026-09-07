import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import http from 'node:http';
import {activateBuyerWriterFromProfile} from '../packages/buyer-writer/activation-entry.js';
function fixture(){
  const context={filename:'/etc/blackspire/binding.json',credentialGroupId:984,workspace:'isolated',releaseSha:'a'.repeat(40),apiGeneration:'b'.repeat(32),apiUid:994,apiPid:111,workerUid:993,apiUnit:'blackspire-command.service',workerUnit:'blackspire-command-worker.service',artifactRoot:'/opt/blackspire/releases/'+'a'.repeat(40),environment:'production',host:'127.0.0.1',port:8789};
  const profile={version:1,configurationFile:'/etc/blackspire/config.json',context};
  const config={version:1,workspace:'isolated',bindingFile:context.filename,writerCredential:randomBytes(32).toString('base64url'),issuerCredential:randomBytes(32).toString('base64url'),runtime:{host:'isolated.test',port:5432,database:'postgres',password:randomBytes(32).toString('base64url')},issuer:{host:'isolated.test',port:5432,database:'postgres',password:randomBytes(32).toString('base64url')}};
  const events=[];const options={filename:'/etc/blackspire/profile.json',
    verifyContainer:async()=>{events.push('container');},
    readSnapshot:(filename,{groupId})=>{events.push('read');assert.equal(groupId,filename==='/etc/blackspire/profile.json'?0:984);return{value:structuredClone(filename==='/etc/blackspire/profile.json'?profile:config),identity:{ino:1}};},
    inspectRuntimeFactory:()=>async()=>({api:{uid:994,euid:994,gid:986,egid:986,groups:[984,986]}}),
    resolveIdentity:async value=>{assert.equal(value.uid,994);return{uid:994,credentialGroupId:984,workerUid:993};},
    activate:async({context:actual,publish})=>{assert.deepEqual(actual,context);return publish({verify:async()=>({approved:true})});},
    publish:async({verify})=>{events.push('publish');await verify(context.filename);return{path:context.filename,sha256:'d'.repeat(64)};},
  };
  return{options,events,config,profile};
}
test('protected configuration is read only after containment and stays stable through approval',async()=>{
  const f=fixture(),result=await activateBuyerWriterFromProfile(f.options);assert.equal(f.events[0],'container');assert.equal(result.path,f.profile.context.filename);
});
test('containment denial cannot load secrets and mismatched profile/configuration cannot publish',async()=>{
  const f=fixture();f.options.verifyContainer=async()=>{throw new Error('PRIVATE');};f.options.readSnapshot=()=>assert.fail('must not read');
  await assert.rejects(activateBuyerWriterFromProfile(f.options),/^Error: Buyer writer activation command rejected$/);
  for(const mutate of [f=>{f.config.bindingFile='/other/binding.json';},f=>{f.profile.context.workerUid=0;},f=>{f.profile.context.apiUnit='other.service';}]){
    const f=fixture();mutate(f);f.options.activate=()=>assert.fail('must not activate');await assert.rejects(activateBuyerWriterFromProfile(f.options),/activation command rejected/);
  }
});
test('protected configuration change during publication invalidates approval without exposing contents',async()=>{
  const f=fixture();f.options.publish=async({verify})=>{f.config.writerCredential=randomBytes(32).toString('base64url');await verify(f.profile.context.filename);};
  await assert.rejects(activateBuyerWriterFromProfile(f.options),error=>error.message==='Buyer writer activation command rejected'&&!error.cause);
});

test('issuer credential stays in the private readiness closure and configuration is fenced at commit',async()=>{
  const f=fixture();let checked=false,committed=false;
  f.options.checkReadiness=async options=>{assert.equal(options.preparationCredential,f.config.issuerCredential);checked=true;return{verified:true};};
  f.options.commit=async({beforeCommit})=>{assert.equal(beforeCommit(),undefined);committed=true;return{state:'COMMITTED'};};
  f.options.activate=async options=>{
    assert.ok(!JSON.stringify(options.context).includes(f.config.issuerCredential));
    await options.checkReadiness({requirePreparation:true});return options.commit({});
  };
  const result=await activateBuyerWriterFromProfile(f.options);assert.equal(result.state,'COMMITTED');assert.ok(checked&&committed);
  f.options.commit=async({beforeCommit})=>{f.config.issuerCredential=randomBytes(32).toString('base64url');beforeCommit();};
  await assert.rejects(activateBuyerWriterFromProfile(f.options),/activation command rejected/);
});
test('unknown committed outcome is preserved by the root command without raw errors',async()=>{
  const f=fixture();f.options.activate=async()=>{throw new Error('Buyer writer activation outcome unknown');};
  await assert.rejects(activateBuyerWriterFromProfile(f.options),error=>error.message==='Buyer writer activation outcome unknown'&&!error.cause);
});

test('root entry uses the actual loopback preparation checker with its protected issuer credential',async()=>{
  const f=fixture(),generation='c'.repeat(32),context=f.profile.context;
  const shared={service:'blackspire-command-api',lifecycle:'ready',deploymentIdentity:{state:'VERIFIED',build:{value:context.releaseSha},environment:{value:'production'}},
    dependencies:{buyerWriter:{enabled:true,ok:true},worker:{required:true,ok:true,state:'idle',heartbeatAgeMs:1,generationId:generation}}};
  let preparationRequests=0;
  const server=http.createServer((req,res)=>{
    let status=200,value;
    if(req.url==='/api/internal/buyer-writer/v1/preparation'){
      preparationRequests++;status=req.headers['x-buyer-issuer-key']===f.config.issuerCredential?200:401;value={ok:status===200,prepared:status===200};
    }else{
      assert.equal(req.headers['x-buyer-issuer-key'],undefined);
      if(req.url==='/health')value={...shared,ok:true,database:'available',emergencyStop:false};
      else {status=503;value={...shared,ok:false,checks:{lifecycle:true,database:true,productionConfig:true,worker:true,scheduler:true,deploymentIdentity:true,buyerWriter:false}};}
    }
    res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  context.port=server.address().port;context.apiPid=process.pid;
  f.options.activate=async({checkReadiness})=>checkReadiness({...context,workerGeneration:generation,requireWriterReady:false,requirePreparation:true});
  try{const result=await activateBuyerWriterFromProfile(f.options);assert.equal(result.verified,true);assert.equal(preparationRequests,1);}
  finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
