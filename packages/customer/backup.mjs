import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,scryptSync,createCipheriv,createDecipheriv,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {loadCustomerInstallation} from '../shared/customer-installation.js';
import {openLedger} from './ledger.mjs';
import {getCredential} from './vault.mjs';
import {exclusive,privateDirectory,readPrivate,atomicPrivate,fail,assertNoRecoveryHold} from './private-files.mjs';
const REQUIRED=['installation.json','customer-ai.json','secrets/providers.json','secrets/master.key','data/customer-ai.sqlite'];
const OPTIONAL=['secrets/openai.encrypted.json','secrets/anthropic.encrypted.json'];
const MAX=100*1024*1024;
const AAD=Buffer.from('zola-customer-backup-v1');
function key(passphrase,salt){if(typeof passphrase!=='string'||passphrase.length<16||Buffer.byteLength(passphrase)>1024)fail('BACKUP_PASSPHRASE_REQUIRED');return scryptSync(passphrase,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});}
function saveNew(file,data){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,data);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
export function backupCustomer(root,output,passphrase){
 privateDirectory(root);if(!path.isAbsolute(output))fail('ABSOLUTE_BACKUP_PATH_REQUIRED');privateDirectory(path.dirname(output));
 return exclusive(root,()=>{
  assertNoRecoveryHold(root);const {manifest}=loadCustomerInstallation(root);
  const policy=JSON.parse(readPrivate(path.join(root,'customer-ai.json')));
  if(policy.installationId!==manifest.installationId||policy.enabled!==false)fail('PAUSE_BEFORE_BACKUP');
  const ledger=openLedger(root,manifest.installationId);try{if(ledger.summary().unresolved)fail('RECONCILE_BEFORE_BACKUP');}finally{ledger.close();}
  // All dispatch/configuration operations share the lock. VACUUM also gives a consistent SQLite snapshot.
  const snapshot=path.join(root,'data','.snapshot-'+randomUUID());
  let db;const files={};
  try{db=new DatabaseSync(path.join(root,'data/customer-ai.sqlite'));db.prepare('VACUUM INTO ?').run(snapshot);db.close();db=null;fs.chmodSync(snapshot,0o600);
   for(const name of [...REQUIRED,...OPTIONAL]){const file=name==='data/customer-ai.sqlite'?snapshot:path.join(root,name);if(OPTIONAL.includes(name)&&!fs.existsSync(file))continue;files[name]=readPrivate(file,64*1024*1024).toString('base64');}
  }finally{db?.close();fs.rmSync(snapshot,{force:true});}
  const payload=Buffer.from(JSON.stringify({version:1,installationId:manifest.installationId,createdAt:new Date().toISOString(),files}));if(payload.length>MAX)fail('BACKUP_TOO_LARGE');
  const salt=randomBytes(16),iv=randomBytes(12),derived=key(passphrase,salt);
  try{const cipher=createCipheriv('aes-256-gcm',derived,iv);cipher.setAAD(AAD);const ciphertext=Buffer.concat([cipher.update(payload),cipher.final()]);saveNew(output,Buffer.concat([AAD,salt,iv,cipher.getAuthTag(),ciphertext]));}finally{derived.fill(0);payload.fill(0);}
  return {backup:output,encrypted:true,scope:'customer-text-cli',restoresPaused:true};
 });
}
export function restoreCustomer(backup,destination,passphrase){
 if(!path.isAbsolute(destination))fail('ABSOLUTE_DESTINATION_REQUIRED');
 const parent=fs.realpathSync(path.dirname(destination));privateDirectory(parent);const target=path.join(parent,path.basename(destination));
 if(fs.existsSync(target))fail('FRESH_DESTINATION_REQUIRED');
 const raw=readPrivate(backup,MAX+128),offset=AAD.length;
 if(!raw.subarray(0,offset).equals(AAD)||raw.length<offset+44)fail('BACKUP_INVALID');
 const derived=key(passphrase,raw.subarray(offset,offset+16));let payload;
 try{const decipher=createDecipheriv('aes-256-gcm',derived,raw.subarray(offset+16,offset+28));decipher.setAAD(AAD);decipher.setAuthTag(raw.subarray(offset+28,offset+44));const clear=Buffer.concat([decipher.update(raw.subarray(offset+44)),decipher.final()]);try{payload=JSON.parse(clear);}finally{clear.fill(0);}}finally{derived.fill(0);}
 if(payload?.version!==1||!payload.files||typeof payload.files!=='object'||Object.keys(payload.files).some(n=>![...REQUIRED,...OPTIONAL].includes(n))||REQUIRED.some(n=>typeof payload.files[n]!=='string'))fail('BACKUP_CONTENT_INVALID');
 const stage=fs.mkdtempSync(path.join(parent,'.zola-restore-'));fs.chmodSync(stage,0o700);
 try{
  for(const dir of ['data','secrets','backups'])fs.mkdirSync(path.join(stage,dir),{mode:0o700});
  for(const [name,value] of Object.entries(payload.files)){if(typeof value!=='string'||! /^[A-Za-z0-9+/]*={0,2}$/.test(value))fail('BACKUP_CONTENT_INVALID');saveNew(path.join(stage,name),Buffer.from(value,'base64'));}
  const {manifest}=loadCustomerInstallation(stage);if(manifest.installationId!==payload.installationId)fail('BACKUP_IDENTITY_MISMATCH');
  const policy=JSON.parse(readPrivate(path.join(stage,'customer-ai.json')));if(policy.installationId!==manifest.installationId||policy.provider!==manifest.ai.provider)fail('BACKUP_IDENTITY_MISMATCH');
  getCredential(stage,manifest.installationId,policy.provider);
  const db=new DatabaseSync(path.join(stage,'data/customer-ai.sqlite'));try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')fail('BACKUP_LEDGER_INVALID');}finally{db.close();}
  const ledger=openLedger(stage,manifest.installationId);let history;try{history=ledger.summary();if(history.unresolved)fail('BACKUP_LEDGER_UNRESOLVED');}finally{ledger.close();}
  atomicPrivate(path.join(stage,'customer-ai.json'),JSON.stringify({...policy,enabled:false},null,2)+'\n');
  atomicPrivate(path.join(stage,'recovery-hold.json'),JSON.stringify({schemaVersion:1,installationId:manifest.installationId,backupCreatedAt:payload.createdAt,restoredAt:new Date().toISOString(),reason:'Reconcile provider charges and receipts since this snapshot; retire the original installation before admitting paid requests.',automaticRelease:false},null,2)+'\n');
  // Reserve the destination exclusively; never replace an existing installation, even after a race.
  fs.mkdirSync(target,{mode:0o700});
  fs.renameSync(path.join(stage,'recovery-hold.json'),path.join(target,'recovery-hold.json'));
  for(const name of fs.readdirSync(stage))fs.renameSync(path.join(stage,name),path.join(target,name));
  return {directory:target,installationId:manifest.installationId,paused:true,recoveryHold:true,history};
 }finally{fs.rmSync(stage,{recursive:true,force:true});}
}
