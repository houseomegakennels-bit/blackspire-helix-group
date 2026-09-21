import {hash} from './commander-journal.js';
export const BLOCKED_RELEASE=Object.freeze({
 releaseSha:'7bd0323e09a221a21db92ba6853a4fe33bb36732',operationId:'63017917-49de-4942-bc8f-2aab9463fb78',
 attemptId:'62cea1bf-4147-45c5-94f0-dcf0e2b01aac',previousMainSha:'2775fd5043ad422418a4177f686671961e9a9738',
 recoverySha:'2c0b600c268faa0571f08322e16d7f81f37789be',currentSha:'6f7e0c268b75c86f8f6318725d40e3d774a59091',
 prefixDigest:'997d18e011544107c002b494a5d623768f097c165427a5c51a4b4c66467fdabf',
 segmentDigest:'40fd1d5263b2735b6bec31db3632dceedba49090e63a9f376ad4d8f9648fac6b',
 provisioningDigest:'fac5dd05d8d431e8524c19edd4c1554ae806b13cbae63cc35b1f5eb60eb36b2c',
 n8nJournalDigest:'8d08d88e423e08c14213070994f730c24ea1328740c417065e16a9cbe5ecc876',
 eventCount:68,segmentStart:51,
});
const fail=()=>{throw new Error('Blocked release retirement history rejected');};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===keys.split(',').sort().join(',');
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function validateBlockedReleasePrefix(events){
 if(!Array.isArray(events)||events.length!==BLOCKED_RELEASE.eventCount||hash(events)!==BLOCKED_RELEASE.prefixDigest||hash(events.slice(BLOCKED_RELEASE.segmentStart))!==BLOCKED_RELEASE.segmentDigest)fail();
 return true;
}
export function partitionRetiredReleaseHistory(events){
 const indices=events.flatMap((row,index)=>row?.type==='sequence_retired'?[index]:[]);
 if(!indices.length)return {current:events,retired:null,prefix:null};
 if(indices.length!==1)fail();
 const index=indices[0],event=events[index],prefix=events.slice(0,index);
 validateBlockedReleasePrefix(prefix);
 if(!exact(event,'schema,type,operationId,releaseSha,attemptId,ordinal,stage,prefixDigest,segmentDigest,successorReleaseSha,backendProfile,profileDigest,proof,proofDigest')
  ||event.schema!==4||event.type!=='sequence_retired'||event.ordinal!==5||event.stage!=='admission_lease'
  ||['operationId','releaseSha','attemptId','prefixDigest','segmentDigest'].some(k=>event[k]!==BLOCKED_RELEASE[k])
  ||!(/^[a-f0-9]{40}$/).test(event.successorReleaseSha)||event.successorReleaseSha===event.releaseSha||event.backendProfile!=='owned-postgres-v1'
  ||!digest(event.profileDigest)||!digest(event.proofDigest)||hash(event.proof)!==event.proofDigest)fail();
 const p=event.proof;
 if(!exact(p,'version,observedAt,rolesAbsent,hostStopped,currentSha,admissionAbsent,provisioningDigest,retainedEffectsDigest,n8nJournalDigest,providerAclDigest,providerUnchanged')
  ||p.version!==1||!Number.isSafeInteger(p.observedAt)||p.observedAt<=0||p.rolesAbsent!==true||p.hostStopped!==true||p.admissionAbsent!==true||p.providerUnchanged!==true
  ||p.currentSha!==BLOCKED_RELEASE.currentSha||![p.provisioningDigest,p.retainedEffectsDigest,p.n8nJournalDigest,p.providerAclDigest].every(digest)||p.provisioningDigest!==BLOCKED_RELEASE.provisioningDigest||p.n8nJournalDigest!==BLOCKED_RELEASE.n8nJournalDigest
  ||p.retainedEffectsDigest!==hash(prefix.slice(BLOCKED_RELEASE.segmentStart)))fail();
 const current=events.slice(index+1);
 const start=current.find(row=>row?.type==='sequence_started');
 if(start&&(start.releaseSha!==event.successorReleaseSha||start.previousMainSha!==BLOCKED_RELEASE.previousMainSha||start.recoverySha!==BLOCKED_RELEASE.recoverySha||start.operationId===event.operationId))fail();
 return {current,prefix,retired:Object.freeze({...structuredClone(event),historicalMutationState:true,status:'RETIRED_WITH_RETAINED_EFFECTS'})};
}

// Called by the production composition before constructing any stage adapters.
export function assertRetiredReleaseSuccessor(events,release){
 const {retired}=partitionRetiredReleaseHistory(events);
 if(retired&&(release?.releaseSha!==retired.successorReleaseSha||release?.backendProfile!==retired.backendProfile||release?.profileDigest!==retired.profileDigest))fail();
 return true;
}
