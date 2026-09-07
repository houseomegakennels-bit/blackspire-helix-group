import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveBuyerWriterIdentity} from '../packages/buyer-writer/runtime-identity.js';
const fixture=(overrides={})=>({uid:994,euid:994,gid:986,egid:986,groups:[984],lookup:async(command,args,options)=>{
  assert.deepEqual(options.env,{PATH:'/usr/bin:/bin'});assert.equal(options.timeout,1000);assert.equal(options.maxBuffer,4096);
  if(command==='/usr/bin/getent'&&args[0]==='passwd'&&args[1]==='blackspire-worker')return{stdout:'blackspire-worker:x:993:983::/home/blackspire-worker:/usr/sbin/nologin\n'};
  if(command==='/usr/bin/getent'&&args[0]==='passwd')return{stdout:'blackspire-api:x:994:984::/home/blackspire-api:/usr/sbin/nologin\n'};
  if(command==='/usr/bin/getent'&&args[0]==='group')return{stdout:'blackspire-api:x:984:\n'};
  if(command==='/usr/bin/id')return{stdout:'983 986\n'};
  assert.fail('unexpected identity command');
},...overrides});
test('identity resolver selects the private API group rather than its shared primary group',async()=>{
  assert.deepEqual(await resolveBuyerWriterIdentity(fixture()),{uid:994,credentialGroupId:984,workerUid:993});
});
test('wrong process identity, missing private membership and shared worker authority fail closed',async()=>{
  for(const overrides of [{uid:0},{uid:993},{euid:0},{egid:0},{groups:[]},{lookup:async()=>({stdout:'PRIVATE_LOOKUP_FAILURE'})},
    {lookup:async(command,args,options)=>command==='/usr/bin/id'?{stdout:'983 984 986\n'}:fixture().lookup(command,args,options)},
    {lookup:async()=>{throw new Error('PRIVATE_LOOKUP_FAILURE');}},
  ])await assert.rejects(resolveBuyerWriterIdentity(fixture(overrides)),error=>error.message==='Buyer writer process identity unavailable'&&!error.cause);
});
