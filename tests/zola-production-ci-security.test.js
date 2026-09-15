import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createCiSecurityProductionOperation} from '../packages/zola-release/production-ci-security.js';

const releaseSha='a'.repeat(40),previousMainSha='b'.repeat(40);
function fixture(verify){
 const input={releaseSha,previousMainSha,recoverySha:'c'.repeat(40),protectedInputDigest:'d'.repeat(64),workspace:'zola-production',principal:'blackspire-release-root',inputDigest:'e'.repeat(64)};
 const context={input,release:{releaseSha}};
 const args={input,state:{context:{operationId:randomUUID(),releaseSha,previousMainSha,workspace:input.workspace,principal:input.principal}},ordinal:15};
 return{operation:createCiSecurityProductionOperation(context,{verify}),args};
}

test('CI/security stage binds the exact successful trusted run and merge artifact',()=>{
 const proof={status:'success',releaseSha,mainSha:previousMainSha,runId:42,runAttempt:2,ciMergeSha:'1'.repeat(40),ciTreeSha:'2'.repeat(40),ciArtifactDigest:'3'.repeat(64)};
 const {operation,args}=fixture(()=>proof),result=operation.check(args);
 assert.equal(result.status,'PASS');assert.equal(result.evidence.releaseSha,releaseSha);
 assert.equal(result.evidence.ciArtifactDigest,proof.ciArtifactDigest);assert.equal(result.evidence.ciSecurity,true);
});

test('CI/security unavailability blocks externally and mismatched proof fails closed',()=>{
 assert.equal(fixture(()=>{throw new Error('github unavailable');}).operation.check(fixture(()=>{}).args).status,'BLOCKED_EXTERNAL');
 const bad=fixture(()=>({status:'success',releaseSha,mainSha:'f'.repeat(40),runId:1,runAttempt:1,ciMergeSha:'1'.repeat(40),ciTreeSha:'2'.repeat(40),ciArtifactDigest:'3'.repeat(64)}));
 assert.throws(()=>bad.operation.observe(bad.args),/CI\/security observation rejected/);
});
