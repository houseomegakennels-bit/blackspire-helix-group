import test from 'node:test';
import assert from 'node:assert/strict';
import {MIXED_READ_FAILURE as pins,classifyMixedReadFailure} from '../packages/zola-release/mixed-read-failure.js';
const snapshot=()=>({...pins,held:true,priorLineageVerified:true,transitionComplete:true,permitRetired:true,permitExpired:true,
 activePermit:false,collectorRunning:false,outcome:'UNKNOWN',rowsUnchanged:true,archivesUnchanged:true,
 otherReadTasks:0,otherReadInputs:0,collected:1,admitted:2,serviceCount:4,lifecycleBound:true,writerBound:true,
 deploymentVerified:true,stage:'six_reads',ordinal:13,pendingAttemptId:pins.attemptId});
test('mixed result retains successful read without converting unknown read to acceptance',()=>{
 const p=classifyMixedReadFailure(snapshot());
 assert.equal(p.completedReads,1);assert.equal(p.unknownReads,1);assert.equal(p.outcome,'UNKNOWN');
 assert.equal(p.automaticReplayAllowed,false);assert.equal(p.acceptancePassed,false);assert.equal(p.productionOpen,false);
});
for(const[field,value]of Object.entries({held:false,priorLineageVerified:false,transitionComplete:false,permitRetired:false,
 permitExpired:false,activePermit:true,collectorRunning:true,outcome:'PASS',rowsUnchanged:false,archivesUnchanged:false,
 otherReadTasks:1,otherReadInputs:1,collected:2,admitted:1,serviceCount:3,lifecycleBound:false,writerBound:false,
 deploymentVerified:false,stage:'six_live_reads',ordinal:14,pendingAttemptId:'00000000-0000-0000-0000-000000000000',
 releaseDigest:'0'.repeat(64),collectorDigest:'0'.repeat(64),acceptanceDigest:'0'.repeat(64),transitionDigest:'0'.repeat(64)})){
 test('rejects mixed recovery '+field+' drift',()=>assert.throws(()=>classifyMixedReadFailure({...snapshot(),[field]:value}),/MIXED_READ_FAILURE_REFUSED/));
}
