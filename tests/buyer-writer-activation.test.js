import test from 'node:test';
import assert from 'node:assert/strict';
import {publishVerifiedBuyerWriterActivation} from '../packages/buyer-writer/activation.js';
function fixture(){
  const context={filename:'/etc/blackspire/binding.json',credentialGroupId:984,workspace:'isolated',releaseSha:'a'.repeat(40),apiGeneration:'b'.repeat(32),apiUid:994,apiPid:111,workerUid:993,
    apiUnit:'blackspire-command.service',workerUnit:'blackspire-command-worker.service',artifactRoot:'/opt/blackspire/releases/'+'a'.repeat(40),environment:'production',host:'127.0.0.1',port:8789};
  const process=(pid,parentPid,unit)=>({parentPid,startTime:String(pid),controlGroup:`/system.slice/${unit}`,pid});
  const api={supervisor:process(110,1,context.apiUnit),child:process(111,110,context.apiUnit),executableEvidence:{stable:true}};
  const worker={supervisor:process(222,1,context.workerUnit),child:process(223,222,context.workerUnit),executableEvidence:{stable:true}};
  const runtime={api:{...api.child,supervisor:api.supervisor,invocationId:context.apiGeneration},worker:{pid:222,invocationId:'c'.repeat(32),controlGroup:worker.supervisor.controlGroup}};
  const events=[];let bindingValue;
  const options={context,uid:0,
    inspectRuntime:async()=>structuredClone(runtime),
    collectProcesses:({role})=>structuredClone(role==='api'?api:worker),
    inspectArtifact:async()=>({releaseSha:context.releaseSha,environment:context.environment,artifactDigest:'d'.repeat(64)}),
    readProcess:pid=>{const value=structuredClone([api.supervisor,api.child,worker.supervisor,worker.child].find(p=>p.pid===pid));delete value.pid;return value;},
    createBinding:({filename,requireCommit})=>async()=>{assert.equal(requireCommit,false);events.push(['binding',filename]);return{approved:true,credentialsSeparated:true,workspace:context.workspace,releaseSha:context.releaseSha,apiGeneration:context.apiGeneration,workerGeneration:runtime.worker.invocationId};},
    checkReadiness:async({requireWriterReady,requirePreparation})=>{events.push(['readiness',requireWriterReady,requirePreparation]);return{verified:true,workerGeneration:runtime.worker.invocationId};},
    publish:async({value,verify})=>{bindingValue=value;await verify('/etc/blackspire/temporary.json');await verify(context.filename);return{path:context.filename,sha256:'e'.repeat(64),identity:{dev:1,ino:2}};},
    commit:async({expectedBinding})=>{events.push(['commit']);assert.equal(expectedBinding.identity.ino,2);return{path:context.filename+'.commit.json',sha256:'f'.repeat(64)};},
  };
  return{context,options,runtime,worker,events,value:()=>bindingValue};
}
test('root composition derives attestation and verifies real prerequisite phases around publication',async()=>{
  const f=fixture(),result=await publishVerifiedBuyerWriterActivation(f.options);
  assert.equal(result.state,'COMMITTED');assert.equal(result.bindingPath,f.context.filename);assert.equal(result.commitPath,f.context.filename+'.commit.json');assert.equal(f.value().workerAttestation.child.pid,223);
  assert.deepEqual(f.events.filter(e=>e[0]==='readiness'),[['readiness',false,false],['readiness',false,true],['readiness',true,false]]);
});
test('artifact or process drift and readiness failures deny publication without exposing errors',async()=>{
  for(const mutate of [
    f=>{let calls=0;f.options.inspectArtifact=async()=>({releaseSha:f.context.releaseSha,environment:'production',artifactDigest:(++calls>1?'f':'d').repeat(64)});},
    f=>{f.options.checkReadiness=async()=>{f.worker.child.startTime='999';return{verified:true,workerGeneration:f.runtime.worker.invocationId};};},
    f=>{f.options.checkReadiness=async()=>{throw new Error('PRIVATE');};},
    f=>{f.options.createBinding=()=>async()=>null;},f=>{f.options.uid=994;},
  ]){const f=fixture();mutate(f);await assert.rejects(publishVerifiedBuyerWriterActivation(f.options),error=>error.message==='Buyer writer activation rejected'&&!error.cause);}
});

test('commit uncertainty and postcommit readiness failure preserve an unknown activation outcome',async()=>{
  for(const mutate of [
    f=>{f.options.commit=async()=>{throw new Error('Buyer writer activation outcome unknown');};},
    f=>{f.options.checkReadiness=async({requireWriterReady})=>{if(requireWriterReady)throw new Error('PRIVATE');return{verified:true,workerGeneration:f.runtime.worker.invocationId};};},
  ]){const f=fixture();mutate(f);await assert.rejects(publishVerifiedBuyerWriterActivation(f.options),error=>error.message==='Buyer writer activation outcome unknown'&&!error.cause);}
});
