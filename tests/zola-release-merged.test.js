import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyMergedRelease} from '../packages/zola-release/commander-merged.js';

function fixture(){
 const repository='houseomegakennels-bit/blackspire-helix-group';
 const proof={releaseSha:'a'.repeat(40),previousMainSha:'b'.repeat(40),ciMergeSha:'c'.repeat(40),ciTreeSha:'d'.repeat(40),newMainSha:'e'.repeat(40)};
 const pr={number:125,state:'closed',merged:true,draft:false,head:{sha:proof.releaseSha,ref:'release/zola-production-live',repo:{full_name:repository}},
  base:{ref:'main',repo:{full_name:repository}},merge_commit_sha:proof.newMainSha};
 const main={ref:'refs/heads/main',object:{type:'commit',sha:proof.newMainSha}};
 const commit=sha=>({sha,tree:{sha:proof.ciTreeSha},parents:[{sha:proof.previousMainSha},{sha:proof.releaseSha}]});
 const tested=commit(proof.ciMergeSha),merged=commit(proof.newMainSha),counts={};
 const f={proof,pr,main,tested,merged,before:()=>{}};
 f.verify=()=>verifyMergedRelease(proof,{run:(exe,args)=>{
  assert.equal(exe,'/usr/bin/gh');assert.equal(args[0],'api');
  const route=args[1].replace(`repos/${repository}/`,'');counts[route]=(counts[route]??0)+1;f.before(route,counts[route]);
  const value=route==='pulls/125'?pr:route==='git/ref/heads/main'?main:route===`git/commits/${proof.ciMergeSha}`?tested:route===`git/commits/${proof.newMainSha}`?merged:null;
  assert.ok(value);return JSON.stringify(value);
 }});return f;
}
test('postmerge identity requires exact tested tree and ordered parents without relabeling release artifacts',()=>{
 const f=fixture();assert.deepEqual(f.verify(),{status:'MERGED_IDENTITY_VERIFIED',...f.proof,productionAccepted:false});
});
test('unmerged PR, fork, wrong branch, squash/rebase, mixed SHAs and different tested tree refuse',()=>{
 for(const mutate of [
  f=>f.pr.merged=false,f=>f.pr.state='open',f=>f.pr.draft=true,f=>f.pr.number=126,
  f=>f.pr.head.repo.full_name='other/fork',f=>f.pr.base.repo.full_name='other/fork',f=>f.pr.base.ref='other',
  f=>f.pr.head.sha='f'.repeat(40),f=>f.pr.merge_commit_sha='f'.repeat(40),f=>f.main.object.sha='f'.repeat(40),
  f=>f.merged.parents.pop(),f=>f.merged.parents.reverse(),f=>f.tested.parents.reverse(),
  f=>f.merged.tree.sha='f'.repeat(40),f=>f.tested.tree.sha='f'.repeat(40),
  f=>f.merged.sha='f'.repeat(40),f=>f.proof.newMainSha=f.proof.releaseSha,f=>f.proof.newMainSha='HEAD',
 ]){const f=fixture();mutate(f);assert.throws(f.verify,/identity rejected/);}
});
test('main or PR movement during GET-only verification refuses',()=>{
 for(const change of ['main','pr','tree']){
  const f=fixture();f.before=(route,count)=>{if(route==='pulls/125'&&count===2){
   if(change==='main')f.main.object.sha='f'.repeat(40);
   if(change==='pr')f.pr.merge_commit_sha='f'.repeat(40);
   if(change==='tree')f.merged.tree.sha='f'.repeat(40);
  }};assert.throws(f.verify);
 }
});
test('remote failures are sanitized',()=>{
 assert.throws(()=>verifyMergedRelease(fixture().proof,{run:()=>{throw new Error('private response');}}),error=>error.message==='Merged release identity rejected');
});
