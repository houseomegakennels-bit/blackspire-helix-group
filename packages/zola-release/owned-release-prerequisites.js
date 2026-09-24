import {ownedReleaseOperationId} from './owned-release-input-preparation.js';
import {observeOwnedMigrationPrerequisites} from '../buyer-writer/owned-target-hardening-host.js';
const fail=()=>{throw new Error('Owned release prerequisite binding rejected');};
export function ownedReleasePrerequisiteStatus(release){
 if(![2,3].includes(release?.schema))fail();
 return release.schema===3?'OWNED_MIGRATION_SUCCESSOR_VERIFIED':'OWNED_MIGRATION_PREREQUISITES_VERIFIED';
}
export function ownedReleasePrerequisiteInput(release,operationId){
 if(release?.schema===3&&ownedReleaseOperationId(release)!==operationId)fail();
 return {releaseSha:release.releaseSha,operationId,profileDigest:release.profileDigest,
  sourceSecurityConfigurationFile:release.sourceSecurityConfigurationFile,ownedMigrationConfigurationFile:release.ownedMigrationConfigurationFile,
  ...(release.schema===3?{successorLineageFile:release.successorLineageFile}:{})};
}
export async function observeOwnedReleasePrerequisites(release,operationId){
 const input=ownedReleasePrerequisiteInput(release,operationId);
 if(release.schema===2)return observeOwnedMigrationPrerequisites(input);
 const {observeRuntimeSuccessorLineage}=await import('./successor-runtime-predecessor.js');
 return observeRuntimeSuccessorLineage(input);
}
