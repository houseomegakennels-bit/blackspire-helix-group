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
