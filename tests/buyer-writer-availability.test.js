import test from 'node:test';
import assert from 'node:assert/strict';
import {createBuyerWriterAvailability} from '../packages/buyer-writer/availability.js';
const release='a'.repeat(40),apiGeneration='b'.repeat(32),workerGeneration='c'.repeat(32);
function fixture(){
  const identity={state:'VERIFIED',build:{value:release},environment:{value:'production'}};
  const worker={required:true,ok:true,state:'idle',heartbeatAgeMs:10,generationId:workerGeneration};
  const health={ok:true,service:'blackspire-command-api',lifecycle:'ready',database:'available',emergencyStop:false,dependencies:{worker},deploymentIdentity:identity};
  const readiness={ok:true,service:'blackspire-command-api',lifecycle:'ready',dependencies:{worker:{...worker}},deploymentIdentity:structuredClone(identity)};
  const proof={approved:true,credentialsSeparated:true,apiGeneration,workerGeneration,releaseSha:release,workspace:'isolated'};
  const options={workspace:'isolated',releaseSha:release,apiGeneration,environment:'production',getHealth:()=>health,getReadiness:()=>readiness,observeBinding:async()=>proof};
  return{health,readiness,proof,options};
}
test('availability binds base runtime health to an independently approved active generation',async()=>{
  const {options}=fixture();assert.equal(await createBuyerWriterAvailability(options)(),true);
});
test('stop, missing worker, unhealthy identity and generation drift deny before external observation',async()=>{
  for(const mutate of [
    f=>{f.health.emergencyStop=true;},f=>{f.health.ok=false;},f=>{f.readiness.ok=false;},
    f=>{f.health.dependencies.worker.required=false;},f=>{f.health.dependencies.worker.state='starting';},
    f=>{f.readiness.dependencies.worker.state='draining';},f=>{f.health.dependencies.worker.heartbeatAgeMs=30001;},
    f=>{f.health.dependencies.worker.generationId='d'.repeat(32);},f=>{f.health.deploymentIdentity.state='UNKNOWN';},
  ]){
    const f=fixture();mutate(f);f.options.observeBinding=()=>assert.fail('must not observe external authority');
    assert.equal(await createBuyerWriterAvailability(f.options)(),false);
  }
});
test('an authority change during observation cannot authorize a later write',async()=>{
  for(const mutate of [f=>{f.health.emergencyStop=true;},f=>{f.readiness.dependencies.worker.generationId='d'.repeat(32);},f=>{f.health.lifecycle='draining';}]){
    const f=fixture();f.options.observeBinding=async()=>{mutate(f);return f.proof;};
    assert.equal(await createBuyerWriterAvailability(f.options)(),false);
  }
});
test('binding mismatch, observation errors and expired observation budgets fail closed',async()=>{
  for(const key of ['approved','credentialsSeparated','apiGeneration','workerGeneration','releaseSha','workspace']){
    const f=fixture();f.proof[key]=false;assert.equal(await createBuyerWriterAvailability(f.options)(),false);
  }
  const f=fixture();f.options.observeBinding=async()=>{throw new Error('PRIVATE');};assert.equal(await createBuyerWriterAvailability(f.options)(),false);
  let time=0;const late=fixture();late.options.now=()=>time;late.options.observeBinding=async()=>{time=2001;return late.proof;};
  assert.equal(await createBuyerWriterAvailability(late.options)(),false);
});


test('async base readiness is observed before and after binding, and a later failed dependency denies',async()=>{
 const f=fixture();let reads=0;f.options.getReadiness=async()=>{await Promise.resolve();reads++;return f.readiness;};
 assert.equal(await createBuyerWriterAvailability(f.options)(),true);assert.equal(reads,2);
 f.options.observeBinding=async()=>{f.readiness.ok=false;return f.proof;};assert.equal(await createBuyerWriterAvailability(f.options)(),false);
});
test('a stalled async base snapshot stays within the availability deadline and never observes binding afterward',async()=>{
 const f=fixture();let finish,calls=0;f.options.getReadiness=()=>new Promise(resolve=>{finish=resolve;});f.options.observeBinding=async()=>{calls++;return f.proof;};
 assert.equal(await createBuyerWriterAvailability(f.options)(),false);finish(f.readiness);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);
});


test('emergency stop during the final asynchronous store probe uses fresh health and denies',async()=>{
 const f=fixture();let reads=0;f.options.getHealth=()=>structuredClone(f.health);
 f.options.getReadiness=async()=>{await Promise.resolve();if(++reads===2)f.health.emergencyStop=true;return structuredClone(f.readiness);};
 assert.equal(await createBuyerWriterAvailability(f.options)(),false);assert.equal(reads,2);
});
