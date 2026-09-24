import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareApiEnvironment,validateApiEnvironmentPlan} from '../packages/zola-release/api-environment-preparation.js';
const releaseSha='a'.repeat(40),password='retained-operator-password-not-real',consumerToken='consumer-test-only-'.repeat(3);
function fixture({fault}={}){
 let plan=null,environment=null,generated=0,stops=0;const writes=[];
 const host={assertStopped(){stops++;if(fault?.('stopped',stops))throw Error('PRIVATE');},readSource:()=>({password,consumerToken}),
  assertSource(){if(fault?.('source'))throw Error('PRIVATE');},readPlan:()=>structuredClone(plan),readEnvironment:()=>environment,
  retainPlan(value){plan=structuredClone(value);writes.push('plan');if(fault?.('plan'))throw Error('PRIVATE');},
  publishAbsent(bytes){environment=bytes;writes.push('environment');if(fault?.('publish'))throw Error('PRIVATE');},
  verifyIsolation(){if(fault?.('isolation'))throw Error('PRIVATE');}};
 return {host,writes,generate:()=>String(++generated).repeat(43),get generated(){return generated;},get plan(){return plan;},get environment(){return environment;},set environment(v){environment=v;}};
}
test('missing API profile retains distinct credentials before publication and exact rerun preserves them',async()=>{
 const f=fixture(),result=await prepareApiEnvironment({releaseSha},f);
 assert.equal(result.status,'API_ENVIRONMENT_PREPARED');assert.equal(JSON.stringify(result).includes(password),false);
 assert.deepEqual(f.writes,['plan','environment']);assert.equal(f.generated,2);
 assert.equal(f.environment,validateApiEnvironmentPlan(f.plan,{releaseSha,password,consumerToken}));
 await prepareApiEnvironment({releaseSha},f);assert.equal(f.generated,2);assert.deepEqual(f.writes,['plan','environment']);
});
test('publication interruption resumes retained credentials without rotation',async()=>{
 for(const stage of ['plan','publish']){
  let fired=false;const f=fixture({fault:name=>name===stage&&!fired&&(fired=true)});
  await assert.rejects(prepareApiEnvironment({releaseSha},f),/preparation rejected/);
  const bytes=validateApiEnvironmentPlan(f.plan,{releaseSha,password,consumerToken});
  await prepareApiEnvironment({releaseSha},f);assert.equal(f.generated,2);assert.equal(f.environment,bytes);
 }
});
test('foreign profile, source drift, service activity and worker exposure refuse without overwriting',async()=>{
 const foreign=fixture();foreign.environment='foreign';await assert.rejects(prepareApiEnvironment({releaseSha},foreign));assert.equal(foreign.generated,0);assert.deepEqual(foreign.writes,[]);
 for(const stage of ['stopped','source','isolation']){
  const f=fixture({fault:name=>name===stage});await assert.rejects(prepareApiEnvironment({releaseSha},f),error=>error.message==='API environment preparation rejected');
  if(stage!=='isolation')assert.ok(!f.writes.includes('environment'));
 }
 const f=fixture();await prepareApiEnvironment({releaseSha},f);const retained=f.environment;
 await assert.rejects(prepareApiEnvironment({releaseSha:'b'.repeat(40)},f));assert.equal(f.environment,retained);
 f.environment+='drift';await assert.rejects(prepareApiEnvironment({releaseSha},f));assert.equal(f.environment,retained+'drift');
});
test('plan rejects credential reuse, changed password, consumer token and schema drift',async()=>{
 const f=fixture();await prepareApiEnvironment({releaseSha},f);
 for(const change of [{COMMAND_ADMIN_TOKEN:consumerToken},{SESSION_SECRET:f.plan.environment.COMMAND_ADMIN_TOKEN},{ALLOW_BEARER_AUTH:'false'},
  {COMMAND_ADMIN_PASSWORD_HASH:'invalid'},{BLACKSPIRE_AUTHORITY_CONSUMER_TOKEN:'foreign'.repeat(8)}]){
  assert.throws(()=>validateApiEnvironmentPlan({...f.plan,environment:{...f.plan.environment,...change}},{releaseSha,password,consumerToken}));
 }
 assert.throws(()=>validateApiEnvironmentPlan({...f.plan,extra:true},{releaseSha,password,consumerToken}));
 assert.throws(()=>validateApiEnvironmentPlan(f.plan,{releaseSha,password:'different-operator-password',consumerToken}));
});
