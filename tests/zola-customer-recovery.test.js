import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
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
