import test from 'node:test';
import assert from 'node:assert/strict';
import {ownedReleaseOperationId} from '../packages/zola-release/owned-release-input-preparation.js';
import {ownedReleasePrerequisiteInput,ownedReleasePrerequisiteStatus} from '../packages/zola-release/owned-release-prerequisites.js';
const original='95a11ea1-289f-46a9-b5cd-cc7805497242',operationId='11111111-1111-4111-8111-111111111111';
const release=()=>({schema:3,releaseSha:'a'.repeat(40),operationId,backendProfile:'owned-postgres-v1',profileDigest:'2563185421523bf337e382a38ca389c5991406cb2adecc952048cdf5cf058505',
 sourceSecurityConfigurationFile:`/var/lib/blackspire-operator/owned-source-security/${original}/configuration.json`,ownedMigrationConfigurationFile:`/var/lib/blackspire-operator/owned-buyer-migration/${original}/manifest.json`,successorLineageFile:`/var/lib/blackspire-operator/owned-migration-successors/${operationId}/plan.json`});
test('successor operation stays distinct from preserved original receipt paths',()=>{
 const v=release();assert.equal(ownedReleaseOperationId(v),operationId);assert.equal(ownedReleasePrerequisiteStatus(v),'OWNED_MIGRATION_SUCCESSOR_VERIFIED');
 const input=ownedReleasePrerequisiteInput(v,operationId);assert.equal(input.operationId,operationId);assert.equal(input.sourceSecurityConfigurationFile,v.sourceSecurityConfigurationFile);assert.equal(input.successorLineageFile,v.successorLineageFile);
 assert.throws(()=>ownedReleasePrerequisiteInput(v,original));
});
test('successor refuses rebadged or foreign source, cluster, operation and lineage',()=>{
 const v=release();for(const patch of [{operationId:original},{operationId:'bad'},{releaseSha:'2636a1e75cd0f422aff036dfee8a93a81cd5008b'},{profileDigest:'b'.repeat(64)},{backendProfile:'supabase'},
 {sourceSecurityConfigurationFile:v.sourceSecurityConfigurationFile.replace(original,operationId)},{ownedMigrationConfigurationFile:v.ownedMigrationConfigurationFile.replace(original,operationId)},
 {successorLineageFile:v.successorLineageFile.replace(operationId,original)},{successorLineageFile:v.successorLineageFile.replace('/plan.json','/../plan.json')}])assert.throws(()=>ownedReleaseOperationId({...v,...patch}));
});
test('original schema retains its original operation and proof status',()=>{
 const v=release();delete v.operationId;delete v.successorLineageFile;v.schema=2;assert.equal(ownedReleaseOperationId(v),original);assert.equal(ownedReleasePrerequisiteStatus(v),'OWNED_MIGRATION_PREREQUISITES_VERIFIED');
});
