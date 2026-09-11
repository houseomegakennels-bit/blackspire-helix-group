import test from 'node:test';
import assert from 'node:assert/strict';
import {observeExpectedHeadMerge,observeReleaseMergeability,requestExpectedHeadMerge,observeVercelProduction} from '../packages/zola-release/commander-deployment.js';
const releaseSha='a'.repeat(40),previousMainSha='b'.repeat(40),ciMergeSha='c'.repeat(40),ciTreeSha='d'.repeat(40),newMainSha='e'.repeat(40);
function gh({merged=false,drift=false}={}){let reads=0;return(_file,args)=>{
 const route=args.find(value=>String(value).startsWith('repos/'))??'';if(args.includes('--method'))return'';
 if(route.endsWith('pulls/125'))return JSON.stringify({number:125,state:merged?'closed':'open',merged,draft:false,merge_commit_sha:merged?newMainSha:null,
  head:{sha:drift&&reads++?'f'.repeat(40):releaseSha,ref:'release/zola-production-live',repo:{full_name:'houseomegakennels-bit/blackspire-helix-group'}},
  base:{ref:'main',repo:{full_name:'houseomegakennels-bit/blackspire-helix-group'}}});
 if(route.endsWith('git/ref/heads/main'))return JSON.stringify({ref:'refs/heads/main',object:{type:'commit',sha:merged?newMainSha:previousMainSha}});
 const target=route.split('/').at(-1);return JSON.stringify({sha:target,tree:{sha:ciTreeSha},parents:[{sha:previousMainSha},{sha:releaseSha}]});
};}
function mergeableGh({mergeable=true,state='unstable',main=previousMainSha}={}){return(_file,args)=>{
 const route=args.find(value=>String(value).startsWith('repos/'))??'';
 if(route.endsWith('git/ref/heads/main'))return JSON.stringify({object:{type:'commit',sha:main}});
 return JSON.stringify({number:125,state:'open',merged:false,draft:false,mergeable,mergeable_state:state,
  head:{sha:releaseSha,ref:'release/zola-production-live',repo:{full_name:'houseomegakennels-bit/blackspire-helix-group'}},
  base:{ref:'main',repo:{full_name:'houseomegakennels-bit/blackspire-helix-group'}}});
};}
test('mergeability gate requires a stable positive exact-head computation',()=>{
 assert.equal(observeReleaseMergeability({releaseSha,previousMainSha},{run:mergeableGh()}).status,'PR_MERGEABLE');
 for(const options of [{mergeable:null},{mergeable:false},{state:'dirty'},{main:'f'.repeat(40)}])
  assert.throws(()=>observeReleaseMergeability({releaseSha,previousMainSha},{run:mergeableGh(options)}));
});
test('expected-head observer distinguishes exact open and exact merged identity',()=>{
 const input={releaseSha,previousMainSha,ciMergeSha,ciTreeSha};
 assert.equal(observeExpectedHeadMerge(input,{run:gh()}).status,'OPEN_EXACT_HEAD');
 assert.deepEqual(observeExpectedHeadMerge(input,{run:gh({merged:true})}),{status:'MERGED_EXACT_HEAD',newMainSha});
 assert.throws(()=>observeExpectedHeadMerge(input,{run:gh({drift:true})}));
});
test('merge request binds PR 125, expected head and merge method',()=>{
 let found;const result=requestExpectedHeadMerge({releaseSha},{run:(_file,args)=>{found=args;}});
 assert.equal(result.status,'MERGE_REQUEST_SENT');assert.ok(found.includes(`sha=${releaseSha}`));assert.ok(found.includes('merge_method=merge'));
});
function response(value){const bytes=new TextEncoder().encode(JSON.stringify(value));return{ok:true,redirected:false,body:new ReadableStream({start(c){c.enqueue(bytes);c.close();}})};}
test('Vercel production observer requires stable dynamic exact-main identity',async()=>{
 const value={projectId:'prj_a9x4Tuzgzq6XrvtdtYNxONwL8Fou',target:'production',readyState:'READY',id:'dpl_Abc123',url:'front.vercel.app',
  meta:{githubCommitSha:newMainSha,githubCommitRef:'main'},gitSource:{sha:newMainSha}};
 assert.equal((await observeVercelProduction({newMainSha,token:'x'.repeat(32)},{fetchImpl:async()=>response(value)})).deploymentId,'dpl_Abc123');
 for(const changed of [{...value,readyState:'BUILDING'},{...value,meta:{...value.meta,githubCommitSha:releaseSha}},{...value,projectId:'foreign'}])
  await assert.rejects(observeVercelProduction({newMainSha,token:'x'.repeat(32)},{fetchImpl:async()=>response(changed)}));
});
