import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile);
const cwd=path.resolve(import.meta.dirname,'../..');
const nodeArgs=['--import','./scripts/book-studio/register-runtime.mjs','--input-type=module','-e'];
test('real local storage creates private assets and invalidates release before overwrite',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'geminara-store-'));
 try {await exec(process.execPath,[...nodeArgs,`
 const s=await import('./src/lib/book-studio/store.ts');
 const a=await s.writeAssetBuffer('book_test','chapter_video','test.mp4','video/mp4',Buffer.from('before'),{releaseStatus:'approved'});
 if(a.metadata.releaseStatus!=='private')throw Error('public from creation');
 a.metadata={};
 await s.saveBookRecord({id:'book_test',slug:'test',title:'TEST',status:'Draft',assets:[a],scenes:[],chapters:[],references:[],characters:[],styleProfile:{}});
 await s.overwriteAssetBuffer(a.relativePath,Buffer.from('after'),'video/mp4');
 if((await s.getBookById('book_test')).assets[0].metadata.releaseStatus!=='private')throw Error('stale release');
 try{await s.readAssetBuffer('book_test/../escape');throw Error('traversal accepted');}catch(e){if(e.message==='traversal accepted')throw e;}
 `],{cwd,env:{PATH:process.env.PATH,BOOK_STUDIO_LOCAL_ROOT:root}});}finally{await rm(root,{recursive:true,force:true});}
});
test('isolated store rejects remote configuration before service access',async()=>{
 await assert.rejects(exec(process.execPath,[...nodeArgs,"await import('./src/lib/book-studio/store.ts')"],{cwd,env:{PATH:process.env.PATH,BOOK_STUDIO_LOCAL_ROOT:'/tmp/diagnostic',SUPABASE_URL:'https://synthetic.invalid'}}),/isolated local Book Studio root/);
});
test('technical release QA rejects corrupt MP4 bytes',async()=>{
 const {verifyVideoFile}=await import('./media-qa.mjs');await assert.rejects(verifyVideoFile('/dev/null'));
});
test('private reference generation does not fall back to another paid request',async()=>{
 await exec(process.execPath,[...nodeArgs,`
 const {withPrivateProviderGuard}=await import('./src/lib/book-studio/private-provider-guard.ts');
 const {generateImageBuffer}=await import('./src/lib/book-studio/media.ts');let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response('{}',{status:500});};
 try{await withPrivateProviderGuard(async()=>{},()=>generateImageBuffer({prompt:'fixture',title:'fixture',references:[{buffer:Buffer.from('fixture'),mimeType:'image/png',fileName:'fixture.png'}]}));throw Error('accepted');}catch(e){if(e.message==='accepted')throw e;}
 if(calls!==1)throw Error('Duplicate provider fallback');
 `],{cwd,env:{PATH:process.env.PATH,OPENAI_API_KEY:'synthetic-test-value'}});
});
test('revocation between speech chunks stops the next provider call',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'geminara-speech-'));
 try {await exec(process.execPath,[...nodeArgs,`
 const {withPrivateProviderGuard}=await import('./src/lib/book-studio/private-provider-guard.ts');
 const {generateSpeechAudio}=await import('./src/lib/book-studio/media.ts');let calls=0;
 const bytes=Buffer.alloc(48);bytes.write('data',36);bytes.writeUInt32LE(4,40);bytes.writeInt16LE(1000,44);
 globalThis.fetch=async()=>{calls++;return new Response(bytes);};
 try{await withPrivateProviderGuard(async()=>{if(calls)throw Error('revoked');},()=>generateSpeechAudio({text:'A'.repeat(3900)+'. Next chunk.',voice:'onyx',targetPath:process.env.BOOK_STUDIO_LOCAL_ROOT+'/test.wav'}));throw Error('accepted');}catch(e){if(e.message==='accepted')throw e;}
 if(calls!==1)throw Error('Revoked provider dispatched');
 `],{cwd,env:{PATH:process.env.PATH,BOOK_STUDIO_LOCAL_ROOT:root,OPENAI_API_KEY:'synthetic-test-value'}});}finally{await rm(root,{recursive:true,force:true});}
});
test('failed private run retains its single-host fence and blocks a blind retry',async()=>{
 const parent=await mkdtemp(path.join(tmpdir(),'geminara-fence-'));const root=path.join(parent,'store');
 const env={PATH:process.env.PATH,BOOK_STUDIO_LOCAL_ROOT:root};
 try {
 await exec(process.execPath,['--import','./scripts/book-studio/register-runtime.mjs','scripts/book-studio/diagnostic.mjs'],{cwd,env});
 const {readFile,writeFile,stat}=await import('node:fs/promises');
 const approvalPath=path.join(root,'diagnostic-approval.json');const saved=await readFile(approvalPath,'utf8');const approval=JSON.parse(saved);approval.reusedAssets=[];await writeFile(approvalPath,JSON.stringify(approval));
 const args=['--import','./scripts/book-studio/register-runtime.mjs','scripts/book-studio/runner-private-pilot.mts','--book','book_diagnostic','--chapter','1','--backup-root',path.join(parent,'backup'),'--execute','--approval',approvalPath];
 await assert.rejects(exec(process.execPath,args,{cwd,env}),/Reused bytes require/);
 assert.ok((await stat(path.join(root,'pilot-locks','book_diagnostic-chapter_diagnostic.lock'))).isDirectory());
 await writeFile(approvalPath,saved);await assert.rejects(exec(process.execPath,args,{cwd,env}),/EEXIST/);
 }finally{await rm(parent,{recursive:true,force:true});}
});
