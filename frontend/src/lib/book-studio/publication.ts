import type { AssetRecord, BookRecord, ChapterRecord } from "./types";

const LEGACY_BOOK = "book_hk7iuemqv2j5ld";
const LEGACY_CUTOFF = Date.parse("2026-09-07T00:00:00Z");
export function ownedMediaPath(bookId: string, relativePath: string): boolean {
  const parts = relativePath.split("/");
  return parts[0] === bookId && parts.length >= 3 && parts.every((part) => Boolean(part) && part !== "." && part !== ".." && !/[\\%?#\x00-\x1f]/.test(part));
}
// Deliberate compatibility window for the established Part One release only.
// New writes always carry private metadata, including replacements of legacy files.
function released(book: BookRecord, asset: AssetRecord) {
  if (!ownedMediaPath(book.id, asset.relativePath)) return false;
  const state = asset.metadata?.releaseStatus;
  if (state === "approved") return typeof asset.metadata?.releaseSha256 === "string" && /^[a-f0-9]{64}$/.test(asset.metadata.releaseSha256);
  return state === undefined && book.id === LEGACY_BOOK && Number.isFinite(Date.parse(asset.createdAt)) && Date.parse(asset.createdAt) < LEGACY_CUTOFF;
}
export function publicChapters(book: BookRecord): ChapterRecord[] {
  if (book.status !== "Published") return [];
  return book.chapters.filter((chapter) => {
    if (book.chapters.filter((item) => item.id === chapter.id || item.order === chapter.order).length !== 1) return false;
    if (!chapter.sceneIds.length || new Set(chapter.sceneIds).size !== chapter.sceneIds.length || chapter.sceneIds.some((id) => book.scenes.filter((s) => s.id === id && s.chapterId === chapter.id).length !== 1)) return false;
    const matches = book.assets.filter((asset) => asset.id === (chapter.videoAssetId || chapter.audioAssetId));
    const asset = matches[0];
    if (matches.length !== 1 || asset.kind !== (chapter.videoAssetId ? "chapter_video" : "chapter_audio") || !released(book, asset)) return false;
    return asset.metadata?.releaseStatus === "approved" || (chapter.order >= 1 && chapter.order <= 20);
  });
}
export function publicAssetAllowed(book: BookRecord, relativePath: string): boolean {
  if (book.status !== "Published" || !ownedMediaPath(book.id, relativePath)) return false;
  const matches = book.assets.filter((asset) => asset.relativePath === relativePath);
  const asset = matches[0];
  if (matches.length !== 1 || !released(book, asset)) return false;
  if (asset.id === book.coverAssetId && asset.kind === "cover") return true;
  const chapters = publicChapters(book);
  if (asset.kind === "chapter_video" && chapters.some((chapter) => chapter.videoAssetId === asset.id)) return true;
  if (asset.kind === "chapter_audio" && chapters.some((chapter) => chapter.audioAssetId === asset.id)) return true;
  return asset.kind === "scene_image" && chapters.some((chapter) => book.scenes.some((scene) => scene.chapterId === chapter.id && chapter.sceneIds.includes(scene.id) && scene.imageAssetId === asset.id));
}
