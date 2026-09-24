import {hash} from './commander-journal.js';
export const MIXED_WRITER_REJECTION=Object.freeze({
 type:'bounded_writer_unissued_retired',eventCount:233,
 prefixDigest:'8e9026373c28f8a5e2d73af1b7b13e05cea08eaa88bfc391d9de3df522c4aee3',
 handleDigest:'223e13ec66e095e2d039ec87100e2b7c22b67169c6830e41841345399181a80c',
 handleRowDigest:'f0ebc25b8ee303229ac61bda6f83f535f3ff61d02cb3aaa801864edc1afe8a2e',
 targetBeforeDigest:'4e420c249db237ccaaa2dad3be10cb83c68ee71ddb6ab1e78ded700fd8dfd138',
 releaseSha:'f1f004ffcfe43ff92271ed3618f9b3d3bb7ac57e',
 operationId:'b9679cbd-5331-45ae-a026-02b7f5e117e9',attemptId:'76698759-cafd-49d2-af94-cad39a77256c'
});
const P=MIXED_WRITER_REJECTION,fail=()=>{throw Error('MIXED_WRITER_REJECTION_REFUSED');};
const exact=(v,k)=>v&&Object.keys(v).sort().join(',')===k.split(',').sort().join(',');
export function validateMixedWriterRejectionEvent(row){
 if(!exact(row,'schema,type,releaseSha,operationId,attemptId,prefixDigest,handleDigest,targetBeforeDigest,targetAfterDigest,proof,proofDigest')
  ||row.schema!==1||['type','releaseSha','operationId','attemptId','prefixDigest','handleDigest','targetBeforeDigest'].some(k=>row[k]!==P[k])
  ||!(/^[a-f0-9]{64}$/).test(row.targetAfterDigest??'')||row.targetAfterDigest===P.targetBeforeDigest
  ||!exact(row.proof,'expired,reserved,unbound,requestMatches,digestMatches,ownerMatches,signerMatches,criteriaMatches,versionStale,syntheticTarget,dispatchAbsent,noActiveDispatches,jobFailed')
  ||Object.values(row.proof).some(x=>x!==true)||hash(row.proof)!==row.proofDigest)fail();
 return row;
}
export function validateMixedWriterRejectionPrefix(events,row){
 validateMixedWriterRejectionEvent(row);
 if(events.length!==P.eventCount||hash(events)!==P.prefixDigest)fail();
 const handles=events.filter(x=>x.type==='bounded_writer_admission_handle'&&x.attemptId===P.attemptId);
 if(handles.length!==1||handles[0].operation!=='issue'||hash(handles[0])!==P.handleRowDigest)fail();
 return true;
}
