import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {claimBuyerMigrationIntent,openBuyerMigrationEvidence,appendBuyerMigrationEvidence} from '../packages/buyer-writer/migration-journal.js';

const plan={releaseSha:'a'.repeat(40),migrationVersion:'20260908000000',bodySha256:'b'.repeat(64),manifestSha256:'c'.repeat(64)};
const parent='/var/lib/blackspire-operator/preparation';
const hostReady=process.getuid?.()===0&&fs.existsSync(parent);
test('durable migration intent refuses replay across process restart and new evidence names',{skip:!hostReady},()=>{
 const root=fs.mkdtempSync(path.join(parent,'migration-journal-test-'));
 try{
  const operations=path.join(root,'operations');
  const intent=claimBuyerMigrationIntent(plan,{root:operations});
  const original=fs.readFileSync(intent);
  const script=`import {claimBuyerMigrationIntent} from ${JSON.stringify(new URL('../packages/buyer-writer/migration-journal.js',import.meta.url).href)};try{claimBuyerMigrationIntent(JSON.parse(process.argv[1]),{root:process.argv[2]});process.exitCode=99;}catch{process.exitCode=17;}`;
  const restarted=spawnSync(process.execPath,['--input-type=module','-e',script,JSON.stringify(plan),operations],{encoding:'utf8',timeout:5000,env:{PATH:'/usr/bin:/bin'}});
  assert.equal(restarted.status,17);assert.deepEqual(fs.readFileSync(intent),original);
  for(const name of ['one.jsonl','different.jsonl']){
   const fd=openBuyerMigrationEvidence(path.join(root,name));
   try{appendBuyerMigrationEvidence(fd,{status:'intent-recorded'});}finally{fs.closeSync(fd);}
   assert.throws(()=>claimBuyerMigrationIntent(plan,{root:operations}),/reconcile only/);
  }
  assert.equal(fs.statSync(intent).mode&0o777,0o600);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('append evidence retains prior durable records after partial later write and collision',{skip:!hostReady},()=>{
 const root=fs.mkdtempSync(path.join(parent,'migration-evidence-test-'));
 try{
  const evidence=path.join(root,'dry-run.jsonl'),fd=openBuyerMigrationEvidence(evidence);
  appendBuyerMigrationEvidence(fd,{status:'intent-recorded'});
  appendBuyerMigrationEvidence(fd,{status:'validated-no-connection'});
  fs.writeSync(fd,'{"status":');fs.fsyncSync(fd);fs.closeSync(fd);
  const lines=fs.readFileSync(evidence,'utf8').split('\n');
  assert.equal(JSON.parse(lines[0]).status,'intent-recorded');assert.equal(JSON.parse(lines[1]).status,'validated-no-connection');
  assert.throws(()=>openBuyerMigrationEvidence(evidence),/unavailable/);
  assert.ok(claimBuyerMigrationIntent(plan,{root:path.join(root,'operations')}));
  const symlink=path.join(root,'linked');fs.symlinkSync(evidence,symlink);
  assert.throws(()=>openBuyerMigrationEvidence(symlink),/unavailable/);
  const unsafe=path.join(root,'unsafe');fs.mkdirSync(unsafe,{mode:0o777});fs.chmodSync(unsafe,0o777);
  assert.throws(()=>claimBuyerMigrationIntent(plan,{root:unsafe}),/unavailable/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
