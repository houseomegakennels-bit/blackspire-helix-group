import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptanceTargetSelection,matchesAcceptanceTargetBackend,OWNED_WRITER_ACCEPTANCE_TARGET,LEGACY_WRITER_ACCEPTANCE_TARGET} from '../packages/buyer-writer/acceptance-target-backend.js';
import {inspectFixedWriterAcceptance} from '../packages/zola-release/production-acl-writer.js';
const digest='a'.repeat(64),connection={host:'127.0.0.1',port:55432,database:'postgres',backendProfile:'owned-postgres-v1',profileDigest:digest};
test('owned selection fixes separate path and rejects fallback or cross-profile target',()=>{
 const selection=acceptanceTargetSelection(connection);assert.equal(selection.file,OWNED_WRITER_ACCEPTANCE_TARGET);
 assert.equal(matchesAcceptanceTargetBackend({kind:selection.kind,backendProfile:selection.backendProfile,profileDigest:digest},selection),true);
 for(const value of [{kind:'zola_bounded_writer_acceptance_target'},{kind:selection.kind,backendProfile:selection.backendProfile,profileDigest:'b'.repeat(64)}])assert.equal(matchesAcceptanceTargetBackend(value,selection),false);
 for(const changed of [{host:'db.kchtrvfcixnimvxxctkj.supabase.co'},{port:5432},{profileDigest:undefined},{backendProfile:undefined}])assert.throws(()=>acceptanceTargetSelection({...connection,...changed}));
 assert.equal(acceptanceTargetSelection({host:'db.kchtrvfcixnimvxxctkj.supabase.co',port:5432,database:'postgres'}).file,LEGACY_WRITER_ACCEPTANCE_TARGET);
});
test('fixed writer reads owned target and denies wrong backend before opening admitted transport',async()=>{
 const selection=acceptanceTargetSelection(connection),releaseSha='a'.repeat(40),principal='blackspire-release-root';let opened=0;
 const value={schema:1,kind:selection.kind,backendProfile:selection.backendProfile,profileDigest:digest,releaseSha,workspace:'blackspire-command',principal,capability:'buyer.writer.acceptance',jobId:'11111111-1111-4111-8111-111111111111',ownerId:'22222222-2222-4222-8222-222222222222',criteria:{state:'NC',county:'Zola Acceptance',property_type:'acceptance',date_range_start:'2026-01-01',date_range_end:'2026-01-02',min_purchases:1,cash_buyers_only:false,llc_buyers_only:false},updatedAt:'2026-09-21T00:00:00.123456Z'};
 const bound={releaseSha,principal,workspace:'zola-production',operationId:'33333333-3333-4333-8333-333333333333',attemptId:null};
 const host={groupId:0,resolveAcceptanceBackend:async()=>selection,readAcceptanceSnapshot:file=>{assert.equal(file,OWNED_WRITER_ACCEPTANCE_TARGET);return {value,identity:{}};},openAdmittedClient:async()=>{opened++;throw new Error('fixture unavailable');}};
 await assert.rejects(inspectFixedWriterAcceptance(bound,host),/fixture unavailable/);assert.equal(opened,1);
 value.profileDigest='b'.repeat(64);await assert.rejects(inspectFixedWriterAcceptance(bound,host));assert.equal(opened,1);
 value.profileDigest=digest;value.kind='zola_bounded_writer_acceptance_target';await assert.rejects(inspectFixedWriterAcceptance(bound,host));assert.equal(opened,1);
});
