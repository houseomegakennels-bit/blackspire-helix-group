import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {openReleaseJournal,recoverReleaseJournalLock,hash} from '../packages/zola-release/commander-journal.js';

const rootTest={skip:process.getuid?.()!==0};
function directory(t){const root=fs.mkdtempSync('/root/.zola-release-journal-test-');fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
test('global and workflow streams retain independent histories under one host lock',rootTest,t=>{
 const root=directory(t),journal=openReleaseJournal({root});
 const release=journal.stream('release'),workflow=journal.stream('n8n');
 release.append({type:'intent',operation:'merge',releaseSha:'a'.repeat(40)});
 workflow.append({type:'intent',operation:'deactivate',namespace:'b'.repeat(64)});
 assert.equal(journal.events()[0].operation,'deactivate');
 assert.equal(release.events()[0].operation,'merge');
 assert.throws(()=>openReleaseJournal({root}));
 for(const name of ['../release','commander','release.jsonl',''])assert.throws(()=>journal.stream(name));
 const bytes=fs.readFileSync(path.join(root,'n8n.jsonl'),'utf8');journal.close();
 assert.throws(()=>release.append({type:'late'}));assert.throws(()=>workflow.events());
 const reopened=openReleaseJournal({root});assert.equal(reopened.stream('release').events()[0].operation,'merge');
 assert.equal(fs.readFileSync(path.join(root,'n8n.jsonl'),'utf8'),bytes);reopened.close();
});
test('torn or linked global stream blocks workflow access and retains host lock',rootTest,t=>{
 for(const tamper of ['torn','linked']){
  const root=directory(t),journal=openReleaseJournal({root});journal.close();
  const filename=path.join(root,'release.jsonl');
  if(tamper==='torn')fs.appendFileSync(filename,'partial');else fs.linkSync(filename,path.join(root,'alias'));
  assert.throws(()=>openReleaseJournal({root}));assert.ok(fs.existsSync(path.join(root,'commander.lock')));
 }
});
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
 const code=`import {openReleaseJournal,recoverReleaseJournalLock} from ${JSON.stringify(module)};try{recoverReleaseJournalLock({root:${JSON.stringify(root)}});const j=openReleaseJournal({root:${JSON.stringify(root)}});console.log('ACQUIRED');process.stdin.once('data',()=>{j.close();process.exit(0)});process.stdin.resume();}catch{console.log('REFUSED');process.exit(0);}`;
 const children=[];
 const compete=()=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--input-type=module','-e',code],{env:{PATH:'/usr/bin:/bin'},stdio:['pipe','pipe','pipe']});
  children.push(child);t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  let output='',settled=false;
  const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('child timeout'));},5000);
  child.stdout.on('data',part=>{output+=part;if(!settled&&output.includes('\n')){settled=true;child.report=output.trim();resolve(child.report);}});
  child.stderr.on('data',()=>{child.kill('SIGKILL');reject(new Error('child diagnostic'));});child.on('error',error=>{clearTimeout(timer);child.kill('SIGKILL');reject(error);});
  child.on('exit',status=>{clearTimeout(timer);if(!settled)reject(new Error(`premature exit ${status}`));});
 });
 const results=await Promise.all([compete(),compete()]);assert.deepEqual(results.sort(),['ACQUIRED','REFUSED']);
 // The winner remains alive and holds its new lock until both outcomes arrive.
 await Promise.all(children.map(child=>new Promise((resolve,reject)=>{
  if(child.exitCode!==null||child.signalCode!==null){if(child.exitCode===0)resolve();else reject(new Error('child failed'));return;}
  child.once('exit',status=>status===0?resolve():reject(new Error('child failed')));
  if(child.report==='ACQUIRED')child.stdin.end('release');
 })));
 assert.equal(fs.existsSync(path.join(root,'commander.lock')),false);
});
