import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {openReleaseJournal,recoverReleaseJournalLock,hash} from '../packages/zola-release/commander-journal.js';
import {verifyReleaseCi} from '../packages/zola-release/commander-host.js';

const rootTest={skip:process.getuid?.()!==0};
function directory(t){const root=fs.mkdtempSync('/root/.zola-release-journal-test-');fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('actual protected journal serializes all operations and preserves intent across reopen',rootTest,t=>{
 const root=directory(t),first=openReleaseJournal({root});
 first.append({type:'intent',operation:'deactivate'});
 assert.throws(()=>openReleaseJournal({root}),/journal rejected/);
 first.close();const second=openReleaseJournal({root});assert.deepEqual(second.events(),[{type:'intent',operation:'deactivate'}]);second.close();
 assert.equal(fs.statSync(path.join(root,'n8n.jsonl')).mode&0o777,0o600);
});
test('actual process death retains global lock; torn journal and aliases reject without destroying evidence',rootTest,t=>{
 const root=directory(t),module=fileURLToPath(new URL('../packages/zola-release/commander-journal.js',import.meta.url));
 const code=`import {openReleaseJournal} from ${JSON.stringify(module)}; const j=openReleaseJournal({root:${JSON.stringify(root)}});j.append({type:'intent',operation:'update'});process.exit(0);`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',code],{env:{PATH:'/usr/bin:/bin'},encoding:'utf8',timeout:5000});
 assert.equal(result.status,0);assert.throws(()=>openReleaseJournal({root}),/journal rejected/);
 const saved=fs.readFileSync(path.join(root,'n8n.jsonl'),'utf8');assert.ok(saved.includes('intent'));
 // The isolated child has exited synchronously; only its test-owned lock is removed.
 fs.unlinkSync(path.join(root,'commander.lock'));fs.appendFileSync(path.join(root,'n8n.jsonl'),'partial');
 assert.throws(()=>openReleaseJournal({root}),/journal rejected/);assert.ok(fs.existsSync(path.join(root,'commander.lock')));
 assert.equal(fs.readFileSync(path.join(root,'n8n.jsonl'),'utf8'),saved+'partial');
});
test('exact-head CI verifier rejects newest failed or wrong-PR evidence and stale runs',()=>{
 const releaseSha='a'.repeat(40),repository='houseomegakennels-bit/blackspire-helix-group',now=Date.now();
 const pr={number:125,state:'open',merged:false,draft:false,head:{sha:releaseSha,ref:'release/zola-production-live',repo:{full_name:repository}},base:{sha:'b'.repeat(40),ref:'main',repo:{full_name:repository}}};
 const ci={id:123,path:'.github/workflows/blackspire-ci.yml',head_sha:releaseSha,event:'pull_request',status:'completed',conclusion:'success',pull_requests:[{number:125,head:{sha:releaseSha},base:{sha:'b'.repeat(40)}}],updated_at:new Date(now).toISOString()};
 const run=(_exe,args)=>JSON.stringify(args[1].endsWith('pulls/125')?pr:{workflow_runs:[ci]});
 assert.equal(verifyReleaseCi(releaseSha,{run,now}).runId,123);
 ci.conclusion='failure';assert.throws(()=>verifyReleaseCi(releaseSha,{run,now}));ci.conclusion='success';
 ci.pull_requests=[{number:126}];assert.throws(()=>verifyReleaseCi(releaseSha,{run,now}));ci.pull_requests=[{number:125,head:{sha:releaseSha},base:{sha:'b'.repeat(40)}}];
 delete pr.base.sha;delete ci.pull_requests[0].base.sha;assert.throws(()=>verifyReleaseCi(releaseSha,{run,now}));pr.base.sha='b'.repeat(40);ci.pull_requests[0].base.sha='b'.repeat(40);
 ci.pull_requests[0].base.sha='c'.repeat(40);assert.throws(()=>verifyReleaseCi(releaseSha,{run,now}));ci.pull_requests[0].base.sha='b'.repeat(40);
 ci.updated_at=new Date(now-25*60*60*1000).toISOString();assert.throws(()=>verifyReleaseCi(releaseSha,{run,now}));
});

test('GET-only dead-owner recovery retains lock bytes; live owner cannot be recovered',rootTest,t=>{
 const root=directory(t),journal=openReleaseJournal({root});
 assert.throws(()=>recoverReleaseJournalLock({root}),/journal rejected/);journal.close();
 const module=fileURLToPath(new URL('../packages/zola-release/commander-journal.js',import.meta.url));
 const code=`import {openReleaseJournal} from ${JSON.stringify(module)};const j=openReleaseJournal({root:${JSON.stringify(root)}});j.append({type:'intent',operation:'publish'});process.exit(0);`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',code],{env:{PATH:'/usr/bin:/bin'},encoding:'utf8',timeout:5000});assert.equal(result.status,0);
 const original=fs.readFileSync(path.join(root,'commander.lock'));
 const recovered=recoverReleaseJournalLock({root});assert.equal(recovered.recovered,true);
 const retained=path.join(root,`commander.lock.retained-${recovered.retainedDigest}`);
 assert.deepEqual(fs.readFileSync(retained),original);assert.equal(fs.statSync(retained).mode&0o777,0o400);
 const reopened=openReleaseJournal({root});assert.equal(reopened.events()[0].operation,'publish');reopened.close();
});

test('dead-owner recovery resumes its exact retained hard-link crash window',rootTest,t=>{
 for(const mode of [0o600,0o400]){
  const root=directory(t),module=fileURLToPath(new URL('../packages/zola-release/commander-journal.js',import.meta.url));
  const code=`import {openReleaseJournal} from ${JSON.stringify(module)};openReleaseJournal({root:${JSON.stringify(root)}});process.exit(0);`;
  assert.equal(spawnSync(process.execPath,['--input-type=module','-e',code],{env:{PATH:'/usr/bin:/bin'},encoding:'utf8',timeout:5000}).status,0);
  const lock=path.join(root,'commander.lock'),bytes=fs.readFileSync(lock,'utf8'),retained=path.join(root,`commander.lock.retained-${hash(bytes)}`);
  fs.linkSync(lock,retained);fs.chmodSync(lock,mode);
  assert.equal(recoverReleaseJournalLock({root}).recovered,true);assert.equal(fs.existsSync(lock),false);
  assert.equal(fs.readFileSync(retained,'utf8'),bytes);assert.equal(fs.statSync(retained).nlink,1);assert.equal(fs.statSync(retained).mode&0o777,0o400);
 }
});

test('competing recovery processes cannot remove a newly acquired live commander lock',rootTest,async t=>{
 const root=directory(t),module=fileURLToPath(new URL('../packages/zola-release/commander-journal.js',import.meta.url));
 const setup=`import {openReleaseJournal} from ${JSON.stringify(module)};openReleaseJournal({root:${JSON.stringify(root)}});process.exit(0);`;
 assert.equal(spawnSync(process.execPath,['--input-type=module','-e',setup],{env:{PATH:'/usr/bin:/bin'},timeout:5000}).status,0);
 const code=`import {openReleaseJournal,recoverReleaseJournalLock} from ${JSON.stringify(module)};try{recoverReleaseJournalLock({root:${JSON.stringify(root)}});const j=openReleaseJournal({root:${JSON.stringify(root)}});console.log('ACQUIRED');setTimeout(()=>{j.close();process.exit(0)},350);}catch{console.log('REFUSED');process.exit(0);}`;
 const compete=()=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--input-type=module','-e',code],{env:{PATH:'/usr/bin:/bin'},stdio:['ignore','pipe','pipe']});
  let output='',error='';child.stdout.on('data',part=>output+=part);child.stderr.on('data',part=>error+=part);
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('child timeout'));},5000);
  child.on('error',reject);child.on('exit',status=>{clearTimeout(timer);if(status!==0||error)reject(new Error('child failed'));else resolve(output.trim());});
 });
 const results=await Promise.all([compete(),compete()]);assert.deepEqual(results.sort(),['ACQUIRED','REFUSED']);
 assert.equal(fs.existsSync(path.join(root,'commander.lock')),false);
});
