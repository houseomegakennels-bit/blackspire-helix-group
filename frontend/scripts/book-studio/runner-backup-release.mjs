// Run with --import ./scripts/book-studio/register-runtime.mjs. Local/operator only.
import { readFile, writeFile, mkdir, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { driveRest } from './drive-rest.mjs';
import { backupToDrive, verifyLocalInventory } from './drive-backup.mjs';
import { releaseLocalChapter } from './release-local.mjs';
const [action, root, folderId, approvalPath] = process.argv.slice(2);
if (!['backup','release'].includes(action) || !root || !path.isAbsolute(root) || !folderId || (action === 'release' && !path.isAbsolute(approvalPath || ''))) throw new Error('Usage: runner-backup-release.mjs backup|release /PRIVATE/BACKUP DRIVE_FOLDER_ID [/PRIVATE/PUBLISH_APPROVAL]');
const localRoot=process.env.BOOK_STUDIO_LOCAL_ROOT;
if (!localRoot || !path.isAbsolute(localRoot) || ['SUPABASE_URL','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','VERCEL'].some(k=>process.env[k]?.trim())) throw new Error('Explicit isolated local store required.');
const drive=driveRest(process.env.BOOK_STUDIO_DRIVE_ACCESS_TOKEN);
const manifest=await verifyLocalInventory(root);
if(![manifest.bookId,manifest.chapterId].every(id=>typeof id==='string'&&/^[a-zA-Z0-9_-]+$/.test(id)))throw new Error('Invalid backup target.');
await mkdir(path.join(localRoot,'pilot-locks'),{recursive:true,mode:0o700});
const lock=path.join(localRoot,'pilot-locks',`${manifest.bookId}-${manifest.chapterId}.lock`);
await mkdir(lock,{mode:0o700});
let completed=false;
try {
 const receipt=await backupToDrive(root,folderId,drive);
 if(action==='release') {
   const store=await import('../../src/lib/book-studio/store.ts');
   const loadApproval=async()=>JSON.parse(await readFile(approvalPath,'utf8'));
   await releaseLocalChapter({root,receipt,drive,store,loadApproval});
 }
 await writeFile(path.join(root,'drive-receipt.json'),JSON.stringify(receipt,null,2),{mode:0o600});
 completed=true;
 console.log(JSON.stringify({action,files:receipt.files.length,verifiedWithLiveDriveApi:true,productionChanged:false}));
} finally { if(completed)await rmdir(lock); }
