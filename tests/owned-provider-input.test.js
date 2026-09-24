import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../packages/zola-release/commander-journal.js';
import {bindOwnedProviderInput} from '../packages/zola-release/owned-provider-input.js';
import {createProviderAclCheckOperation} from '../packages/zola-release/production-acl-writer.js';
const release={schema:3,releaseSha:'a8e05ef40e44b6695df5b30356af0e411fe36f1a',previousMainSha:'b'.repeat(40),recoverySha:'c'.repeat(40),operationId:'11111111-1111-4111-8111-111111111111',workspace:'zola-production',principal:'blackspire-release-root',backendProfile:'owned-postgres-v1',profileDigest:'d'.repeat(64)};
const protectedInputDigest='e'.repeat(64);
const base={releaseSha:release.releaseSha,previousMainSha:release.previousMainSha,recoverySha:release.recoverySha,protectedInputDigest,workspace:release.workspace,principal:release.principal};
const input={...base,inputDigest:hash(base)};
const args=()=>({input:structuredClone(input),state:{context:{...input,operationId:release.operationId}},ordinal:7});
function fixture(){let calls=0,epoch=0;const seen=[];const fn=async a=>{calls++;seen.push(a);return {status:'PASS'};};const operation={check:fn,observe:fn};return {operation,seen,get calls(){return calls;},bump:()=>epoch++,adapter:bindOwnedProviderInput({operation,input,release,protectedInputDigest,fence:()=>({epoch})})};}
test('native seven-field input rejects before provider query',async()=>{let calls=0;const operation=createProviderAclCheckOperation({query:async()=>{calls++;},backendProfile:release.backendProfile,profileDigest:release.profileDigest});await assert.rejects(operation.check(args()));assert.equal(calls,0);});
test('check and observe normalize only scoped input and preserve sequence digests',async()=>{const f=fixture(),a=args();await f.adapter.check(a);const check='f'.repeat(64);await f.adapter.observe({...a,attemptId:null,checkOutputDigest:check,inputDigest:hash({sequence:input.inputDigest,stage:'provider_acl_check',ordinal:7,check})});assert.equal(f.calls,2);assert.deepEqual(a.input,input);for(const seen of f.seen)assert.deepEqual(seen.input,{...input,backendProfile:release.backendProfile,profileDigest:release.profileDigest});});
test('input, context, attempt and injected profile drift reject before query',async()=>{for(const change of [a=>a.input.profileDigest='f'.repeat(64),a=>a.input.releaseSha='b'.repeat(40),a=>a.state.context.operationId='22222222-2222-4222-8222-222222222222',a=>a.attemptId='11111111-1111-4111-8111-111111111111',a=>a.inputDigest='f'.repeat(64)]){const f=fixture(),a=args();change(a);await assert.rejects(f.adapter.check(a));assert.equal(f.calls,0);}});
test('changed protected source across await refuses completed observation',async()=>{const f=fixture();f.operation.observe=async()=>{f.bump();return {status:'PASS'};};await assert.rejects(f.adapter.observe(args()));});
test('wrong protected backend or profile rejected at construction',()=>{for(const bad of [{backendProfile:'supabase'}, {profileDigest:'bad'}])assert.throws(()=>bindOwnedProviderInput({operation:{},input,release:{...release,...bad},protectedInputDigest,fence:()=>({})}));});

test('exact repaired successor binds the native seven-field input without altering its journal identity',async()=>{
 const r={...release,releaseSha:'f1f004ffcfe43ff92271ed3618f9b3d3bb7ac57e',operationId:'b9679cbd-5331-45ae-a026-02b7f5e117e9',
  profileDigest:'2563185421523bf337e382a38ca389c5991406cb2adecc952048cdf5cf058505'};
 const b={...base,releaseSha:r.releaseSha},i={...b,inputDigest:hash(b)};let seen;
 const o={check:async a=>{seen=a;return {status:'PASS'};},observe:async()=>({status:'PASS'})};
 const make=release=>bindOwnedProviderInput({operation:o,input:i,release,protectedInputDigest,fence:()=>({fixed:true})});
 await make(r).check({input:i,state:{context:{...i,operationId:r.operationId}},ordinal:7});
 assert.equal(seen.input.backendProfile,'owned-postgres-v1');assert.equal(seen.input.inputDigest,i.inputDigest);
 for(const patch of [{operationId:release.operationId},{profileDigest:release.profileDigest},{releaseSha:'f'.repeat(40)}])
  assert.throws(()=>make({...r,...patch}));
});
