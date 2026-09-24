import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {selectSuccessorWorkflowBackup} from '../packages/zola-release/owned-successor-final-inputs-host.js';
import {MIXED_RETIREMENT as P} from '../packages/zola-release/mixed-retirement-history.js';
import {validateMixedSuccessorRequest,createMixedSuccessorFinalInputHost} from '../packages/zola-release/mixed-successor-preparation.js';
const request={releaseSha:P.successorReleaseSha,operationId:'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',profileDigest:P.profileDigest};
test('mixed successor preparation accepts only the repaired candidate and original owned profile',()=>{
 assert.deepEqual(validateMixedSuccessorRequest(request),request);
 for(const change of [{releaseSha:P.releaseSha},{releaseSha:'a'.repeat(40)},{operationId:P.operationId},{operationId:'invalid'},{profileDigest:'b'.repeat(64)}])
  assert.throws(()=>validateMixedSuccessorRequest({...request,...change}));
 assert.throws(()=>createMixedSuccessorFinalInputHost({releaseSha:P.releaseSha}));
});
test('preparation binds exact mixed history while preserving original migration source validation',()=>{
 const output=execFileSync(process.execPath,['--experimental-test-module-mocks','--input-type=module','-e',`
 import {mock} from 'node:test';import assert from 'node:assert/strict';
 import * as real from './packages/zola-release/mixed-retirement-history.js';
 const P=real.MIXED_RETIREMENT,events=[{type:'synthetic_retained_history'}];let prefixes=0,observers=0,sourceChecks=0;
 mock.module('./packages/zola-release/mixed-retirement-history.js',{namedExports:{...real,
  validateMixedRetirementPrefix:rows=>{assert.deepEqual(rows,events);prefixes++;return true;}}});
 let observed={retainedEvidenceDigest:P.retainedEvidenceDigest,acceptancePassed:false,productionOpen:false};
 mock.module('./packages/zola-release/mixed-read-failure-host.js',{namedExports:{
  observeMixedReadFailure:async()=>{observers++;return {...observed};}}});
 mock.module('./packages/zola-release/owned-successor-final-inputs-host.js',{namedExports:{
  createOwnedSuccessorFinalInputHost:opts=>opts}});
 mock.module('./packages/buyer-writer/owned-migration-successor.js',{namedExports:{
  verifyOwnedMigrationSuccessorSource:(sha,opts)=>{assert.equal(sha,P.successorReleaseSha);
   assert.equal(opts.root,'/mnt/blackspire-builds/development-cache/0/workspaces/zola-final-successor-20260924');sourceChecks++;},
  prepareOwnedMigrationSuccessor:async(r,deps)=>{deps.verifySource(r.releaseSha);return {r,deps};},
  observeOwnedMigrationSuccessor:async(r,deps)=>{deps.verifySource(r.releaseSha);return {r,deps};}}});
 const m=await import('./packages/zola-release/mixed-successor-preparation.js');
 const journal={stream:()=>({events:()=>structuredClone(events)})};
 const host=m.createMixedSuccessorFinalInputHost({releaseSha:P.successorReleaseSha,journal,inspect:true});
 assert.equal(host.sourceRoot,'/mnt/blackspire-builds/development-cache/0/workspaces/zola-final-successor-20260924');
 assert.equal(host.inspect,true);assert.equal(host.carryPublishedCandidate,true);await host.observePreparationHeld(journal);assert.equal(prefixes,2);assert.equal(observers,1);
 const request=${JSON.stringify(request)};
 const prepared=await m.prepareMixedSuccessorLineage(request),read=await m.observeMixedSuccessorLineage(request);
 assert.equal(sourceChecks,2);assert.equal(prepared.deps.observePreparationHeld,m.observeMixedSuccessorPreparationHeld);
 assert.equal(read.deps.observePreparationHeld,undefined);
 assert.throws(()=>prepared.deps.verifySource(P.releaseSha));
 observed={...observed,acceptancePassed:true};await assert.rejects(m.observeMixedSuccessorPreparationHeld(journal));
 console.log('mixed successor boundaries passed');
 `],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',LC_ALL:'C'},stdio:['ignore','pipe','pipe']});
 assert.equal(output.trim(),'mixed successor boundaries passed');
});

test('published workflow carryover preserves exact original backup bytes instead of relabeling the candidate as baseline',()=>{
 const originalBackup='{  "original": true }\n',observation={candidate:true};
 assert.equal(selectSuccessorWorkflowBackup({carryPublishedCandidate:true,originalBackup,observation}),originalBackup);
 assert.equal(selectSuccessorWorkflowBackup({carryPublishedCandidate:false,originalBackup,observation}),JSON.stringify(observation)+'\n');
 assert.throws(()=>selectSuccessorWorkflowBackup({carryPublishedCandidate:'true',originalBackup,observation}));
});
