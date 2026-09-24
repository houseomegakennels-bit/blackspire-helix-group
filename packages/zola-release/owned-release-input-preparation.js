import path from 'node:path';
import {validateOwnedDatabaseProfile,databaseProfileDigest} from '../buyer-writer/database-profile.js';
const fail=()=>{throw new Error('Owned production release input preparation rejected');};
const fields=['schema','kind','releaseSha','previousMainSha','recoverySha','workspace','principal','preparationRoot','packageConfigurationFile','n8nBackupFile','diskConfigurationFile','backupManifestFile','migrationConfigurationFile','activationConfigurationFile'];
const protectedPath=v=>typeof v==='string'&&v.startsWith('/var/lib/blackspire-operator/')&&path.resolve(v)===v&&!v.includes('\0');
// Preserve the existing release package, backups and original migration input.
// Only the explicit backend and separate owned prerequisite paths are added.
export function prepareOwnedProductionReleaseInput({legacy,profile,operationId}){
 if(!legacy||Object.keys(legacy).sort().join(',')!==[...fields].sort().join(',')||legacy.schema!==1||legacy.kind!=='zola_production_release'
 ||!['releaseSha','previousMainSha','recoverySha'].every(k=>/^[a-f0-9]{40}$/.test(legacy[k]??''))||new Set([legacy.releaseSha,legacy.previousMainSha,legacy.recoverySha]).size!==3
 ||legacy.workspace!=='zola-production'||legacy.principal!=='blackspire-release-root'||legacy.preparationRoot!=='/var/lib/blackspire-operator/preparation'
 ||!fields.filter(k=>k.endsWith('File')).every(k=>protectedPath(legacy[k]))
 ||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(operationId??''))fail();
 const value=validateOwnedDatabaseProfile(profile);
 return Object.freeze({...legacy,schema:2,backendProfile:'owned-postgres-v1',profileDigest:databaseProfileDigest(value),
 sourceSecurityConfigurationFile:`/var/lib/blackspire-operator/owned-source-security/${operationId}/configuration.json`,
 ownedMigrationConfigurationFile:`/var/lib/blackspire-operator/owned-buyer-migration/${operationId}/manifest.json`});
}

export function ownedReleaseOperationId(release){
 if(release?.schema===3){
  const original='95a11ea1-289f-46a9-b5cd-cc7805497242';
  if(release.backendProfile!=='owned-postgres-v1'||release.profileDigest!=='2563185421523bf337e382a38ca389c5991406cb2adecc952048cdf5cf058505'
   ||!(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/).test(release.operationId??'')||release.operationId===original
   ||release.releaseSha==='2636a1e75cd0f422aff036dfee8a93a81cd5008b'
   ||release.sourceSecurityConfigurationFile!==`/var/lib/blackspire-operator/owned-source-security/${original}/configuration.json`
   ||release.ownedMigrationConfigurationFile!==`/var/lib/blackspire-operator/owned-buyer-migration/${original}/manifest.json`
   ||release.successorLineageFile!==`/var/lib/blackspire-operator/owned-migration-successors/${release.operationId}/plan.json`)fail();
  return release.operationId;
 }
 if(release?.schema!==2)return undefined;
 if(release.backendProfile!=='owned-postgres-v1'||!/^[a-f0-9]{64}$/.test(release.profileDigest??''))fail();
 const match=/^\/var\/lib\/blackspire-operator\/owned-source-security\/([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})\/configuration\.json$/.exec(release.sourceSecurityConfigurationFile??'');
 if(!match||release.ownedMigrationConfigurationFile!==`/var/lib/blackspire-operator/owned-buyer-migration/${match[1]}/manifest.json`)fail();return match[1];
}

// A successor names a new release operation while retaining the original data
// receipts. Its separate lineage plan must be verified before activation.
export function prepareOwnedSuccessorProductionReleaseInput({legacy,profile,operationId}){
 const value=prepareOwnedProductionReleaseInput({legacy,profile,operationId});
 const original='95a11ea1-289f-46a9-b5cd-cc7805497242';
 const successor={...value,schema:3,operationId,
  sourceSecurityConfigurationFile:`/var/lib/blackspire-operator/owned-source-security/${original}/configuration.json`,
  ownedMigrationConfigurationFile:`/var/lib/blackspire-operator/owned-buyer-migration/${original}/manifest.json`,
  successorLineageFile:`/var/lib/blackspire-operator/owned-migration-successors/${operationId}/plan.json`};
 ownedReleaseOperationId(successor);return Object.freeze(successor);
}
