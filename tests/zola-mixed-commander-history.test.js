import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('schema-six activation partition requires no legacy activation; older rules remain strict',()=>{
 const code=String.raw`
 import {mock} from 'node:test';
 import assert from 'node:assert/strict';
 import {hash} from './packages/zola-release/commander-journal.js';
 const retired=await import('./packages/zola-release/retired-release-history.js');
 const sequence=await import('./packages/zola-release/commander-sequence.js');
 const bound={releaseSha:'a'.repeat(40),operationId:'11111111-1111-4111-8111-111111111111',attemptId:'22222222-2222-4222-8222-222222222222',inputDigest:'3'.repeat(64),checkOutputDigest:'4'.repeat(64)};
 mock.module('./packages/zola-release/retired-release-history.js',{namedExports:{...retired,
  partitionRetiredReleaseHistory:rows=>rows[0]?.fixture?{retired:{schema:rows[0].schema},prefix:rows[0].prefix,current:[]}:{retired:null,current:rows},
  assertRetiredReleaseSuccessor:()=>true
 }});
 mock.module('./packages/zola-release/commander-sequence.js',{namedExports:{...sequence,inspectReleaseSequenceHistory:()=>({context:bound,pending:{...bound,stage:'admission_lease'}})}});
 const {inspectBuyerWriterActivationHistory:inspect}=await import('./packages/zola-release/buyer-writer-activation.js');
 const empty=inspect([{fixture:true,schema:6,prefix:[]}]);
 assert.equal(empty.intent,null);assert.equal(empty.completed.size,0);
 for(const schema of [4,5])assert.throws(()=>inspect([{fixture:true,schema,prefix:[]}]));
 const intent={schema:1,type:'buyer_writer_activation_intent',binding:bound,bindingDigest:hash(bound)};
 assert.throws(()=>inspect([{fixture:true,schema:6,prefix:[intent]}]));
 `;
 const result=spawnSync(process.execPath,['--experimental-test-module-mocks','--input-type=module','-e',code],{cwd:new URL('..',import.meta.url),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);
});
