// Tests only a separately created diagnostic store; restores its private snapshot.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { writeVerifiedBackup } from './pilot-core.mjs';
import { backupToDrive } from './drive-backup.mjs';
import { fixtureDrive } from './fixture-drive.mjs';
import { releaseLocalChapter } from './release-local.mjs';
const root=process.env.BOOK_STUDIO_LOCAL_ROOT;
if(!root || !path.isAbsolute(root) || ['SUPABASE_URL','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','VERCEL','OPENAI_API_KEY'].some(k=>process.env[k]))throw Error('Isolated diagnostic only.');
const origin='http://127.0.0.1:3216';const backup=process.argv[2];
const store=await import('../../src/lib/book-studio/store.ts');
const initial=await store.getBookById('book_diagnostic');
assert.equal(initial?.title,'DIAGNOSTIC — NOT A GEMINARA CHAPTER');assert.equal(initial.status,'Draft');
const temp=await mkdtemp(path.join(tmpdir(),'geminara-browser-release-'));let browser;let checks=0;let activePage;const pageErrors=[];
const check=(ok)=>{assert.ok(ok);checks++;};
try {
 const video=initial.assets.find(a=>a.kind==='chapter_video');const image=initial.assets.find(a=>a.kind==='scene_image');
 for(const url of ['/books/private-diagnostic',`/api/book-assets/${video.relativePath}`,`/api/book-assets/${image.relativePath}`])check((await fetch(origin+url)).status===404);
 for(const url of ['/api/books/book_diagnostic/scenes','/api/books/book_diagnostic/references','/api/books/book_diagnostic/characters'])check([401,403].includes((await fetch(origin+url)).status));
 check([401,403].includes((await fetch(origin+'/api/books/book_diagnostic/publish',{method:'POST'})).status));
 const manifest=JSON.parse(await readFile(path.join(backup,'manifest.json'),'utf8'));const qa=JSON.parse(await readFile(path.join(backup,'qa.json'),'utf8'));
 const testQa={...qa,playbackReviewedBy:'AUTOMATED TEST FIXTURE ONLY',narrationReviewedBy:'AUTOMATED TEST FIXTURE ONLY'};
 const entries=await Promise.all(manifest.files.map(async f=>({name:f.name,bytes:f.name==='qa.json'?Buffer.from(JSON.stringify(testQa)):await readFile(path.join(backup,f.name))})));
 const localBackup=path.join(temp,'test-evidence');await writeVerifiedBackup(localBackup,entries,{bookId:manifest.bookId,chapterId:manifest.chapterId});
 const drive=fixtureDrive();const receipt=await backupToDrive(localBackup,'folder',drive);
 const approval={action:'publish',bookId:manifest.bookId,chapterId:manifest.chapterId,videoSha256:qa.videoSha256,approvedBy:'AUTOMATED TEST FIXTURE ONLY',expiresAt:new Date(Date.now()+60000).toISOString()};
 const input={root:localBackup,receipt,drive,store,loadApproval:async()=>approval};
 await assert.rejects(releaseLocalChapter({...input,loadApproval:async()=>({...approval,revoked:true})}));checks++;
 await releaseLocalChapter(input);await releaseLocalChapter(input);
 check((await store.getBookById('book_diagnostic')).chapters.length===1);check((await fetch(origin+'/books/private-diagnostic')).status===200);
 const range=await fetch(origin+`/api/book-assets/${video.relativePath}`,{headers:{Range:'bytes=0-99'}});check(range.status===206 && (await range.arrayBuffer()).byteLength===100);
 check((await fetch(origin+`/api/book-assets/${image.relativePath}`)).status===200);
 browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});const page=await browser.newPage();activePage=page;const errors=pageErrors;page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/books/private-diagnostic');await page.locator('video').waitFor();
 await page.locator('video').evaluate(video=>{video.muted=true;});
 await page.getByRole('button',{name:'Play',exact:true}).click();

 await page.waitForFunction(()=>document.querySelector('video').currentTime>0.2);
 await page.locator('video').evaluate(async video=>{video.currentTime=video.duration-1;await video.play();});
 check(Number(await page.getByRole('slider',{name:'Seek'}).getAttribute('max'))===6);
 try { await page.waitForFunction(()=>document.querySelector('video').ended,{},{timeout:15000}); }
 catch(error) { console.error(JSON.stringify(await page.locator('video').evaluate(v=>({duration:v.duration,currentTime:v.currentTime,paused:v.paused,ended:v.ended,readyState:v.readyState,error:v.error?.message,networkState:v.networkState})))); throw error; }
 const playback=await page.locator('video').evaluate(v=>({duration:v.duration,currentTime:v.currentTime,ended:v.ended,error:v.error?.code??null}));
 check(playback.ended && playback.currentTime>=playback.duration-0.1 && playback.error===null);check(errors.length===0);
 await page.screenshot({path:path.join(root,'diagnostic-browser.png'),animations:'disabled',timeout:10000});
 console.log(JSON.stringify({checks,passed:checks,playback,narrationReview:false,creativeReview:false,releaseEvidence:'synthetic test fixtures only',actualDriveVerification:'separate connector receipt',productionChanged:false}));
} catch(error) {if(activePage){console.error(JSON.stringify({errors:pageErrors,media:await activePage.locator('video').evaluate(v=>({duration:v.duration,currentTime:v.currentTime,paused:v.paused,ended:v.ended,readyState:v.readyState,error:v.error?.message})).catch(()=>null)}));}throw error;} finally {if(browser)await browser.close();await store.saveBookRecord(initial);await rm(temp,{recursive:true,force:true});}
