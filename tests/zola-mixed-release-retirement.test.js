import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {MIXED_RETIREMENT as P} from '../packages/zola-release/mixed-retirement-history.js';
import {validateMixedRetirementSnapshot,validateMixedRetirementStopped} from '../packages/zola-release/mixed-release-retirement.js';
const before={version:1,retainedEvidenceDigest:P.retainedEvidenceDigest,protectedStateDigest:'a'.repeat(64),
 lifecycleDigest:'b'.repeat(64),artifactDigest:P.artifactDigest,bindingRetained:true,authorityInactive:true};
const stopped={version:1,hostStopped:true,noDetachedSurvivors:true,bindingRetained:true,authorityInactive:true,currentSha:P.releaseSha,
 protectedStateDigest:before.protectedStateDigest,artifactDigest:before.artifactDigest,retainedEvidenceDigest:P.retainedEvidenceDigest};
test('stop receipt retains original protected state, binding, authority and deployed artifact',()=>{
 assert.equal(validateMixedRetirementSnapshot(before),before);
 assert.equal(validateMixedRetirementStopped(stopped,before),stopped);
 for(const key of Object.keys(before)){const x={...before};delete x[key];assert.throws(()=>validateMixedRetirementSnapshot(x),key);}
 for(const key of Object.keys(stopped)){const x={...stopped,[key]:typeof stopped[key]==='boolean'?false:'wrong'};assert.throws(()=>validateMixedRetirementStopped(x,before),key);}
});
test('synthetic coordinator preserves durable stop ordering and refuses uncertain redispatch',()=>{
 // Only the already-tested historical prefix parser is mocked. No production
 // journal, environment or credentials are loaded by this disposable child.
 const result=execFileSync(process.execPath,['--experimental-test-module-mocks','--input-type=module','-e',`
 import {mock} from 'node:test';import assert from 'node:assert/strict';
 import * as real from './packages/zola-release/mixed-retirement-history.js';
 const P=real.MIXED_RETIREMENT,seed=[{type:'synthetic_history'}];
 mock.module('./packages/zola-release/mixed-retirement-history.js',{namedExports:{...real,
 validateMixedRetirementPrefix:rows=>{assert.deepEqual(rows,seed);return true;}}});
 const {retireMixedReadRelease}=await import('./packages/zola-release/mixed-release-retirement.js');
 const before=${JSON.stringify(before)},stopped=${JSON.stringify(stopped)};
 function setup(mode){
  const rows=structuredClone(seed),records=new Map(),calls=[];let dead=false,unknown=mode==='unknown',survivor=mode==='survivor';
  const host={verifySuccessor:async()=>{calls.push('verify');},
   lease:async()=>({assertIdentity(){},close(){calls.push('close');}}),
   observeRunning:async()=>{assert.equal(dead,false);return structuredClone(before);},
   stop:async()=>{calls.push('stop');dead=true;if(unknown){unknown=false;throw Error('lost acknowledgement');}},
   observeStopped:async()=>{assert.equal(dead,true);if(survivor)throw Error('survivor');return structuredClone(stopped);}};
  const store={read:k=>records.get(k)??null,retain:(k,v)=>{calls.push(k);if(mode==='disk'&&k==='stop-intent')throw Error('disk');
   if(records.has(k))assert.deepEqual(records.get(k),v);else records.set(k,structuredClone(v));}};
  const journal={stream:()=>({events:()=>structuredClone(rows),append:e=>{calls.push('append');rows.push(e);}})};
  return {calls,rows,records,host,clear:()=>{survivor=false;},run:()=>retireMixedReadRelease({
   successorOperationId:'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',journal},{host,store,uid:0})};
 }
 const good=setup();await good.run();assert.equal(good.rows.length,2);real.validateMixedRetirementEvent(good.rows[1]);
 assert.ok(good.calls.indexOf('stop-intent')<good.calls.indexOf('stop'));
 assert.ok(good.calls.indexOf('stop-result')<good.calls.indexOf('append'));
 const lost=setup('unknown');await assert.rejects(lost.run());assert.equal(lost.records.has('stop-intent'),true);
 await lost.run();assert.equal(lost.calls.filter(x=>x==='stop').length,1);
 const survivor=setup('survivor');await assert.rejects(survivor.run());await assert.rejects(survivor.run());
 assert.equal(survivor.calls.filter(x=>x==='stop').length,1);assert.equal(survivor.rows.length,1);
 survivor.clear();await survivor.run();
 const disk=setup('disk');await assert.rejects(disk.run());assert.equal(disk.calls.includes('stop'),false);
 const drift=setup();drift.host.observeStopped=async()=>({...stopped,protectedStateDigest:'d'.repeat(64)});
 await assert.rejects(drift.run());assert.equal(drift.rows.length,1);
 console.log('synthetic retirement checks passed');
 `],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',LC_ALL:'C'},stdio:['ignore','pipe','pipe']});
 assert.equal(result.trim(),'synthetic retirement checks passed');
});
