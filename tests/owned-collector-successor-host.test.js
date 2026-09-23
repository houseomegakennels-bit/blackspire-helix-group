import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {SUCCESSOR,assertArchiveOperatorSource,archiveOldObservation,renameNoReplace,classifyArchiveMove,classifyArchivePresence,exactFile} from '../packages/zola-six-reads/owned-collector-successor-host.js';
test('archive rename preserves evidence inode and bytes',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'zola-archive-test-'));
 try{const a=root+'/old',b=root+'/retained';fs.writeFileSync(a,'evidence\n',{mode:0o600});const before=fs.statSync(a);
 renameNoReplace(a,b);assert.equal(fs.existsSync(a),false);const after=fs.statSync(b);
 assert.equal(after.ino,before.ino);assert.equal(after.dev,before.dev);assert.equal(after.mode,before.mode);assert.equal(fs.readFileSync(b,'utf8'),'evidence\n');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('archive rename cannot clobber any existing destination',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'zola-archive-test-'));
 try{const a=root+'/old',b=root+'/retained';fs.writeFileSync(a,'source');fs.writeFileSync(b,'other');const before=fs.statSync(a);
 assert.throws(()=>renameNoReplace(a,b));assert.equal(fs.statSync(a).ino,before.ino);assert.equal(fs.readFileSync(a,'utf8'),'source');assert.equal(fs.readFileSync(b,'utf8'),'other');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('archive rename cannot replace a destination symlink',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'zola-archive-test-'));
 try{const a=root+'/old',b=root+'/retained';fs.writeFileSync(a,'source');fs.symlinkSync(root+'/missing',b);
 assert.throws(()=>renameNoReplace(a,b));assert.equal(fs.readFileSync(a,'utf8'),'source');assert.equal(fs.lstatSync(b).isSymbolicLink(),true);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('uncertain retained rename dispatch never replays a still-present source',()=>{
 assert.throws(()=>classifyArchiveMove({position:'source',hasIntent:true,hasResult:false,intentMatches:true}));
 assert.throws(()=>classifyArchiveMove({position:'source',hasIntent:false,hasResult:true}));
 assert.equal(classifyArchiveMove({position:'source',hasIntent:false,hasResult:false}),'dispatch');
});
test('partial archive reconciles only exact completed identity with original intent',()=>{
 assert.equal(classifyArchiveMove({position:'archived',hasIntent:true,hasResult:false,intentMatches:true}),'observe');
 assert.throws(()=>classifyArchiveMove({position:'archived',hasIntent:false,hasResult:false}));
 assert.throws(()=>classifyArchiveMove({position:'archived',hasIntent:true,hasResult:false,intentMatches:false}));
 assert.throws(()=>classifyArchiveMove({position:'archived',hasIntent:true,hasResult:true,intentMatches:true,resultMatches:false}));
 assert.equal(classifyArchiveMove({position:'archived',hasIntent:true,hasResult:true,intentMatches:true,resultMatches:true}),'complete');
});

test('archive rejects duplicated or missing source/destination evidence',()=>{
 assert.throws(()=>classifyArchivePresence(false,false));
 assert.throws(()=>classifyArchivePresence(true,true));
 assert.equal(classifyArchivePresence(true,false),'archived');
 assert.equal(classifyArchivePresence(false,true),'source');
});
test('matching bytes on a substituted inode cannot reconcile archive',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'zola-archive-test-'));
 try{const a=root+'/old',b=root+'/substitute';fs.writeFileSync(a,'same',{mode:0o600});fs.writeFileSync(b,'same',{mode:0o600});
 const s=fs.statSync(a),expected={dev:s.dev,ino:s.ino,gid:s.gid,size:s.size,mode:s.mode&0o7777,digest:createHash('sha256').update('same').digest('hex')};
 exactFile(a,expected);assert.throws(()=>exactFile(b,expected));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('archive operator remains frozen predecessor and rejects source identity drift',()=>{
 const bound={root:SUCCESSOR.archiveOperatorRoot,sha:SUCCESSOR.archiveOperatorSha,clean:true};
 assert.notEqual(SUCCESSOR.root,bound.root);assert.notEqual(SUCCESSOR.baseSha,bound.sha);
 assert.equal(assertArchiveOperatorSource(bound),'13b868da16f373eea06a456b5120c68c6f028605');
 for(const change of [{root:SUCCESSOR.root},{sha:'f'.repeat(40)},{sha:SUCCESSOR.baseSha},{clean:false}])assert.throws(()=>assertArchiveOperatorSource({...bound,...change}));
});
test('successor2 refuses archive mutation and reconciliation before any host access',async()=>{
 await assert.rejects(archiveOldObservation({mutate:true}));await assert.rejects(archiveOldObservation({reconcile:true}));
});
