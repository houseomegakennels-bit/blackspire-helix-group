import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {beginPostMergeHeldEpoch,prepareGuardedOpen,publishGuardedOpen} from '../packages/zola-release/postmerge-admission.js';
import {acquireReleaseAdmissionLock,RELEASE_ADMISSION_LOCK} from '../packages/shared/release-admission.js';
const candidateSha='a'.repeat(40),newMainSha='b'.repeat(40),d=value=>createHash('sha256').update(value).digest('hex');
function fixture(t){
 const root=fs.mkdtempSync('/root/zola-postmerge-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'admission.lock'),RELEASE_ADMISSION_LOCK,{mode:0o640});
 const old={version:1,mode:'held',releaseSha:candidateSha,runId:randomUUID(),apiGeneration:null,workerGeneration:null};
 fs.writeFileSync(path.join(root,'state.json'),JSON.stringify(old)+'\n',{mode:0o640});fs.writeFileSync(path.join(root,'pending.json'),JSON.stringify({schema:1,held:true})+'\n',{mode:0o600});
 const events=[],journal={stream:()=>({events:()=>structuredClone(events),append:row=>events.push(structuredClone(row))})};
 return{root,events,journal,commanderRunId:randomUUID(),acquire:o=>acquireReleaseAdmissionLock({...o,checkDirectory:()=>{}})};
}
function evidence(commanderRunId,epochRunId){return{commanderRunId,epochRunId,newMainSha,mainSha:newMainSha,vercelSha:newMainSha,vpsSha:newMainSha,
 artifactDigest:d('artifact'),apiGeneration:'1'.repeat(32),workerGeneration:'2'.repeat(32),n8nDigest:d('n8n'),migrationDigest:d('migration'),
 sixReadsDigest:d('reads'),rollbackDigest:d('rollback'),securitySmokeDigest:d('security'),productionSmokeDigest:d('smoke'),
 readCount:6,crossOwnerDenials:6,paidProviderCalls:0,mutationDelta:0};}
test('second HELD epoch remains closed and guarded OPEN is final, exact and idempotent',{skip:process.getuid()!==0},async t=>{
 const f=fixture(t),options={root:f.root,groupId:0,io:fs,acquire:f.acquire,stopAndVerify:async()=>{}};
 const held=await beginPostMergeHeldEpoch({commanderRunId:f.commanderRunId,candidateSha,newMainSha,journal:f.journal},options);
 assert.equal(held.status,'POST_MERGE_HELD');assert.notEqual(held.epochRunId,f.commanderRunId);
 assert.ok(fs.existsSync(path.join(f.root,'pending.json')));
 const verify=async()=>evidence(f.commanderRunId,held.epochRunId),plan=await prepareGuardedOpen({commanderRunId:f.commanderRunId,newMainSha,epochRunId:held.epochRunId,verify});
 const opened=await publishGuardedOpen({plan,journal:f.journal},{root:f.root,groupId:0,io:fs,acquire:f.acquire});
 assert.equal(opened.status,'OPEN');assert.equal(fs.existsSync(path.join(f.root,'pending.json')),false);
 const state=JSON.parse(fs.readFileSync(path.join(f.root,'state.json')));assert.equal(state.mode,'open');assert.equal(state.releaseSha,newMainSha);
 assert.equal((await publishGuardedOpen({plan,journal:f.journal},{root:f.root,groupId:0,io:fs,acquire:f.acquire})).alreadyOpen,true);
});
test('shared admission work blocks postmerge publication and bad acceptance cannot remove marker',{skip:process.getuid()!==0},async t=>{
 const f=fixture(t),marker=fs.readFileSync(path.join(f.root,'pending.json'));fs.unlinkSync(path.join(f.root,'pending.json'));
 const shared=f.acquire({root:f.root,exclusive:false,owner:0,groupId:0});fs.writeFileSync(path.join(f.root,'pending.json'),marker,{mode:0o600});
 try{await assert.rejects(beginPostMergeHeldEpoch({commanderRunId:f.commanderRunId,candidateSha,newMainSha,journal:f.journal},{root:f.root,groupId:0,io:fs,acquire:f.acquire,stopAndVerify:async()=>{}}));}
 finally{shared.close();}
 const held=await beginPostMergeHeldEpoch({commanderRunId:f.commanderRunId,candidateSha,newMainSha,journal:f.journal},{root:f.root,groupId:0,io:fs,acquire:f.acquire,stopAndVerify:async()=>{}});
 await assert.rejects(prepareGuardedOpen({commanderRunId:f.commanderRunId,newMainSha,epochRunId:held.epochRunId,verify:async()=>({...evidence(f.commanderRunId,held.epochRunId),paidProviderCalls:1})}));
 assert.ok(fs.existsSync(path.join(f.root,'pending.json')));assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'state.json'))).mode,'held');
});
