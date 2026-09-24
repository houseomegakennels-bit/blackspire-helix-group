import {hash} from '../packages/zola-release/commander-journal.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {retirePartialRelease} from '../packages/zola-release/partial-release-retirement.js';
import {PARTIAL_RELEASE} from '../packages/zola-release/partial-retirement-history.js';
import {partitionRetiredReleaseHistory} from '../packages/zola-release/retired-release-history.js';
const fixture=name=>JSON.parse(fs.readFileSync(new URL('./fixtures/zola-release/'+name,import.meta.url),'utf8'));
const successorReleaseSha='a'.repeat(40),successorOperationId='aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
function setup(){
 const release=fixture('retired-release-2636.json'),n8n=fixture('retired-release-n8n-2636.json'),records=new Map(),calls=[];
 const proof=release.findLast(e=>e.type==='release_lifecycle_result').proof;
 const hold=release.findLast(e=>e.type==='release_hold_result'),{type:ignored,...marker}=hold;
 const before={admissionStateDigest:hold.stateDigest,pendingMarkerDigest:hash(marker),protected:{digest:'b'.repeat(64)},services:['api','worker','gateway','store'],lifecycle:proof,artifact:{artifactDigest:proof.artifactDigest}};
 let stopped=false,stopUnknown=false,survivor=false;
 const journal={stream:name=>({events:()=>structuredClone(name==='release'?release:n8n),append:e=>{calls.push('retire');release.push(structuredClone(e));}})};
 const host={verifySuccessor:async()=>{calls.push('successor');},lineage:async()=>({lineageDigest:'c'.repeat(64)}),lease:async()=>({assertIdentity(){},close(){calls.push('close');}}),
  observeRunning:async()=>{if(stopped)throw Error('already stopped');return structuredClone(before);},
  stop:async()=>{calls.push('stop');stopped=true;if(stopUnknown)throw Error('stop acknowledgement lost');},
  observeStopped:async()=>{if(!stopped||survivor)throw Error('not quiescent');return {hostStopped:true,noDetachedSurvivors:true};}};
 const store={read:k=>records.get(k)??null,retain:(k,v)=>{calls.push(k);if(records.has(k))assert.deepEqual(records.get(k),v);else records.set(k,structuredClone(v));}};
 return {release,n8n,records,calls,host,store,journal,before,unknown:()=>{stopUnknown=true;},survivor:v=>{survivor=v;},run:()=>retirePartialRelease({successorReleaseSha,successorOperationId,journal},{host,store,uid:0})};
}
test('exact chained prefix retires only after durable one-shot stop proof, preserving every old row',async()=>{
 const f=setup(),before=JSON.stringify(f.release),r=await f.run();assert.equal(r.status,'PARTIAL_RELEASE_RETIRED');
 assert.equal(JSON.stringify(f.release.slice(0,-1)),before);assert.equal(f.calls.filter(x=>x==='stop').length,1);
 assert.ok(f.calls.indexOf('stop-intent')<f.calls.indexOf('stop'));assert.ok(f.calls.indexOf('stop-result')<f.calls.indexOf('retire'));
 const partition=partitionRetiredReleaseHistory(f.release);assert.equal(partition.retired.releaseSha,PARTIAL_RELEASE.releaseSha);
 assert.equal((await f.run()).status,'PARTIAL_RELEASE_ALREADY_RETIRED');assert.equal(f.calls.filter(x=>x==='stop').length,1);
});
test('unknown stop acknowledges only observed quiescence and never resends stop',async()=>{
 const f=setup();f.unknown();await assert.rejects(f.run());assert.equal(f.records.has('stop-intent'),true);assert.equal(f.records.has('stop-result'),false);
 assert.equal((await f.run()).status,'PARTIAL_RELEASE_RETIRED');assert.equal(f.calls.filter(x=>x==='stop').length,1);
});
test('survivors preserve stopped intent and prevent terminal retirement',async()=>{
 const f=setup();f.survivor(true);await assert.rejects(f.run());await assert.rejects(f.run());assert.equal(f.calls.filter(x=>x==='stop').length,1);assert.equal(f.calls.includes('retire'),false);
 f.survivor(false);await f.run();assert.equal(f.calls.filter(x=>x==='stop').length,1);
});
test('changed original history, workflow effect, or lifecycle generation blocks before stop',async()=>{
 for(const change of [f=>f.release[0].extra=true,f=>f.n8n.push({type:'intent'}),f=>f.before.lifecycle.api.generation='d'.repeat(32),f=>f.before.admissionStateDigest='d'.repeat(64),f=>f.before.pendingMarkerDigest='d'.repeat(64)]){
  const f=setup();change(f);await assert.rejects(f.run());assert.equal(f.calls.includes('stop'),false);
 }
});
test('durable stop-intent failure prevents systemd mutation and successor drift cannot retire',async()=>{
 const f=setup(),retain=f.store.retain;f.store.retain=(k,v)=>{if(k==='stop-intent')throw Error('disk');retain(k,v);};await assert.rejects(f.run());assert.equal(f.calls.includes('stop'),false);
 const g=setup();let count=0;g.host.lineage=async()=>({lineageDigest:(++count===1?'c':'d').repeat(64)});await assert.rejects(g.run());assert.equal(g.records.has('stop-result'),true);assert.equal(g.calls.includes('retire'),false);
});
