import test from 'node:test';
import assert from 'node:assert/strict';
import {PRIOR_READ_PINS,validatePriorReadSummary} from '../packages/zola-release/admitted-read-prior-recovery.js';
const summary=()=>({...PRIOR_READ_PINS,completed:true,retired:true,outcome:'UNKNOWN',hasResult:false,
 priorRowsUnchanged:true,archiveUnchanged:true,historyLength:5,claimsExpired:true,configBound:true,collectorBound:true});
test('completed transition and failed acceptance stay distinct',()=>{
 const p=validatePriorReadSummary(summary());
 assert.equal(p.status,'PRIOR_RECOVERY_PRESERVED_UNKNOWN');assert.equal(p.automaticReplayAllowed,false);assert.equal(p.acceptancePassed,false);
});
for(const [field,value] of Object.entries({sourceSha:'0'.repeat(40),planDigest:'0'.repeat(64),transitionDigest:'0'.repeat(64),
 acceptanceDigest:'0'.repeat(64),collectorDigest:'0'.repeat(64),configDigest:'0'.repeat(64),claimsDigest:'0'.repeat(64),
 completed:false,retired:false,outcome:'PASS',hasResult:true,priorRowsUnchanged:false,archiveUnchanged:false,
 historyLength:6,claimsExpired:false,configBound:false,collectorBound:false})){
 test('prior lineage refuses '+field,()=>assert.throws(()=>validatePriorReadSummary({...summary(),[field]:value}),/PRIOR_READ_RECOVERY_REFUSED/));
}
