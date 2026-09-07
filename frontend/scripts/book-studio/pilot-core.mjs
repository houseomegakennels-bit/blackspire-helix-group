import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export const digest = (value) => createHash('sha256').update(value).digest('hex');
const safeId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id);
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };

/** Build a scoped, read-only plan. Never picks the first book. */
export function planPrivateChapter(book, bookId, chapterOrder) {
  requireThat(safeId(bookId) && book?.id === bookId, 'Exact book ID is required.');
  requireThat(book.status === 'Draft' || book.status === 'ApprovedForRender', 'Published or unknown-status books are protected.');
  requireThat(Number.isSafeInteger(chapterOrder) && chapterOrder > 0, 'A positive integer chapter order is required.');
  const chapters = book.chapters.filter((c) => c.order === chapterOrder);
  requireThat(chapters.length === 1, 'Chapter must exist exactly once.');
  const chapter = chapters[0];
  requireThat(safeId(chapter.id), 'Invalid chapter ID.');
  requireThat(chapter.sceneIds.length > 0, 'Chapter has no prepared scenes.');
  requireThat(new Set(chapter.sceneIds).size === chapter.sceneIds.length, 'Duplicate scene links.');
  const scenes = chapter.sceneIds.map((id) => {
    const matches = book.scenes.filter((s) => s.id === id && s.chapterId === chapter.id);
    requireThat(matches.length === 1 && safeId(id), 'Scene is missing, ambiguous, or belongs to another chapter.');
    requireThat(typeof matches[0].sourceText === 'string' && matches[0].sourceText.trim(), 'Prepared source text is required.');
    return matches[0];
  }).sort((a, b) => a.order - b.order);
  requireThat(new Set(scenes.map((s) => s.order)).size === scenes.length, 'Duplicate scene order.');
  const assetById = new Map();
  for (const asset of book.assets) {
    requireThat(!assetById.has(asset.id), 'Duplicate asset IDs.');
    assetById.set(asset.id, asset);
  }
  const ownedAsset = (id, kind) => {
    if (!id) return null;
    const asset = assetById.get(id);
    requireThat(asset?.kind === kind, 'Existing asset is missing or has the wrong kind.');
    requireThat(safeId(asset.id) && typeof asset.relativePath === 'string', 'Invalid asset identity.');
    const segments = asset.relativePath.split('/');
    requireThat(segments[0] === bookId && segments.length >= 3 && segments.every((x) => x && x !== '.' && x !== '..') && !/[\\%?#\x00-\x1f]/.test(asset.relativePath), 'Asset path escapes the selected book.');
    return asset;
  };
  const reusedAssets = [];
  for (const scene of scenes) {
    for (const [id, kind] of [[scene.imageAssetId, 'scene_image'], [scene.audioAssetId, 'scene_audio']]) {
      const asset = ownedAsset(id, kind);
      if (asset) reusedAssets.push(asset);
    }
  }
  for (const [id, kind] of [[chapter.videoAssetId, 'chapter_video'], [chapter.audioAssetId, 'chapter_audio']]) {
    const asset = ownedAsset(id, kind);
    if (asset) reusedAssets.push(asset);
  }
  // Deliberately exclude generated output IDs, but bind every creative input.
  const source = { bookId, chapterId: chapter.id, order: chapter.order, title: chapter.title,
    style: book.styleProfile, characters: book.characters, references: book.references.filter((r) => r.approved === true && r.source !== 'scene_generation'),
    scenes: scenes.map((s) => ({ id: s.id, order: s.order, title: s.title, sourceText: s.sourceText,
      imagePrompt: s.imagePrompt, characterIds: s.characterIds, modifiers: s.modifiers,
      mood: s.mood, location: s.location, timeOfDay: s.timeOfDay, renderManifest: s.renderManifest })) };
  // renderManifest is output from image generation; don't let that invalidate the source approval.
  for (const scene of source.scenes) delete scene.renderManifest;
  return { bookId, chapterId: chapter.id, chapterOrder, sourceDigest: digest(JSON.stringify(source)),
    sceneIds: scenes.map((s) => s.id),
    missingImages: scenes.filter((s) => !s.imageAssetId).map((s) => s.id),
    missingAudio: scenes.filter((s) => !s.audioAssetId).map((s) => s.id),
    speechCharacters: scenes.filter((s) => !s.audioAssetId).reduce((n, s) => n + s.sourceText.length, 0),
    needsVideo: !chapter.videoAssetId, reusedAssets, publish: false };
}

/** Provider use is off unless the exact source digest and workload are approved. */
export function assertGenerationApproval(plan, approval) {
  requireThat(approval?.sourceDigest === plan.sourceDigest && approval?.bookId === plan.bookId && approval?.chapterId === plan.chapterId,
    'Approval must match this exact book, chapter, and source digest.');
  requireThat(typeof approval.approvedBy === 'string' && approval.approvedBy.trim(), 'Named human approval is required.');
  requireThat(Number.isFinite(Date.parse(approval.expiresAt)) && Date.parse(approval.expiresAt) > Date.now(), 'Approval is expired or has no expiry.');
  requireThat(Number.isSafeInteger(approval.maxNewImages) && approval.maxNewImages >= plan.missingImages.length, 'Image workload exceeds approval.');
  requireThat(Number.isSafeInteger(approval.maxSpeechCharacters) && approval.maxSpeechCharacters >= plan.speechCharacters, 'Narration workload exceeds approval.');
  requireThat(approval.allowPaidGeneration === true || (!plan.missingImages.length && !plan.missingAudio.length), 'Paid generation is not approved.');
}

/** Copy actual bytes, re-read them, and record checksums. Links are never backups. */
export async function writeVerifiedBackup(root, entries, metadata) {
  requireThat(entries.length > 0, 'No media bytes to back up.');
  await mkdir(root, { recursive: false, mode: 0o700 }); // New run only; no overwrite.
  const files = [];
  const names = new Set();
  for (const entry of entries) {
    requireThat(typeof entry.name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(entry.name) && entry.name !== 'manifest.json' && !names.has(entry.name), 'Invalid or duplicate backup filename.');
    requireThat(Buffer.isBuffer(entry.bytes) && entry.bytes.length > 0, 'Backup requires nonempty file bytes.');
    names.add(entry.name);
    const destination = path.join(root, entry.name);
    await writeFile(destination, entry.bytes, { flag: 'wx', mode: 0o600 });
    const copied = await readFile(destination);
    requireThat(copied.length === entry.bytes.length && digest(copied) === digest(entry.bytes), 'Backup verification failed.');
    files.push({ name: entry.name, bytes: copied.length, sha256: digest(copied), md5: createHash('md5').update(copied).digest('hex') });
  }
  const manifest = { version: 1, ...metadata, createdAt: new Date().toISOString(), files,
    localBackupVerified: true, googleDriveBackupVerified: false, published: false };
  const temporary = path.join(root, 'manifest.json.partial');
  await writeFile(temporary, JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
  await rename(temporary, path.join(root, 'manifest.json'));
  return manifest;
}

/** A receipt is evidence to validate, not a flag supplied by a browser. */
export function assertReleaseEvidence(manifest, receipt, approval, qa) {
  requireThat(manifest.localBackupVerified === true, 'Local backup is not verified.');
  const video = manifest.files.find((f) => f.name.endsWith('.mp4'));
  requireThat(video && /^[a-f0-9]{64}$/.test(video.sha256), 'Verified MP4 is required.');
  requireThat(receipt?.verifiedWithDriveApi === true && safeId(receipt.fileId) && safeId(receipt.folderId), 'A verified Drive receipt is required.');
  requireThat(receipt.name === video.name && receipt.bytes === video.bytes && receipt.md5 === video.md5 && receipt.sha256 === video.sha256,
    'Drive backup does not match the finished MP4.');
  requireThat(receipt.private === true, 'Drive backup privacy has not been verified.');
  requireThat(qa?.videoSha256 === video.sha256 && qa.fullDecodePassed === true && qa.playbackReviewedBy && qa.narrationReviewedBy,
    'Decode, playback, and narration review must cover the exact finished video.');
  requireThat(approval?.action === 'publish' && approval?.bookId === manifest.bookId && approval?.chapterId === manifest.chapterId && approval?.videoSha256 === video.sha256 && approval?.approvedBy,
    'Explicit publication approval for the exact finished video is required.');
  requireThat(Number.isFinite(Date.parse(approval.expiresAt)) && Date.parse(approval.expiresAt) > Date.now(), 'Publication approval expired.');
  return { eligibleForRelease: true, bookId: manifest.bookId, chapterId: manifest.chapterId, videoSha256: video.sha256 };
}
