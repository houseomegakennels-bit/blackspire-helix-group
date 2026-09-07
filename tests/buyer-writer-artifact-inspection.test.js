import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectBuyerWriterArtifact} from '../packages/buyer-writer/artifact-inspection.js';
const options={artifactRoot:'/opt/blackspire/releases/'+'a'.repeat(40),releaseSha:'a'.repeat(40),environment:'production'};
test('artifact inspection uses a fixed credential-free bounded child and exact sanitized evidence',async()=>{
  const proof={releaseSha:options.releaseSha,environment:options.environment,artifactDigest:'b'.repeat(64)};
  const result=await inspectBuyerWriterArtifact({...options,run:async(command,args,settings)=>{
    assert.equal(command,'/opt/nodejs/node-v22.23.1-linux-x64/bin/node');assert.equal(settings.timeout,10000);assert.equal(settings.maxBuffer,4096);
    assert.deepEqual(settings.env,{PATH:'/usr/bin:/bin',LC_ALL:'C'});assert.equal(settings.killSignal,'SIGKILL');
    assert.ok(args[1].endsWith('/packages/buyer-writer/artifact-worker.js'));assert.deepEqual(args.slice(2),[options.artifactRoot,options.releaseSha,options.environment]);
    return{stdout:JSON.stringify(proof)+'\n',stderr:''};
  }});assert.deepEqual(result,proof);assert.equal(Object.isFrozen(result),true);
});
test('child failures, malformed output, identity skew and extra evidence are rejected without raw errors',async()=>{
  for(const run of [async()=>{throw new Error('PRIVATE');},async()=>({stdout:'PRIVATE',stderr:''}),
    async()=>({stdout:JSON.stringify({releaseSha:'c'.repeat(40),environment:'production',artifactDigest:'b'.repeat(64)}),stderr:''}),
    async()=>({stdout:JSON.stringify({releaseSha:options.releaseSha,environment:'production',artifactDigest:'b'.repeat(64),extra:'PRIVATE'}),stderr:''}),
    async()=>({stdout:'{}',stderr:'PRIVATE'}),
  ])await assert.rejects(inspectBuyerWriterArtifact({...options,run}),error=>error.message==='Buyer writer artifact observation unavailable'&&!error.cause);
});
