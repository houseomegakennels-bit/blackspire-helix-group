import test from 'node:test';
import assert from 'node:assert/strict';
import {RELEASE_STAGES} from '../packages/zola-release/commander-sequence.js';
import {PRODUCTION_STAGE_CLASSIFICATION,assertNoMissingProductionOperations,createFixedProductionOperations,observeReceiverAudit,observeVercelExactHeadPreview}
 from '../packages/zola-release/production-adapters.js';

test('production adapter classification is exact and admits no placeholder category',()=>{
 assert.deepEqual(Object.keys(PRODUCTION_STAGE_CLASSIFICATION).sort(),[...RELEASE_STAGES].sort());
 assert.ok(Object.isFrozen(PRODUCTION_STAGE_CLASSIFICATION));
 assert.ok(Object.values(PRODUCTION_STAGE_CLASSIFICATION).every(value=>['primitive','thin','missing'].includes(value)));
 assert.equal(Object.values(PRODUCTION_STAGE_CLASSIFICATION).filter(value=>value==='primitive').length,10);
});

test('all formerly missing executable operations are classified and complete',()=>{
 assert.equal(assertNoMissingProductionOperations(),true);
 assert.equal(Object.values(PRODUCTION_STAGE_CLASSIFICATION).filter(value=>value==='missing').length,0);
});

test('fixed production operation construction binds the exact registry',()=>{
 const releaseSha='a'.repeat(40),input={releaseSha,previousMainSha:'b'.repeat(40),recoverySha:'c'.repeat(40),
  protectedInputDigest:'d'.repeat(64),workspace:'zola-production',principal:'blackspire-release-root',inputDigest:'e'.repeat(64)};
 const release={releaseSha,backupManifestFile:'/var/lib/blackspire-operator/preparation/backup.json'};
 const operations=createFixedProductionOperations({release,input,source:{releaseSha,clean:true},journal:{stream:()=>({events:()=>[],append(){}})}});
 assert.deepEqual(Object.keys(operations),RELEASE_STAGES);assert.ok(Object.isFrozen(operations));
});

test('fixed external observers reject invalid release identity before network access',()=>{
 assert.throws(()=>observeReceiverAudit({releaseSha:'not-a-sha'}),/Fixed production observation rejected/);
 assert.throws(()=>observeVercelExactHeadPreview({releaseSha:'a'.repeat(39)}),/Fixed production observation rejected/);
});
