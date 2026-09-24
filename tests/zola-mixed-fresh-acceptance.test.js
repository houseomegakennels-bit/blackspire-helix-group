import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryDigest as hash} from '../packages/zola-release/admitted-read-recovery.js';
import {MIXED_RETIREMENT as M} from '../packages/zola-release/mixed-retirement-history.js';
const P={releaseSha:M.successorReleaseSha,operationId:M.successorOperationId};
import {readCases} from '../packages/zola-six-reads/collector.js';
import {mixedCollectorEvidence,inspectMixedReadHistory} from '../packages/zola-release/mixed-fresh-acceptance.js';
const epoch='90a95d08-e9a4-4440-8251-477f0c319c27';
const reads=readCases('DE-0001').map((r,index)=>{
 const idempotencyKey='zola-six:'+epoch+':'+index;
 return{index,idempotencyKey,capability:r.capability,permission:r.permissions[0],request:r.text,requestDigest:hash({channel:'jarvis',workspaceId:'blackspire-command',text:r.text,idempotencyKey,executionIntent:'read_only'})};
});
const now=Date.now(),claims={schema:1,kind:'held-premerge-reads',permitId:'3b9c30be-0f41-41b0-bf03-16907f969371',commanderRunId:P.operationId,
 candidateSha:P.releaseSha,expectedDeploymentSha:P.releaseSha,epochRunId:epoch,workspace:'blackspire-command',principal:'blackspire-operator',
 apiGeneration:'a'.repeat(32),workerGeneration:'b'.repeat(32),issuedAt:now,expiresAt:now+900000,operations:['six_reads'],reads,tokenDigest:'c'.repeat(64)};
const report=()=>({releaseSha:P.releaseSha,livePass:false,databaseEvidence:{scope:'connected'},
 premergeAcceptance:{permitId:claims.permitId,claimsDigest:hash(claims)},
 results:reads.map(r=>({capability:r.capability,crossOwnerDenial:'PASS: denied',mutationDelta:0,paidProviderCalls:r.capability==='nexus.enrichment.status'?0:'UNVERIFIED'}))});
test('fresh evidence requires the newly issued permit and every distinct read',()=>{
 assert.equal(mixedCollectorEvidence(report(),claims).readCount,6);
 const duplicated=report();duplicated.results[1]=duplicated.results[0];assert.throws(()=>mixedCollectorEvidence(duplicated,claims));
});
for(const [name,mutate]of [
 ['old permit',r=>r.premergeAcceptance.permitId='old'],['wrong claims',r=>r.premergeAcceptance.claimsDigest='0'.repeat(64)],
 ['missing database evidence',r=>delete r.databaseEvidence],['missing denial',r=>r.results[0].crossOwnerDenial='UNVERIFIED'],
 ['mutation',r=>r.results[0].mutationDelta=1],['paid request',r=>r.results[5].paidProviderCalls=1],
 ['wrong deployment',r=>r.releaseSha='f'.repeat(40)],['incomplete collection',r=>r.results.pop()]
])test('refuses '+name,()=>{const r=report();mutate(r);assert.throws(()=>mixedCollectorEvidence(r,claims));});
test('a retired unknown collection cannot acquire a second intent',()=>{
 const e=[{version:1,type:'denial_intent',runId:epoch,authorityDigest:'d'.repeat(64)},{version:1,type:'denial_result',runId:epoch,receiptDigest:'e'.repeat(64)},
 {version:1,type:'permit_intent',claims,claimsDigest:hash(claims),configDigest:'f'.repeat(64),authorityDigest:'d'.repeat(64)},
 {version:1,type:'permit_active',claimsDigest:hash(claims)},
 {version:1,type:'permit_retired',claimsDigest:hash(claims),outcome:'UNKNOWN'}];
 assert.equal(inspectMixedReadHistory(e).retired,true);
 assert.throws(()=>inspectMixedReadHistory([...e,e[2]]));
});
test('cannot label an unknown result PASS',()=>{
 const e=[{version:1,type:'denial_intent',runId:epoch,authorityDigest:'d'.repeat(64)},{version:1,type:'denial_result',runId:epoch,receiptDigest:'e'.repeat(64)},
 {version:1,type:'permit_intent',claims,claimsDigest:hash(claims),configDigest:'f'.repeat(64),authorityDigest:'d'.repeat(64)},
 {version:1,type:'permit_retired',claimsDigest:hash(claims),outcome:'PASS'}];
 assert.throws(()=>inspectMixedReadHistory(e));
});

const prefix=()=>[
 {version:1,type:'denial_intent',runId:epoch,authorityDigest:'d'.repeat(64)},
 {version:1,type:'denial_result',runId:epoch,receiptDigest:'e'.repeat(64)},
 {version:1,type:'permit_intent',claims,claimsDigest:hash(claims),configDigest:'f'.repeat(64),authorityDigest:'d'.repeat(64)},
 {version:1,type:'permit_active',claimsDigest:hash(claims)}
];
test('complete evidence can retire once and all prefixes are observable',()=>{
 const evidence=mixedCollectorEvidence(report(),claims);
 const events=[...prefix(),{version:1,type:'collector_result',claimsDigest:hash(claims),evidence,evidenceDigest:hash(evidence)},
 {version:1,type:'permit_retired',claimsDigest:hash(claims),outcome:'PASS'}];
 for(let n=0;n<=events.length;n++)assert.doesNotThrow(()=>inspectMixedReadHistory(events.slice(0,n)));
 assert.equal(inspectMixedReadHistory(events).retired,true);
 assert.throws(()=>inspectMixedReadHistory([...events,events[0]]));
});
for(const [name,change]of [
 ['extra authority',e=>e[0].extra=true],
 ['old epoch',e=>e[0].runId=M.runId],
 ['denial mismatch',e=>e[1].runId=M.runId],
 ['authority mismatch',e=>e[2].authorityDigest='0'.repeat(64)],
 ['old operation',e=>{e[2].claims.commanderRunId=M.operationId;e[2].claimsDigest=hash(e[2].claims);}],
 ['old candidate',e=>{e[2].claims.candidateSha=M.releaseSha;e[2].claimsDigest=hash(e[2].claims);}],
 ['active mismatch',e=>e[3].claimsDigest='0'.repeat(64)]
])test('history refuses '+name,()=>{const e=structuredClone(prefix());change(e);assert.throws(()=>inspectMixedReadHistory(e));});
test('evidence refuses a different operation even with matching report digest',()=>{
 const c={...claims,commanderRunId:M.operationId},r=report();r.premergeAcceptance.claimsDigest=hash(c);
 assert.throws(()=>mixedCollectorEvidence(r,c));
});
