import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../packages/zola-release/commander-journal.js';
import {MIXED_WRITER_REJECTION as P,validateMixedWriterRejectionEvent,validateMixedWriterRejectionPrefix} from '../packages/zola-release/mixed-writer-rejection.js';
function event(){
 const proof=Object.fromEntries('expired,reserved,unbound,requestMatches,digestMatches,ownerMatches,signerMatches,criteriaMatches,versionStale,syntheticTarget,dispatchAbsent,noActiveDispatches,jobFailed'.split(',').map(k=>[k,true]));
 return {schema:1,type:P.type,releaseSha:P.releaseSha,operationId:P.operationId,attemptId:P.attemptId,prefixDigest:P.prefixDigest,
 handleDigest:P.handleDigest,targetBeforeDigest:P.targetBeforeDigest,targetAfterDigest:hash('new target'),proof,proofDigest:hash(proof)};
}
test('rejected issuance requires every terminal no-effect and identity proof',()=>{
 assert.equal(validateMixedWriterRejectionEvent(event()).type,P.type);
 for(const k of Object.keys(event().proof)){
  const e=event();e.proof[k]=false;e.proofDigest=hash(e.proof);
  assert.throws(()=>validateMixedWriterRejectionEvent(e),k);
 }
});
test('retirement rejects changed bindings, absent fields and fabricated history',()=>{
 for(const k of Object.keys(event())){const e=event();delete e[k];assert.throws(()=>validateMixedWriterRejectionEvent(e),k);}
 for(const k of ['releaseSha','operationId','attemptId','prefixDigest','handleDigest','targetBeforeDigest','proofDigest']){
  const e=event();e[k]='0'.repeat(64);assert.throws(()=>validateMixedWriterRejectionEvent(e),k);
 }
 const e=event();e.targetAfterDigest=e.targetBeforeDigest;assert.throws(()=>validateMixedWriterRejectionEvent(e));
 for(const rows of [[],Array.from({length:233},()=>({schema:1,type:'invented'}))])
  assert.throws(()=>validateMixedWriterRejectionPrefix(rows,event()));
});

import {MIXED_WRITER_UNRESERVED as Q,validateMixedUnreservedEvent,mixedWriterRequestSeed} from '../packages/zola-release/mixed-writer-rejection.js';
function unreserved(){
 const proof=Object.fromEntries('admissionAbsent,originalExpiredReserved,requestCollision,dispatchAbsent,targetCurrent,noActiveDispatches'.split(',').map(k=>[k,true]));
 return {schema:1,type:Q.type,releaseSha:Q.releaseSha,operationId:Q.operationId,attemptId:Q.attemptId,prefixDigest:Q.prefixDigest,handleDigest:Q.handleDigest,targetDigest:Q.targetDigest,proof,proofDigest:hash(proof)};
}
test('request collision retirement requires absent admission and expired original reservation',()=>{
 validateMixedUnreservedEvent(unreserved());
 for(const k of Object.keys(unreserved().proof)){const e=unreserved();e.proof[k]=false;e.proofDigest=hash(e.proof);assert.throws(()=>validateMixedUnreservedEvent(e));}
 for(const k of Object.keys(unreserved())){const e=unreserved();delete e[k];assert.throws(()=>validateMixedUnreservedEvent(e));}
});
test('only the exact rejected attempt gets a distinct deterministic request identity',()=>{
 const bound={releaseSha:P.releaseSha,operationId:P.operationId,attemptId:P.attemptId,workspace:'zola-production',principal:'blackspire-release-root',inputDigest:'a'.repeat(64),checkOutputDigest:'b'.repeat(64)};
 assert.notEqual(hash(mixedWriterRequestSeed(bound)),hash(bound));
 assert.equal(hash(mixedWriterRequestSeed(bound)),hash(mixedWriterRequestSeed({...bound})));
 for(const k of ['releaseSha','operationId','attemptId']){
  const other={...bound,[k]:'different'};assert.equal(mixedWriterRequestSeed(other),other);
 }
});
