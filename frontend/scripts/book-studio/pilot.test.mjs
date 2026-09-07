import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { planPrivateChapter, assertGenerationApproval, digest, writeVerifiedBackup, assertReleaseEvidence } from './pilot-core.mjs';
import { publicChapters, publicAssetAllowed } from '../../src/lib/book-studio/publication.ts';

function book() {
  return { id: 'book_pilot', status: 'Draft', title: 'PRIVATE TEST - NOT STORY', styleProfile: {}, characters: [], references: [],
    coverAssetId: 'cover', assets: [],
    chapters: [{ id: 'chapter_pilot', order: 1, title: 'Fixture', sceneIds: ['scene_1'], audioAssetId: null, videoAssetId: null }],
    scenes: [{ id: 'scene_1', chapterId: 'chapter_pilot', order: 1, title: 'Test', sourceText: 'Private test only.', characterIds: [], modifiers: [], imageAssetId: null, audioAssetId: null }] };
}
const asset = (id, kind, state) => ({ id, kind, relativePath: `book_pilot/${kind}/${id}.${kind.includes('video') ? 'mp4' : 'png'}`, createdAt: '2026-07-01T00:00:00Z', metadata: state ? { releaseStatus: state, releaseSha256: 'b'.repeat(64) } : {} });
function finished(state = 'approved') { const b = book(); b.status = 'Published'; b.assets = [asset('video', 'chapter_video', state), asset('image', 'scene_image', 'approved'), asset('cover', 'cover', 'approved'), asset('source', 'manuscript')]; b.chapters[0].videoAssetId = 'video'; b.scenes[0].imageAssetId = 'image'; return b; }
const plan = () => planPrivateChapter(book(), 'book_pilot', 1);
const approval = (p) => ({ sourceDigest: p.sourceDigest, bookId: p.bookId, chapterId: p.chapterId, approvedBy: 'test-only', expiresAt: new Date(Date.now() + 60000).toISOString(), allowPaidGeneration: true, maxNewImages: 1, maxSpeechCharacters: 100 });

test('exact target produces a no-publish plan', () => { const p = plan(); assert.equal(p.publish, false); assert.deepEqual(p.missingImages, ['scene_1']); });
for (const [name, edit] of [
  ['published book protected', b => { b.status = 'Published'; }],
  ['unknown status protected', b => { b.status = 'other'; }],
  ['duplicate chapters denied', b => b.chapters.push({ ...b.chapters[0] })],
  ['missing scene denied', b => { b.scenes = []; }],
  ['cross-chapter scene denied', b => { b.scenes[0].chapterId = 'another'; }],
  ['duplicate scene links denied', b => b.chapters[0].sceneIds.push('scene_1')],
  ['empty source denied', b => { b.scenes[0].sourceText = ' '; }],
  ['dangling asset denied', b => { b.scenes[0].imageAssetId = 'missing'; }],
]) test(name, () => { const b = book(); edit(b); assert.throws(() => planPrivateChapter(b, b.id, 1)); });
test('never defaults to a different book', () => assert.throws(() => planPrivateChapter(book(), 'book_other', 1)));
test('fractional chapter denied', () => assert.throws(() => planPrivateChapter(book(), 'book_pilot', 1.5)));
test('reused assets must belong to exact target', () => { const b = book(); b.scenes[0].imageAssetId = 'image'; b.assets = [asset('image', 'scene_image')]; b.assets[0].relativePath = 'book_other/scene_image/image.png'; assert.throws(() => planPrivateChapter(b, b.id, 1)); });
test('path traversal denied', () => { const b = book(); b.scenes[0].imageAssetId = 'image'; b.assets = [asset('image', 'scene_image')]; b.assets[0].relativePath = 'book_pilot/../scene_image/image.png'; assert.throws(() => planPrivateChapter(b, b.id, 1)); });
test('completed scene skips provider work', () => { const b = book(); b.scenes[0].imageAssetId = 'image'; b.scenes[0].audioAssetId = 'audio'; b.assets = [asset('image', 'scene_image'), asset('audio', 'scene_audio')]; const p = planPrivateChapter(b, b.id, 1); assert.equal(p.missingImages.length + p.missingAudio.length, 0); });
test('changing source invalidates approval', () => { const b = book(); const old = planPrivateChapter(b, b.id, 1); b.scenes[0].sourceText += ' revision'; assert.notEqual(planPrivateChapter(b, b.id, 1).sourceDigest, old.sourceDigest); });
test('generated reference does not invalidate approved inputs', () => { const b = book(); const old = planPrivateChapter(b, b.id, 1); b.references.push({ approved: false, source: 'scene_generation', id: 'generated' }); assert.equal(planPrivateChapter(b, b.id, 1).sourceDigest, old.sourceDigest); });
test('valid bounded generation approval accepted', () => { const p = plan(); assert.doesNotThrow(() => assertGenerationApproval(p, approval(p))); });
for (const [name, patch] of [ ['no paid consent', { allowPaidGeneration: false }], ['wrong digest', { sourceDigest: 'wrong' }], ['wrong book', { bookId: 'another' }], ['expired approval', { expiresAt: '2000-01-01' }], ['image limit', { maxNewImages: 0 }], ['narration limit', { maxSpeechCharacters: 0 }], ['missing human', { approvedBy: '' }] ]) test(name, () => { const p = plan(); assert.throws(() => assertGenerationApproval(p, { ...approval(p), ...patch })); });

test('backup copies actual bytes and verifies hashes, without claiming Drive', async () => {
 const root = await mkdtemp(path.join(tmpdir(), 'book-pilot-'));
 try { const bytes = Buffer.from('test fixture bytes, not a movie'); const target = path.join(root, 'backup'); const m = await writeVerifiedBackup(target, [{name:'fixture.bin', bytes}], {bookId:'book_pilot'}); assert.deepEqual(await readFile(path.join(target, 'fixture.bin')), bytes); assert.equal(m.files[0].sha256, digest(bytes)); assert.equal(m.googleDriveBackupVerified, false); assert.equal(m.published, false); await assert.rejects(writeVerifiedBackup(target, [{name:'fixture.bin', bytes}], {})); }
 finally { await rm(root, {recursive:true,force:true}); }
});
for (const [name, entry] of [['link is not backup', {name:'movie.mp4',bytes:'https://example.test/video'}], ['empty bytes denied',{name:'movie.mp4',bytes:Buffer.alloc(0)}], ['backup traversal denied',{name:'../movie.mp4',bytes:Buffer.from('x')}], ['manifest collision denied',{name:'manifest.json',bytes:Buffer.from('x')}]]) test(name, async () => { const root = await mkdtemp(path.join(tmpdir(), 'book-pilot-')); try { await assert.rejects(writeVerifiedBackup(path.join(root, 'backup'),[entry],{})); } finally { await rm(root,{recursive:true,force:true}); } });

test('legacy released chapter remains visible only in explicit compatibility window', () => {
 const b = finished(); b.id = 'book_hk7iuemqv2j5ld'; for (const a of b.assets) { a.relativePath = a.relativePath.replace('book_pilot', b.id); a.metadata = {}; }
 assert.equal(publicChapters(b).length, 1);
 b.assets[0].createdAt = '2026-09-08T00:00:00Z'; assert.equal(publicChapters(b).length, 0);
});
test('absent release flag does not release new media', () => { const b = finished(); b.assets[0].metadata = {}; assert.equal(publicChapters(b).length, 0); });
test('approved flag without hash denied', () => { const b = finished(); delete b.assets[0].metadata.releaseSha256; assert.equal(publicChapters(b).length, 0); });
test('cross-chapter scene links denied publicly', () => { const b = finished(); b.scenes[0].chapterId = 'another'; assert.equal(publicChapters(b).length, 0); });
test('revoked generation denied', () => { const p = plan(); assert.throws(() => assertGenerationApproval(p, {...approval(p), revoked:true})); });
test('new approved chapter visible', () => assert.equal(publicChapters(finished('approved')).length, 1));
for (const state of ['private', 'pending', 'unknown']) test(`${state} chapter hidden including direct image and video access`, () => { const b = finished(state); assert.equal(publicChapters(b).length, 0); assert.equal(publicAssetAllowed(b,b.assets[0].relativePath), false); assert.equal(publicAssetAllowed(b,b.assets[1].relativePath), false); });
test('draft media denied even with direct path', () => { const b = finished(); b.status = 'Draft'; assert.equal(publicAssetAllowed(b,b.assets[0].relativePath),false); });
test('published manuscript never public', () => { const b = finished(); assert.equal(publicAssetAllowed(b,b.assets[3].relativePath), false); });
test('released video and scene image remain public', () => { const b = finished(); assert.equal(publicAssetAllowed(b,b.assets[0].relativePath),true); assert.equal(publicAssetAllowed(b,b.assets[1].relativePath),true); });
test('unfinished chapter is not listed publicly', () => { const b = finished(); b.chapters[0].videoAssetId = null; assert.equal(publicChapters(b).length,0); });
function release() { const video = {name:'movie.mp4',bytes:10,md5:'a'.repeat(32),sha256:'b'.repeat(64)}; return { manifest:{bookId:'book_pilot',chapterId:'chapter_pilot',localBackupVerified:true,files:[video]}, receipt:{...video,fileId:'drive_file',folderId:'drive_folder',private:true,verifiedWithDriveApi:true}, qa:{videoSha256:video.sha256,fullDecodePassed:true,playbackReviewedBy:'test',narrationReviewedBy:'test'}, approval:{action:'publish',bookId:'book_pilot',chapterId:'chapter_pilot',videoSha256:video.sha256,approvedBy:'test',expiresAt:new Date(Date.now()+60000).toISOString()} }; }
test('release evidence is eligibility only, not publication', () => { const x = release(); assert.equal(assertReleaseEvidence(x.manifest,x.receipt,x.approval,x.qa).eligibleForRelease,true); });
for (const [name, edit] of [['missing Drive verification', x=>x.receipt.verifiedWithDriveApi=false],['wrong Drive bytes',x=>x.receipt.bytes++],['wrong Drive hash',x=>x.receipt.sha256='wrong'],['public backup',x=>x.receipt.private=false],['missing playback review',x=>x.qa.playbackReviewedBy=''],['decode failed',x=>x.qa.fullDecodePassed=false],['wrong video approval',x=>x.approval.videoSha256='wrong'],['expired release',x=>x.approval.expiresAt='2000-01-01'],['no publication approval',x=>x.approval.action='render']]) test(name,()=>{const x=release();edit(x);assert.throws(()=>assertReleaseEvidence(x.manifest,x.receipt,x.approval,x.qa));});
test('cross-book media cannot make a chapter public',()=>{const b=finished();b.assets[0].relativePath='book_other/chapter_video/video.mp4';assert.equal(publicChapters(b).length,0);});
test('manuscript attached as chapter audio is still denied',()=>{const b=finished();b.chapters[0].audioAssetId='source';assert.equal(publicAssetAllowed(b,b.assets[3].relativePath),false);});
test('wrong media kind cannot make a chapter public',()=>{const b=finished();b.assets[0].kind='manuscript';assert.equal(publicChapters(b).length,0);});

test('duplicate scene ID in another chapter is denied before ID-only service lookup',()=>{const b=book();b.scenes.unshift({...b.scenes[0],chapterId:'other'});assert.throws(()=>planPrivateChapter(b,b.id,1));});
test('scene summary and actual runtime inputs are bound to generation approval',()=>{const b=book();const before=planPrivateChapter(b,b.id,1,{voice:'onyx',referenceSha256:'a'});b.scenes[0].summary='changed';assert.notEqual(planPrivateChapter(b,b.id,1,{voice:'onyx',referenceSha256:'a'}).sourceDigest,before.sourceDigest);assert.notEqual(planPrivateChapter(book(),b.id,1,{voice:'sage',referenceSha256:'a'}).sourceDigest,before.sourceDigest);});
test('reused media needs matching bytes and source evidence',async()=>{const {verifyReusedAssets}=await import('./pilot-core.mjs');const bytes=Buffer.from('reuse fixture');const p={sourceDigest:'source',reusedAssets:[{id:'asset',relativePath:'book/scene/image.png',metadata:{pilotSourceDigest:'source',pilotSha256:digest(bytes)}}]};await verifyReusedAssets(p,{},async()=>bytes);await assert.rejects(verifyReusedAssets(p,{},async()=>Buffer.from('changed')));p.sourceDigest='new source';await assert.rejects(verifyReusedAssets(p,{},async()=>bytes));await verifyReusedAssets(p,{reusedAssets:[{id:'asset',sha256:digest(bytes)}]},async()=>bytes);});
test('reordered chapter links cannot change narration under the same approval',()=>{const b=book();b.scenes.push({...b.scenes[0],id:'scene_2',order:2});b.chapters[0].sceneIds=['scene_2','scene_1'];assert.throws(()=>planPrivateChapter(b,b.id,1),/narration order/);});
test('protected production ID is refused even if status is changed to Draft',()=>{const b=book();b.id='book_hk7iuemqv2j5ld';assert.throws(()=>planPrivateChapter(b,b.id,1),/Protected production/);});
