// Operator library; never expose transport or approval injection through an HTTP endpoint.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyVideoFile } from './media-qa.mjs';
import { ownedMediaPath } from '../../src/lib/book-studio/publication.ts';
import { digest, assertReleaseEvidence } from './pilot-core.mjs';
import { verifyLocalInventory, verifyDriveFile, assertPrivateDriveMetadata } from './drive-backup.mjs';
export async function releaseLocalChapter({ root, receipt, loadApproval, drive, store, cancelled = () => false, verifyVideo = verifyVideoFile }) {
  if (!process.env.BOOK_STUDIO_LOCAL_ROOT || ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'VERCEL'].some((key) => process.env[key]?.trim())) throw new Error('Release rehearsal requires isolated local storage.');
  const manifest = await verifyLocalInventory(root);
  if (!['qa.json', 'chapter-source.json'].every(name => manifest.files.some(file => file.name === name))) throw new Error('Source and QA must be inventoried.');
  const qa = JSON.parse(await readFile(path.join(root, 'qa.json'), 'utf8'));
  const source = JSON.parse(await readFile(path.join(root, 'chapter-source.json'), 'utf8'));
  if (receipt.bookId !== manifest.bookId || receipt.chapterId !== manifest.chapterId) throw new Error('Backup target mismatch.');
  assertPrivateDriveMetadata(await drive.get(receipt.folderId));
  let videoReceipt;
  for (const file of manifest.files) {
    const records = receipt.files.filter((item) => item.name === file.name);
    if (records.length !== 1) throw new Error('Incomplete backup receipt.');
    const verified = await verifyDriveFile(file, records[0].fileId, receipt.folderId, drive);
    if (file.name.endsWith('.mp4')) {
      if (videoReceipt) throw new Error('Ambiguous video inventory.');
      videoReceipt = verified;
    }
  }
  if (!videoReceipt) throw new Error("Finished video backup required.");
  await verifyVideo(path.join(root, videoReceipt.name));
  assertReleaseEvidence(manifest, videoReceipt, await loadApproval(), qa);
  return store.mutateBookRecord(manifest.bookId, async (book) => {
    if (cancelled()) throw new Error('Release cancelled.');
    if (book.id === 'book_hk7iuemqv2j5ld') throw new Error('Protected production book.');
    const chapters = book.chapters.filter((item) => item.id === manifest.chapterId);
    if (chapters.length !== 1) throw new Error('Ambiguous chapter.');
    const chapter = chapters[0];
    if (JSON.stringify(chapter) !== JSON.stringify(source.chapter) || JSON.stringify(book.scenes.filter((s) => chapter.sceneIds.includes(s.id))) !== JSON.stringify(source.scenes) || JSON.stringify(book.styleProfile) !== JSON.stringify(source.style) || JSON.stringify(book.characters) !== JSON.stringify(source.characters) || JSON.stringify(book.references) !== JSON.stringify(source.references)) throw new Error('Source or artifact links changed since backup.');
    const videoAsset = book.assets.find((item) => item.id === chapter.videoAssetId && item.kind === 'chapter_video');
    if (!videoAsset || videoReceipt.name !== `${videoAsset.id}-${path.basename(videoAsset.relativePath)}`) throw new Error('Approval does not identify the selected chapter video.');
    const ids = [chapter.videoAssetId, chapter.audioAssetId, ...source.scenes.flatMap((scene) => [scene.imageAssetId, scene.audioAssetId])].filter(Boolean);
    for (const id of ids) {
      const assets = book.assets.filter((item) => item.id === id);
      if (assets.length !== 1) throw new Error('Missing or ambiguous media.');
      const asset = assets[0];
      const file = manifest.files.find((item) => item.name === `${asset.id}-${path.basename(asset.relativePath)}`);
      if (!file || !ownedMediaPath(book.id, asset.relativePath) || digest(await store.readAssetBuffer(asset.relativePath)) !== file.sha256) throw new Error('Current media differs from backup.');
      asset.metadata = { ...asset.metadata, releaseStatus: 'approved', releaseSha256: file.sha256 };
    }
    assertReleaseEvidence(manifest, videoReceipt, await loadApproval(), qa);
    if (cancelled()) throw new Error('Release cancelled.');
    book.status = 'Published';
    book.publishedAt ||= new Date().toISOString();
  });
}
