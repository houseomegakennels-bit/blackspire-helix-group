import test from 'node:test';
import assert from 'node:assert/strict';
import {RELEASE_STAGES} from '../packages/zola-release/commander-sequence.js';
import {PRODUCTION_STAGE_CLASSIFICATION,assertNoMissingProductionOperations,createFixedProductionOperations,observeReceiverAudit,observeVercelExactHeadPreview}
 from '../packages/zola-release/production-adapters.js';

test('production adapter classification is exact and admits no placeholder category',()=>{
 assert.deepEqual(Object.keys(PRODUCTION_STAGE_CLASSIFICATION).sort(),[...RELEASE_STAGES].sort());
 assert.ok(Object.isFrozen(PRODUCTION_STAGE_CLASSIFICATION));
 assert.ok(Object.values(PRODUCTION_STAGE_CLASSIFICATION).every(value=>['primitive','thin','missing'].includes(value)));
 assert.equal(Object.values(PRODUCTION_STAGE_CLASSIFICATION).filter(value=>value==='primitive').length,2);
});

test('composition cannot claim completeness while executable operations are missing',()=>{
 assert.throws(()=>assertNoMissingProductionOperations(),error=>error.code==='PRODUCTION_OPERATIONS_MISSING'
  &&error.stages.includes('bounded_writer_e2e')&&error.stages.includes('production_smoke')&&error.stages.includes('rollback_verification'));
});

test('fixed production operation construction fails closed instead of installing placeholders',()=>{
 assert.throws(()=>createFixedProductionOperations(),error=>error.code==='PRODUCTION_OPERATIONS_MISSING');
});

test('fixed external observers reject invalid release identity before network access',()=>{
 assert.throws(()=>observeReceiverAudit({releaseSha:'not-a-sha'}),/Fixed production observation rejected/);
 assert.throws(()=>observeVercelExactHeadPreview({releaseSha:'a'.repeat(39)}),/Fixed production observation rejected/);
});
