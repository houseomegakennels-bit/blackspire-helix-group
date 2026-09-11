import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeVerifiedBackup, digest } from './pilot-core.mjs';
import { backupToDrive, verifyLocalInventory } from './drive-backup.mjs';
import { releaseLocalChapter } from './release-local.mjs';
import { fixtureDrive } from './fixture-drive.mjs';

async function fixture(fn) {
 const temporary = await mkdtemp(path.join(tmpdir(),'geminara-release-'));
 const oldRoot = process.env.BOOK_STUDIO_LOCAL_ROOT; process.env.BOOK_STUDIO_LOCAL_ROOT=temporary;
 try {
 const video = Buffer.from('synthetic video bytes for authorization tests only');
 const asset = {id:'video',kind:'chapter_video',relativePath:'book_test/chapter_video/video.mp4',metadata:{releaseStatus:'private'}};
 const chapter = {id:'chapter_test',order:1,title:'TEST ONLY',sceneIds:['scene_test'],videoAssetId:'video',audioAssetId:null};
 const book = {id:'book_test',status:'Draft',chapters:[chapter],scenes:[{id:'scene_test',chapterId:chapter.id}],styleProfile:{},characters:[],references:[],assets:[asset]};
 const source = {chapter,scenes:book.scenes,style:book.styleProfile,characters:[],references:[]};
 const qa = {videoSha256:digest(video),fullDecodePassed:true,playbackReviewedBy:'test fixture only',narrationReviewedBy:'test fixture only'};
 const root=path.join(temporary,'backup');
 const manifest=await writeVerifiedBackup(root,[{name:'video-video.mp4',bytes:video},{name:'chapter-source.json',bytes:Buffer.from(JSON.stringify(source))},{name:'qa.json',bytes:Buffer.from(JSON.stringify(qa))}],{bookId:book.id,chapterId:chapter.id});
 const drive=fixtureDrive(); const receipt=await backupToDrive(root,'folder',drive);
 const approval={action:'publish',bookId:book.id,chapterId:chapter.id,videoSha256:digest(video),approvedBy:'test fixture only',expiresAt:new Date(Date.now()+60000).toISOString()};
 let current=structuredClone(book); let currentBytes=video;
 const store={async mutateBookRecord(id,fn){assert.equal(id,current.id);const draft=structuredClone(current);await fn(draft);current=draft;return{book:current};},async readAssetBuffer(){return currentBytes;}};
 const input={root,receipt,drive,store,loadApproval:async()=>approval,verifyVideo:async()=>({fullDecodePassed:true})};
 await fn({input,drive,receipt,approval,manifest,root,book:()=>current,setBytes:bytes=>currentBytes=bytes});
 } finally { if(oldRoot===undefined)delete process.env.BOOK_STUDIO_LOCAL_ROOT;else process.env.BOOK_STUDIO_LOCAL_ROOT=oldRoot; await rm(temporary,{recursive:true,force:true}); }
}
test('Drive backup uploads bytes and inventory; retry reads back without duplicate uploads',()=>fixture(async x=>{const n=x.drive.uploads;await backupToDrive(x.root,'folder',x.drive);assert.equal(x.drive.uploads,n);assert.equal(n,4);}));
test('approved isolated release changes existing chapter once; repeat is idempotent',()=>fixture(async x=>{await releaseLocalChapter(x.input);await releaseLocalChapter(x.input);assert.equal(x.book().chapters.length,1);assert.equal(x.book().status,'Published');assert.equal(x.book().assets[0].metadata.releaseSha256,x.approval.videoSha256);}));
for(const [name,edit] of [
 ['missing approval',x=>x.approval.action='render'],['wrong book',x=>x.approval.bookId='other'],['wrong chapter',x=>x.approval.chapterId='other'],['wrong artifact',x=>x.approval.videoSha256='c'.repeat(64)],['expired',x=>x.approval.expiresAt='2000-01-01'],['revoked',x=>x.approval.revoked=true],['cancelled approval',x=>x.approval.cancelled=true],['emergency cancellation',x=>x.input.cancelled=()=>true],['missing backup',x=>x.receipt.files=[]],['changed current bytes',x=>x.setBytes(Buffer.from('changed'))],['changed source',x=>x.book().scenes[0].sourceText='changed'],['shared Drive folder',x=>x.drive.objects.get('folder').meta.shared=true],['Drive size mismatch',x=>x.drive.objects.get('file_1').meta.size='100'],['Drive hash mismatch',x=>x.drive.objects.get('file_1').bytes=Buffer.from('changed')],['Drive wrong parent',x=>x.drive.objects.get('file_1').meta.parents=['other']],['Drive missing permissions',x=>delete x.drive.objects.get('file_1').meta.permissions],['forged verified flag',x=>{x.receipt.files[0].verifiedWithDriveApi=true;x.drive.objects.delete('file_1');}],
]) test(`${name} blocks release with no mutation`,()=>fixture(async x=>{edit(x);await assert.rejects(releaseLocalChapter(x.input));assert.equal(x.book().status,'Draft');}));
test('revocation during verification is rechecked before mutation commits',()=>fixture(async x=>{let reads=0;x.input.loadApproval=async()=>({...x.approval,revoked:++reads>1});await assert.rejects(releaseLocalChapter(x.input));assert.equal(x.book().status,'Draft');}));
test('local tampering rejected before upload',()=>fixture(async x=>{await writeFile(path.join(x.root,'video-video.mp4'),'changed');await assert.rejects(verifyLocalInventory(x.root));}));
test('uncertain upload does not blindly duplicate work on resume',()=>fixture(async x=>{const original=x.drive.upload;let once=true;x.drive.upload=async(...args)=>{const result=await original(...args);if(once){once=false;throw new Error('lost response');}return result;};x.drive.objects.delete('file_1');await assert.rejects(backupToDrive(x.root,'folder',x.drive));const count=x.drive.uploads;await backupToDrive(x.root,'folder',x.drive);assert.equal(x.drive.uploads,count);}));
test('duplicate remote names require operator reconciliation',()=>fixture(async x=>{const first=x.drive.objects.get('file_1');x.drive.objects.set('duplicate',{...first,meta:{...first.meta,id:'duplicate'}});await assert.rejects(backupToDrive(x.root,'folder',x.drive));}));

test('REST transport sends actual bytes and rejects credential-bearing redirects', async () => {
 const {driveRest}=await import('./drive-rest.mjs');const calls=[];
 const request=async(url,options)=>{calls.push({url,options});if(options.method==='POST')return new Response('{}',{headers:{location:'https://www.googleapis.com/upload/drive/v3/files?upload_id=test'}});return new Response('{"id":"uploaded"}');};
 const drive=driveRest('synthetic-test-token',request);const bytes=Buffer.from('actual fixture bytes');
 await drive.upload('folder','movie.mp4',bytes);assert.deepEqual(calls[1].options.body,bytes);assert.equal(calls[0].options.redirect,'error');
 const unsafe=driveRest('synthetic-test-token',async()=>new Response('{}',{headers:{location:'https://unexpected.test/upload'}}));await assert.rejects(unsafe.upload('folder','movie.mp4',bytes));
});
