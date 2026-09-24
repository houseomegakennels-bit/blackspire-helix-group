import test from 'node:test';import assert from 'node:assert/strict';
import {MIXED_RETIREMENT as P} from '../packages/zola-release/mixed-retirement-history.js';
import {buildMixedLiveConfiguration} from '../packages/zola-release/mixed-live-preparation.js';
const oldRun='11111111-1111-4111-8111-111111111111',runId='22222222-2222-4222-8222-222222222222',newMainSha='c'.repeat(40);
const premerge={version:6,releaseSha:P.successorReleaseSha,frontendOrigin:'https://fixture.vercel.app',workspace:'blackspire-command',principal:'blackspire-operator',deniedPrincipal:'zola-denied',dealId:'DE-0001',apiPid:101,workerPid:102,port:8789,databasePath:'/fixture/db.sqlite',credentialPath:'/fixture/session.json',journalDirectory:'/fixture/journal',runId:oldRun,observerDatabaseConfigPath:'/etc/blackspire-buyer-writer-gateway/management.json',denialReceiptPath:'/fixture/denial.json',backendProfile:'owned-postgres-v1',profileDigest:P.profileDigest,ownedObserverDatabaseConfigPath:'/etc/blackspire/owned-postgres/management.json',acceptanceSearchJobId:oldRun};
const lifecycle={releaseSha:newMainSha,runId,api:{pid:103},worker:{pid:104}};
const target={schema:1,kind:'zola_owned_bounded_writer_acceptance_target',backendProfile:'owned-postgres-v1',profileDigest:P.profileDigest,releaseSha:newMainSha,workspace:'blackspire-command',principal:'blackspire-release-root',capability:'buyer.writer.acceptance',jobId:'33333333-3333-4333-8333-333333333333',ownerId:'44444444-4444-4444-8444-444444444444',criteria:{state:'FL',county:'Zola Acceptance',property_type:'acceptance',date_range_start:'2026-01-01',date_range_end:'2026-01-02',min_purchases:1,cash_buyers_only:false,llc_buyers_only:false},updatedAt:'2026-09-21T00:00:00.000000Z'};
const input=()=>structuredClone({premerge,newMainSha,runId,lifecycle,target});
test('live preparation selects production with fresh merged lifecycle and exact owned target',()=>{
 const config=buildMixedLiveConfiguration(input());
 assert.equal(config.version,7);assert.equal(config.releaseSha,newMainSha);assert.equal(config.runId,runId);assert.equal(config.releaseRunId,runId);
 assert.equal(config.frontendOrigin,'https://blackspirehelix.com');assert.equal(config.apiPid,103);assert.equal(config.workerPid,104);
 assert.equal(config.acceptanceSearchJobId,target.jobId);assert.equal(config.credentialPath,premerge.credentialPath);
 assert.notEqual(config.journalDirectory,premerge.journalDirectory);assert.notEqual(config.denialReceiptPath,premerge.denialReceiptPath);
 assert.equal(Object.hasOwn(config,'ownerId'),false);
});
for(const [name,change]of [
 ['old candidate',v=>v.premerge.releaseSha=P.releaseSha],
 ['old profile',v=>v.premerge.profileDigest='f'.repeat(64)],
 ['unmerged candidate',v=>v.newMainSha=P.successorReleaseSha],
 ['reused premerge epoch',v=>v.runId=oldRun],
 ['reused unknown epoch',v=>v.runId=P.runId],
 ['lifecycle mismatch',v=>v.lifecycle.runId=oldRun],
 ['duplicate processes',v=>v.lifecycle.worker.pid=v.lifecycle.api.pid],
 ['wrong target release',v=>v.target.releaseSha=P.successorReleaseSha],
 ['wrong target profile',v=>v.target.profileDigest='f'.repeat(64)],
 ['customer search target',v=>v.target.criteria.county='Customer']
])test('live preparation refuses '+name,()=>{const v=input();change(v);assert.throws(()=>buildMixedLiveConfiguration(v));});
