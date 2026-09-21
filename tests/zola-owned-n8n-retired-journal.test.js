import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {hash} from '../packages/zola-release/commander-journal.js';
import {BLOCKED_RELEASE} from '../packages/zola-release/retired-release-history.js';
import {retireBlockedRelease} from '../packages/zola-release/blocked-release-retirement.js';
import {RELEASE_STAGES,runReleaseSequence} from '../packages/zola-release/commander-sequence.js';
import {OWNED_POSTGRES_TARGET,ownedPostgresProfileDigest} from '../packages/buyer-writer/owned-postgres.js';
import {createOwnedN8nRetiredJournalView} from '../packages/zola-release/owned-n8n-retired-journal.js';
const load=n=>JSON.parse(fs.readFileSync(new URL('./fixtures/zola-release/'+n,import.meta.url)));
async function fixture(){
 const rows=load('retired-release-7bd.json'),workflow=load('retired-release-n8n.json'),before=JSON.stringify(workflow);
 const profile={version:1,...OWNED_POSTGRES_TARGET,creatorOid:16384,systemIdentifier:'1234567890123456789',caSha256:'b'.repeat(64)};
 const releaseSha='a'.repeat(40),operationId=randomUUID(),profileDigest=ownedPostgresProfileDigest(profile);
 const release={schema:2,releaseSha,backendProfile:'owned-postgres-v1',profileDigest,sourceSecurityConfigurationFile:`/var/lib/blackspire-operator/owned-source-security/${operationId}/configuration.json`,ownedMigrationConfigurationFile:`/var/lib/blackspire-operator/owned-buyer-migration/${operationId}/manifest.json`};
 const journal={stream:name=>({events:()=>structuredClone(name==='n8n'?workflow:rows),append:e=>(name==='n8n'?workflow:rows).push(structuredClone(e))})};
 await retireBlockedRelease({successorReleaseSha:releaseSha,journal},{uid:0,verifySource:async()=>{},readProfile:()=>profile,now:()=>100000,retain:()=>{},observeHost:()=>({hostStopped:true,currentSha:BLOCKED_RELEASE.currentSha,admissionAbsent:true,provisioningDigest:BLOCKED_RELEASE.provisioningDigest}),observeDatabase:async()=>({rolesAbsent:true,providerAclDigest:'c'.repeat(64)})});
 const input={releaseSha,previousMainSha:BLOCKED_RELEASE.previousMainSha,recoverySha:BLOCKED_RELEASE.recoverySha,protectedInputDigest:'d'.repeat(64),workspace:'zola-production',principal:'blackspire-release-root'};input.inputDigest=hash(input);
 await runReleaseSequence({input,journal,requestedOperationId:operationId,adapters:Object.fromEntries(RELEASE_STAGES.map(stage=>[stage,{check:async()=>({status:'BLOCKED_EXTERNAL'})}]))});
 const plan={releaseSha,namespace:'e'.repeat(64),baselineDigest:workflow[0].state.definitionDigest,baselineVersion:workflow[0].state.versionId};
 return {journal,release,plan,rows,workflow,before};
}
test('exact retired read-only prefix is hidden logically, preserved physically, and current append stays on original stream',async()=>{
 const f=await fixture(),v=createOwnedN8nRetiredJournalView(f);assert.deepEqual(v.stream('n8n').events(),[]);
 const event={type:'observation',namespace:f.plan.namespace,releaseSha:f.release.releaseSha,state:structuredClone(f.workflow[0].state)};
 v.stream('n8n').append(event);assert.equal(f.workflow.length,7);assert.equal(JSON.stringify(f.workflow.slice(0,6)),f.before);assert.deepEqual(v.stream('n8n').events(),[event]);
 assert.deepEqual(v.stream('release').events(),f.rows);
});
test('unknown prefixes, mutation substitution, absent retirement and wrong successor/profile/operation fail closed',async()=>{
 for(const mutate of [f=>{f.workflow[0].namespace='f'.repeat(64);},f=>{f.workflow[0].type='intent';},f=>{f.workflow.shift();},f=>{f.rows.splice(68,1);},f=>{f.release.profileDigest='f'.repeat(64);},f=>{f.release.releaseSha='f'.repeat(40);},f=>{const op=randomUUID();f.release.sourceSecurityConfigurationFile=`/var/lib/blackspire-operator/owned-source-security/${op}/configuration.json`;f.release.ownedMigrationConfigurationFile=`/var/lib/blackspire-operator/owned-buyer-migration/${op}/manifest.json`;}]){
  const f=await fixture();mutate(f);assert.throws(()=>createOwnedN8nRetiredJournalView(f));
 }
});
test('post-open prefix drift and arbitrary current namespace or unbound mutation never append',async()=>{
 const f=await fixture(),v=createOwnedN8nRetiredJournalView(f),event={type:'observation',namespace:f.plan.namespace,releaseSha:f.release.releaseSha,state:structuredClone(f.workflow[0].state)};
 assert.throws(()=>v.stream('n8n').append({...event,namespace:'f'.repeat(64)}));
 assert.throws(()=>v.stream('n8n').append({...event,type:'confirmed',operation:'deactivate',operationId:randomUUID(),stageAttemptId:randomUUID()}));assert.equal(f.workflow.length,6);
 f.workflow[0].state.active=false;assert.throws(()=>v.stream('n8n').events());assert.throws(()=>v.stream('n8n').append(event));assert.equal(f.workflow.length,6);
});
