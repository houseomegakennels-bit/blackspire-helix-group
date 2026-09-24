import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {ADMITTED_READ_RECOVERY as P,recoveryDigest as hash} from '../packages/zola-release/admitted-read-recovery.js';
import {readCases} from '../packages/zola-six-reads/collector.js';
import {freshCollectorEvidence,inspectFreshReadHistory} from '../packages/zola-release/admitted-read-fresh-acceptance.js';
import {load} from '../packages/zola-release/admitted-read-continuation-loader.js';
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
 assert.equal(freshCollectorEvidence(report(),claims).readCount,6);
 const duplicated=report();duplicated.results[1]=duplicated.results[0];assert.throws(()=>freshCollectorEvidence(duplicated,claims));
});
for(const [name,mutate]of [
 ['old permit',r=>r.premergeAcceptance.permitId='old'],['wrong claims',r=>r.premergeAcceptance.claimsDigest='0'.repeat(64)],
 ['missing database evidence',r=>delete r.databaseEvidence],['missing denial',r=>r.results[0].crossOwnerDenial='UNVERIFIED'],
 ['mutation',r=>r.results[0].mutationDelta=1],['paid request',r=>r.results[5].paidProviderCalls=1],
 ['wrong deployment',r=>r.releaseSha='f'.repeat(40)],['incomplete collection',r=>r.results.pop()]
])test('refuses '+name,()=>{const r=report();mutate(r);assert.throws(()=>freshCollectorEvidence(r,claims));});
test('a retired unknown collection cannot acquire a second intent',()=>{
 const e=[{version:1,type:'denial_intent'},{version:1,type:'denial_result'},
 {version:1,type:'permit_intent',claims,claimsDigest:hash(claims)},
 {version:1,type:'permit_active',claimsDigest:hash(claims)},
 {version:1,type:'permit_retired',claimsDigest:hash(claims),outcome:'UNKNOWN'}];
 assert.equal(inspectFreshReadHistory(e).retired,true);
 assert.throws(()=>inspectFreshReadHistory([...e,e[2]]));
});
test('cannot label an unknown result PASS',()=>{
 const e=[{version:1,type:'denial_intent'},{version:1,type:'denial_result'},
 {version:1,type:'permit_intent',claims,claimsDigest:hash(claims)},
 {version:1,type:'permit_retired',claimsDigest:hash(claims),outcome:'PASS'}];
 assert.throws(()=>inspectFreshReadHistory(e));
});
test('composition patch accepts only the exact frozen native entry',async()=>{
 const file='/mnt/blackspire-builds/development-cache/0/workspaces/zola-owned-cloud-attempt9-20260923/scripts/zola-release-owned-n8n-operator.js';
 const source=fs.readFileSync(file,'utf8'),next=async()=>({format:'module',source});
 const r=await load('file://'+file,{},next);
 assert.match(r.source,/wrapReadRecoveryOperations\(context,\{\.\.\.fixed,provider_acl_check:providerAdapter\}\)/);
 assert.match(r.source,/ensureWriterBinding:ensureReadRecoveryWriterBinding/);
 await assert.rejects(load('file://'+file,{},async()=>({format:'module',source:source+'\n'})));
 assert.equal((await load('file:///unrelated.js',{},next)).source,source);
});
