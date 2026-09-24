import {hash} from './commander-journal.js';
import {MIXED_READ_FAILURE as F,MIXED_READ_ROWS} from './mixed-read-failure.js';
import {recoveryDigest} from './admitted-read-recovery.js';

// This is one observed predecessor, not permission to discard arbitrary history.
export const MIXED_RETIREMENT=Object.freeze({
 ...F,eventCount:186,segmentStart:117,
 artifactDigest:'6b1030bd94b510f8433ae911b25d1f074c648c3fe934102d6db74b332b0c8292',
 prefixDigest:'09c2ddedb9ff566e0d30bd733f74e3629738398f4c0472bde97ba230c3fad953',
 segmentDigest:'ec29daa16cb88935c263d99833210346b2e01f75a04153c047a16aa36052a7f6',
 profileDigest:'2563185421523bf337e382a38ca389c5991406cb2adecc952048cdf5cf058505',
 successorReleaseSha:'f1f004ffcfe43ff92271ed3618f9b3d3bb7ac57e',
 successorOperationId:'b9679cbd-5331-45ae-a026-02b7f5e117e9',
 successorInputDigest:'d249b16ea4aa576a71dbb0bd04f38f0a9dfed96e1538fe8b06165491d3887e84',
 lineageDigest:'7e6aec9a795cb03aa0b0729e9245b0660c5a6bba23a4ae9b4c564af078e0dde8',
 gatewayReceiptDigest:'b270137e725a2af2707a72683a7f12f384f9fb361572664aa699d0d668f0e781',
 successorArtifactDigest:'e986b12a074bff70795de3a564007783c62eb6a4cb5c5295c15465eaedf96b6a',
 previousMainSha:'f3ac3d33c00885de3ebc6d7f5313a4965e75f0e8',
 recoverySha:'2c0b600c268faa0571f08322e16d7f81f37789be',
 retainedEvidenceDigest:recoveryDigest({pins:F,rows:MIXED_READ_ROWS}),
});
const fail=()=>{throw Error('MIXED_RETIREMENT_HISTORY_REFUSED');};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.split(',').sort().join(',');
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v);
export function validateMixedRetirementPrefix(events){
 const p=MIXED_RETIREMENT;
 if(!Array.isArray(events)||events.length!==p.eventCount||hash(events)!==p.prefixDigest
  ||hash(events.slice(p.segmentStart))!==p.segmentDigest)fail();
 return true;
}
export function validateMixedRetirementEvent(e){
 const p=MIXED_RETIREMENT;
 if(!exact(e,'schema,type,operationId,releaseSha,attemptId,ordinal,stage,prefixDigest,segmentDigest,successorReleaseSha,successorOperationId,backendProfile,profileDigest,proof,proofDigest')
  ||e.schema!==6||e.type!=='sequence_retired'||e.ordinal!==13||e.stage!=='six_reads'
  ||['operationId','releaseSha','attemptId','prefixDigest','segmentDigest','profileDigest','successorReleaseSha'].some(k=>e[k]!==p[k])
  ||!uuid(e.successorOperationId)||e.successorOperationId!==p.successorOperationId
  ||e.backendProfile!=='owned-postgres-v1'||!digest(e.proofDigest)||hash(e.proof)!==e.proofDigest)fail();
 const r=e.proof;
 if(!exact(r,'version,runId,currentSha,hostStopped,noDetachedSurvivors,authorityInactive,bindingRetained,retainedEffects,retainedEvidenceDigest,acceptanceDigest,collectorDigest,transitionDigest,stopPlanDigest,stopResultDigest,protectedStateDigest,successorArtifactDigest,lineageDigest')
  ||r.version!==1||r.runId!==p.runId||r.currentSha!==p.releaseSha
  ||['hostStopped','noDetachedSurvivors','authorityInactive','bindingRetained','retainedEffects'].some(k=>r[k]!==true)
  ||['retainedEvidenceDigest','acceptanceDigest','collectorDigest','transitionDigest','successorArtifactDigest','lineageDigest'].some(k=>r[k]!==p[k])
  ||!['stopPlanDigest','stopResultDigest','protectedStateDigest'].every(k=>digest(r[k])))fail();
 return true;
}
export function partitionMixedRetirement(events){
 const p=MIXED_RETIREMENT,index=p.eventCount,e=events[index],prefix=events.slice(0,index);
 validateMixedRetirementPrefix(prefix);validateMixedRetirementEvent(e);
 const indices=events.flatMap((r,i)=>r?.type==='sequence_retired'?[i]:[]);
 if(indices.join(',')!=='68,116,186')fail();
 const current=events.slice(index+1),starts=current.filter(r=>r?.type==='sequence_started');
 if(starts.length>1)fail();
 for(const s of starts)if(s.releaseSha!==e.successorReleaseSha||s.operationId!==e.successorOperationId
  ||s.previousMainSha!==p.previousMainSha||s.recoverySha!==p.recoverySha)fail();
 return {current,prefix,retired:Object.freeze({...structuredClone(e),historicalMutationState:true,status:'RETIRED_WITH_RETAINED_EFFECTS'})};
}
