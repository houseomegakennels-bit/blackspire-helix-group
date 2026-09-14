import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {encodeBuyerWriterProvisioningJournal,writeBuyerWriterProvisioningJournal} from '../packages/buyer-writer/production-provisioning-journal.js';

const base={version:1,kind:'buyer_writer_production_provisioning',operationId:'01234567-89ab-cdef-0123-456789abcdef',
 installerSha256:'a'.repeat(64),mode:'apply',phase:'started',status:'IN_PROGRESS',updatedAt:'2026-09-14T06:00:00.000Z'};

test('provisioning journal has a closed sanitized schema',()=>{
 assert.equal(JSON.parse(encodeBuyerWriterProvisioningJournal(base)).phase,'started');
 for(const bad of [{...base,password:'secret'},{...base,error:'driver secret'},{...base,phase:'verified-committed'},
  {...base,status:'COMPLETED'},{...base,updatedAt:'invalid'},{...base,mode:'inspect'}])
  assert.throws(()=>encodeBuyerWriterProvisioningJournal(bad),/journal rejected/);
 assert.equal(JSON.parse(encodeBuyerWriterProvisioningJournal({...base,mode:'reconcile'})).mode,'reconcile');
 assert.equal(JSON.parse(encodeBuyerWriterProvisioningJournal({...base,mode:'verify'})).mode,'verify');
});

test('provisioning journal is atomically replaced as a private root file',()=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-writer-journal-'));const root=path.join(parent,'state');
 try{
  const value=writeBuyerWriterProvisioningJournal(base,{root,uid:0});
  assert.equal(value.phase,'started');
  const filename=path.join(root,'state.json'),stat=fs.lstatSync(filename);
  assert.equal(stat.mode&0o7777,0o600);assert.equal(stat.uid,0);assert.equal(stat.gid,0);assert.equal(stat.nlink,1);
  const completed={...base,phase:'verified-committed',status:'COMPLETED',updatedAt:'2026-09-14T06:01:00.000Z'};
  writeBuyerWriterProvisioningJournal(completed,{root,uid:0});
  assert.deepEqual(JSON.parse(fs.readFileSync(filename,'utf8')),completed);
  assert.deepEqual(fs.readdirSync(root),['state.json']);
 }finally{fs.rmSync(parent,{recursive:true,force:true});}
});

test('provisioning journal rejects non-root callers and unsafe roots',()=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-writer-journal-'));const root=path.join(parent,'state');
 try{
  assert.throws(()=>writeBuyerWriterProvisioningJournal(base,{root,uid:1000}),/journal rejected/);
  fs.mkdirSync(root,{mode:0o755});assert.throws(()=>writeBuyerWriterProvisioningJournal(base,{root,uid:0}),/journal rejected/);
 }finally{fs.rmSync(parent,{recursive:true,force:true});}
});
