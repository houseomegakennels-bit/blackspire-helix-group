import {MIXED_RETIREMENT as P,validateMixedRetirementPrefix} from './mixed-retirement-history.js';
import {observeMixedReadFailure} from './mixed-read-failure-host.js';
import {createOwnedSuccessorFinalInputHost} from './owned-successor-final-inputs-host.js';
import {verifyOwnedMigrationSuccessorSource,prepareOwnedMigrationSuccessor,observeOwnedMigrationSuccessor} from '../buyer-writer/owned-migration-successor.js';
const ROOT='/mnt/blackspire-builds/development-cache/0/workspaces/zola-final-successor-20260924';
const fail=()=>{throw Error('MIXED_SUCCESSOR_PREPARATION_REFUSED');};
export function validateMixedSuccessorRequest(request){
 if(request?.releaseSha!==P.successorReleaseSha||request.profileDigest!==P.profileDigest
  ||typeof request.operationId!=='string'||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(request.operationId)
  ||request.operationId===P.operationId)fail();
 return request;
}
export async function observeMixedSuccessorPreparationHeld(journal){
 validateMixedRetirementPrefix(journal.stream('release').events());
 const proof=await observeMixedReadFailure();
 validateMixedRetirementPrefix(journal.stream('release').events());
 if(proof.retainedEvidenceDigest!==P.retainedEvidenceDigest||proof.acceptancePassed!==false||proof.productionOpen!==false)fail();
 return proof;
}
export function createMixedSuccessorFinalInputHost({releaseSha,journal,inspect=false}){
 if(releaseSha!==P.successorReleaseSha)fail();
 return createOwnedSuccessorFinalInputHost({releaseSha,journal,inspect,sourceRoot:ROOT,observePreparationHeld:observeMixedSuccessorPreparationHeld});
}
// Data lineage remains the immutable original2636 migration. Runtime authority
// comes from the separately validated a8 mixed failure; no data copy or DDL.
const verifySource=sha=>{
 if(sha!==P.successorReleaseSha)fail();
 verifyOwnedMigrationSuccessorSource(sha,{root:ROOT});
};
export function prepareMixedSuccessorLineage(request){
 validateMixedSuccessorRequest(request);
 return prepareOwnedMigrationSuccessor(request,{verifySource,observePreparationHeld:observeMixedSuccessorPreparationHeld});
}
export function observeMixedSuccessorLineage(request){
 validateMixedSuccessorRequest(request);
 return observeOwnedMigrationSuccessor(request,{verifySource});
}
