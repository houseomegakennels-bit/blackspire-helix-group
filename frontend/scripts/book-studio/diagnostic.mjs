// No-cost diagnostic; never contains Geminara story or simulated human approval.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import sharp from 'sharp';
import { planPrivateChapter, digest } from './pilot-core.mjs';
const root = process.env.BOOK_STUDIO_LOCAL_ROOT;
if (!root || !path.isAbsolute(root) || process.env.OPENAI_API_KEY || ['SUPABASE_URL','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','VERCEL'].some(k=>process.env[k])) throw new Error('Diagnostic requires explicit local root and no provider credentials.');
await mkdir(root, { mode: 0o700 }); // Refuse existing stores.
const store = await import('../../src/lib/book-studio/store.ts');
const { privateProductionInputs } = await import('../../src/lib/book-studio/service.ts');
const exec = promisify(execFile);
const id = 'book_diagnostic';
const book = { id, slug: 'private-diagnostic', title: 'DIAGNOSTIC — NOT A GEMINARA CHAPTER', synopsis:'Synthetic image and sound; no story or Onyx narration.', status:'Draft', manuscriptText:'Six seconds of diagnostic sound. No spoken narration.', manuscriptAssetId:null, coverAssetId:null, styleProfile:{visualDirection:'Diagnostic only', palette:'black and gold', medium:'test pattern', tone:'technical'}, characters:[], references:[], chapters:[], scenes:[], assets:[], createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), publishedAt:null };
const png = await sharp(Buffer.from('<svg width="1280" height="720"><rect width="1280" height="720" fill="#16120a"/><text x="100" y="300" font-size="50" fill="#edc879">PRIVATE DIAGNOSTIC</text><text x="100" y="390" font-size="30" fill="white">Not a Geminara chapter — synthetic sound</text></svg>')).png().toBuffer();
const image = await store.writeAssetBuffer(id,'scene_image','diagnostic.png','image/png',png);
const audioPath = path.join(root,'synthetic.wav');
await exec('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=6','-c:a','pcm_s16le',audioPath]);
const audio = await store.writeAssetBuffer(id,'scene_audio','synthetic.wav','audio/wav',await readFile(audioPath));
book.assets.push(image,audio);
book.scenes.push({id:'scene_diagnostic',chapterId:'chapter_diagnostic',order:1,title:'Diagnostic',sourceText:book.manuscriptText,summary:book.synopsis,mood:'technical',location:'test',timeOfDay:'test',characterIds:[],modifiers:[],imagePrompt:'',imageStatus:'ready',audioStatus:'ready',reviewStatus:'pending',priority:'key',imageAssetId:image.id,audioAssetId:audio.id,estimatedDurationSeconds:6,renderManifest:null});
book.chapters.push({id:'chapter_diagnostic',order:1,title:'Diagnostic 1',summary:book.synopsis,sceneIds:['scene_diagnostic'],videoAssetId:null,audioAssetId:null});
await store.saveBookRecord(book);
const inputs = await privateProductionInputs(book,['scene_diagnostic']);
const plan = planPrivateChapter(book,id,1,inputs);
await writeFile(path.join(root,'diagnostic-approval.json'),JSON.stringify({bookId:id,chapterId:plan.chapterId,sourceDigest:plan.sourceDigest,approvedBy:'automated diagnostic fixture — no human production approval',expiresAt:new Date(Date.now()+3600000).toISOString(),reusedAssets:[{id:image.id,sha256:digest(png)},{id:audio.id,sha256:digest(await readFile(audioPath))}],allowPaidGeneration:false,maxNewImages:0,maxSpeechCharacters:0}),{mode:0o600,flag:'wx'});
console.log(JSON.stringify({bookId:id,chapterOrder:1,sourceDigest:plan.sourceDigest,diagnostic:true}));
