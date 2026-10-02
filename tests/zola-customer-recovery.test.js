import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {customerOnboarding,selectCustomerModule} from '../packages/customer/onboarding.mjs';
import {reviewCustomerRecovery} from '../packages/customer/recovery-review.mjs';
import {backupCustomer,restoreCustomer} from '../packages/customer/backup.mjs';
import {initializeCustomer} from '../scripts/init-zola-customer.mjs';
import {configureCustomer,loadPolicy,pauseCustomer,requestReservation} from '../packages/customer/policy.mjs';
import {getCredential} from '../packages/customer/vault.mjs';
import {runCustomerChat} from '../packages/customer/runtime.mjs';
import {openLedger} from '../packages/customer/ledger.mjs';
const NOW=Date.parse('2026-10-01T18:00:00Z');
const policy=(provider='openai',patch={})=>({schemaVersion:1,provider,model:'test-model',customerBillingAccepted:true,automaticRefill:false,enabled:true,monthlyLimitMicroUsd:50000,perRequestLimitMicroUsd:20000,maxInputBytes:1000,maxOutputTokens:100,pricing:{inputMicroUsdPerMillion:1000000,outputMicroUsdPerMillion:2000000,checkedAt:new Date(NOW).toISOString(),expiresAt:new Date(NOW+86400000).toISOString()},...patch});
function fixture(t,provider='openai',patch={}){
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'zola-runtime-'));t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
 const {directory:root,installationId}=initializeCustomer({directory:path.join(parent,'customer'),origin:'https://customer.example',provider});
 configureCustomer(root,{policy:policy(provider,patch),apiKey:'test-only-'+provider+'-key'},NOW);return {root,installationId,parent};
}
const response=(provider='openai',patch={})=>new Response(JSON.stringify(provider==='openai'?{status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Hello from Zola'}]}],usage:{input_tokens:20,output_tokens:10},...patch}:{stop_reason:'end_turn',content:[{type:'text',text:'Hello from Claude'}],usage:{input_tokens:20,output_tokens:10},...patch}));
const request=()=>({requestId:randomUUID(),prompt:'Hello'});
const opts=(fetchImpl)=>({fetchImpl,clock:()=>NOW});

const passphrase='test-only-long-backup-passphrase';
test('encrypted recovery preserves receipts and credentials and blocks all paid dispatch/configuration',async t=>{
 const {root,parent,installationId}=fixture(t);await runCustomerChat(root,request(),opts(async()=>response()));pauseCustomer(root);
 const backup=path.join(parent,'backup.zola');backupCustomer(root,backup,passphrase);
 const raw=fs.readFileSync(backup);assert.ok(!raw.includes(Buffer.from('test-only-openai-key')));assert.ok(!raw.includes(Buffer.from(installationId)));
 const restored=path.join(parent,'restored');const result=restoreCustomer(backup,restored,passphrase);assert.equal(result.paused,true);assert.equal(result.recoveryHold,true);assert.equal(result.history.requests,1);assert.equal(result.history.reservedMicroUsd,4301);
 assert.equal(getCredential(restored,installationId,'openai').apiKey,'test-only-openai-key');
 let calls=0;await assert.rejects(runCustomerChat(restored,request(),opts(async()=>{calls++;return response();})),/RECOVERY_RECONCILIATION_REQUIRED/);assert.equal(calls,0);
 assert.throws(()=>configureCustomer(restored,{policy:policy(),apiKey:'replacement-test-key'},NOW),/RECOVERY_RECONCILIATION_REQUIRED/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(restored,'customer-ai.json'))).enabled,false);
});
test('wrong passphrase and tampering leave no restore directory',t=>{
 const {root,parent}=fixture(t);pauseCustomer(root);const backup=path.join(parent,'backup.zola');backupCustomer(root,backup,passphrase);
 const out=path.join(parent,'restored');assert.throws(()=>restoreCustomer(backup,out,'another-long-test-passphrase'));assert.ok(!fs.existsSync(out));
 const raw=fs.readFileSync(backup);raw[raw.length-1]^=1;fs.writeFileSync(backup,raw);assert.throws(()=>restoreCustomer(backup,out,passphrase));assert.ok(!fs.existsSync(out));
});
test('backup refuses enabled installations, weak passphrases, existing destinations and unresolved charges',async t=>{
 const {root,parent}=fixture(t);const backup=path.join(parent,'backup.zola');assert.throws(()=>backupCustomer(root,backup,passphrase),/PAUSE_BEFORE_BACKUP/);
 pauseCustomer(root);assert.throws(()=>backupCustomer(root,backup,'short'),/BACKUP_PASSPHRASE_REQUIRED/);assert.ok(!fs.existsSync(backup));
 backupCustomer(root,backup,passphrase);const before=fs.readFileSync(backup);assert.throws(()=>backupCustomer(root,backup,passphrase));assert.deepEqual(fs.readFileSync(backup),before);
 assert.throws(()=>restoreCustomer(backup,root,passphrase),/FRESH_DESTINATION_REQUIRED/);
 configureCustomer(root,{policy:policy(),apiKey:'test-only-openai-key'},NOW);
 await assert.rejects(runCustomerChat(root,request(),opts(async()=>{throw Error('network');})));pauseCustomer(root);
 assert.throws(()=>backupCustomer(root,path.join(parent,'unknown.zola'),passphrase),/RECONCILE_BEFORE_BACKUP/);
});
test('in-flight dispatch holds maintenance lock until its receipt is recorded',async t=>{
 const {root,parent}=fixture(t);let release,started;const ready=new Promise(r=>started=r);const wait=new Promise(r=>release=r);
 const running=runCustomerChat(root,request(),opts(async()=>{started();await wait;return response();}));await ready;
 assert.throws(()=>pauseCustomer(root));assert.throws(()=>backupCustomer(root,path.join(parent,'busy.zola'),passphrase));
 release();await running;pauseCustomer(root);backupCustomer(root,path.join(parent,'idle.zola'),passphrase);
});
test('stale lock and symlinked recovery hold fail closed',async t=>{
 const {root}=fixture(t);fs.mkdirSync(path.join(root,'.configuration-lock'));await assert.rejects(runCustomerChat(root,request(),opts(async()=>response())));fs.rmdirSync(path.join(root,'.configuration-lock'));
 fs.symlinkSync('/nonexistent',path.join(root,'recovery-hold.json'));await assert.rejects(runCustomerChat(root,request(),opts(async()=>response())),/RECOVERY_RECONCILIATION_REQUIRED/);
});

test('recovery review exposes required steps without secrets or receipt mutation',async t=>{
 const {root,parent}=fixture(t);await runCustomerChat(root,request(),opts(async()=>response()));pauseCustomer(root);
 const backup=path.join(parent,'review.enc');backupCustomer(root,backup,passphrase);const out=path.join(parent,'review');restoreCustomer(backup,out,passphrase);
 const db=path.join(out,'data/customer-ai.sqlite'),before=fs.readFileSync(db);const report=reviewCustomerRecovery(out,NOW+10*86400000);
 assert.equal(report.enabled,false);assert.equal(report.pricingCurrent,false);assert.ok(report.blockers.includes('recovery_hold'));assert.equal(report.budget.totalRequests,1);assert.equal(report.budget.months[0].reservedMicroUsd,4301);assert.equal(report.admissionVerified,false);
 assert.ok(report.nextSteps.some(x=>x.includes('Retire')));assert.deepEqual(fs.readFileSync(db),before);
 const text=JSON.stringify(report);for(const secret of ['test-only-openai-key','Hello from Zola','fingerprint','master.key'])assert.ok(!text.includes(secret));
});
test('status review does not create a missing ledger or claim provider verification',t=>{
 const {root}=fixture(t);const file=path.join(root,'data/customer-ai.sqlite');assert.ok(!fs.existsSync(file));
 const report=reviewCustomerRecovery(root,NOW);assert.equal(report.budget.state,'not_created');assert.equal(report.admissionVerified,false);assert.ok(!fs.existsSync(file));
});
test('review lists unresolved receipts without their answer or fingerprint',async t=>{
 const {root}=fixture(t);const req=request();await assert.rejects(runCustomerChat(root,req,opts(async()=>{throw Error('test failure');})));
 const report=reviewCustomerRecovery(root,NOW);assert.equal(report.budget.unresolvedCount,1);assert.equal(report.budget.unresolved[0].requestId,req.requestId);assert.equal(report.budget.unresolved[0].state,'unknown');assert.ok(report.blockers.includes('unresolved_requests'));
});
test('review rejects identity mismatch, unsafe ledger and invalid hold',t=>{
 const {root,installationId}=fixture(t);const ledger=openLedger(root,installationId);ledger.close();const file=path.join(root,'data/customer-ai.sqlite');
 fs.chmodSync(file,0o644);assert.throws(()=>reviewCustomerRecovery(root,NOW));fs.chmodSync(file,0o600);
 fs.writeFileSync(path.join(root,'recovery-hold.json'),JSON.stringify({schemaVersion:1,installationId:'wrong'}),{mode:0o600});assert.throws(()=>reviewCustomerRecovery(root,NOW),/RECOVERY_HOLD_INVALID/);
});

test('onboarding choices never enable modules or modify spending and credentials',t=>{
 const {root}=fixture(t);const files=['installation.json','customer-ai.json','secrets/openai.encrypted.json'];const before=files.map(n=>fs.readFileSync(path.join(root,n)));
 for(const choice of ['create','connect','skip'])selectCustomerModule(root,{module:'social',choice});
 const status=customerOnboarding(root);assert.equal(status.modules.find(x=>x.id==='social').choice,'skip');assert.equal(status.fullOsReady,false);assert.equal(status.costs.fullImplementationTotal,null);assert.equal(status.usesBlackspireAccounts,false);
 files.forEach((n,i)=>assert.deepEqual(fs.readFileSync(path.join(root,n)),before[i]));
});
test('fresh customer can skip all optional accounts without credentials',t=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'zola-checklist-'));t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));const root=path.join(parent,'new');initializeCustomer({directory:root,origin:'https://customer.example'});
 for(const module of ['cloudAi','voice','telegram','social'])selectCustomerModule(root,{module,choice:'skip'});
 const result=customerOnboarding(root);assert.ok(result.modules.every(x=>x.choice==='skip'));assert.equal(result.aiProvider,'none');assert.ok(!fs.existsSync(path.join(root,'customer-ai.json')));
});
test('onboarding refuses unsupported modules, extra credential fields and cross-installation preferences',t=>{
 const {root}=fixture(t);assert.throws(()=>selectCustomerModule(root,{module:'unknown',choice:'create'}));assert.throws(()=>selectCustomerModule(root,{module:'social',choice:'connect',apiKey:'do-not-store'}));
 fs.writeFileSync(path.join(root,'onboarding.json'),JSON.stringify({schemaVersion:1,installationId:'wrong',choices:{}}),{mode:0o600});assert.throws(()=>customerOnboarding(root),/ONBOARDING_INVALID/);
});
test('onboarding preferences survive encrypted backup without enabling recovered execution',t=>{
 const {root,parent}=fixture(t);selectCustomerModule(root,{module:'telegram',choice:'create'});pauseCustomer(root);const backup=path.join(parent,'onboarding.enc');backupCustomer(root,backup,passphrase);const out=path.join(parent,'restored-onboarding');restoreCustomer(backup,out,passphrase);
 assert.equal(customerOnboarding(out).modules.find(x=>x.id==='telegram').choice,'create');assert.ok(reviewCustomerRecovery(out,NOW).recoveryHold);
});
