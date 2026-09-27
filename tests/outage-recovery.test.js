import test from 'node:test';
import assert from 'node:assert/strict';
import {hash} from '../packages/zola-release/commander-journal.js';
import {OUTAGE_STEPS,runOutageRecovery,validateOutagePredecessor} from '../packages/zola-release/outage-recovery.js';

function fixture(){
 const oldState={mode:'open',releaseSha:'a'.repeat(40),runId:'fixture-run',apiGeneration:'a',workerGeneration:'w'};
 const priorPlan={releaseSha:oldState.releaseSha,runId:oldState.runId,configurationDigest:'configuration',newEnvironmentDigest:'environment'};
 return {oldState,priorState:structuredClone(oldState),priorPlan,
 priorResult:{version:1,status:'PASSWORD_ACTIVATED',releaseSha:oldState.releaseSha,planDigest:hash(priorPlan),stateDigest:hash(oldState)},
 configurationDigest:'configuration',environmentDigest:'environment'};
}
test('recovery requires exact verified predecessor, configuration and current admission',()=>{
 assert.doesNotThrow(()=>validateOutagePredecessor(fixture()));
 for(const alter of [
 x=>x.oldState.apiGeneration='changed',
 x=>x.oldState.mode='held',
 x=>x.priorState.workerGeneration='changed',
 x=>x.priorResult.status='UNVERIFIED',
 x=>x.priorPlan.runId='changed',
 x=>x.configurationDigest='changed',
 x=>x.environmentDigest='changed',
 x=>x.priorResult.releaseSha='b'.repeat(40),
 ]){const x=fixture();alter(x);assert.throws(()=>validateOutagePredecessor(x));}
});
function host(failure){
 const seen=[];
 const h={preflight:async()=>{seen.push('preflight');if(failure==='preflight')throw Error('fixture');return{};},
 record:async(s,p)=>seen.push(s+':'+p),finish:async()=>seen.push('finish'),contain:async()=>seen.push('contain')};
 for(const step of OUTAGE_STEPS)h[step]=async()=>{seen.push(step);if(step===failure)throw Error('fixture');};
 return {h,seen};
}
test('successful recovery renews bindings before OPEN and never installs configuration or rotates passwords',async()=>{
 const {h,seen}=host();assert.equal((await runOutageRecovery(h)).status,'OUTAGE_RECOVERED');
 assert.ok(seen.indexOf('writer')<seen.indexOf('open'));
 assert.ok(seen.indexOf('verifyHeld')<seen.indexOf('open'));
 assert.equal(seen.at(-1),'finish');assert.equal(seen.includes('contain'),false);
 assert.equal(OUTAGE_STEPS.includes('install'),false);assert.equal(OUTAGE_STEPS.includes('revoke'),false);
});
test('every interrupted entered transition contains; failed preflight has no effects',async()=>{
 for(const step of ['preflight',...OUTAGE_STEPS]){
 const {h,seen}=host(step);await assert.rejects(runOutageRecovery(h));
 assert.equal(seen.at(-1),step==='preflight'?'preflight':'contain');
 assert.equal(seen.includes('finish'),false);
 }
});
