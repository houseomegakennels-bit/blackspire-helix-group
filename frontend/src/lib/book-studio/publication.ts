import type { BookRecord, ChapterRecord } from "./types";

/** Existing published media without the new flag keeps working; new pilot assets are private. */
export function publicChapters(book: BookRecord): ChapterRecord[] {
  if (book.status !== "Published") return [];
  return book.chapters.filter((chapter) => {
    const assetId = chapter.videoAssetId || chapter.audioAssetId;
    const asset = book.assets.find((candidate) => candidate.id === assetId);
    if (!asset || !asset.relativePath.startsWith(`${book.id}/`)) return false;
    if (asset.kind !== (chapter.videoAssetId ? "chapter_video" : "chapter_audio")) return false;
    const state = asset.metadata?.releaseStatus;
    return state === undefined || state === "approved";
  });
}

export function publicAssetAllowed(book: BookRecord, relativePath: string): boolean {
  if (book.status !== "Published" || !relativePath.startsWith(`${book.id}/`)) return false;
  const asset = book.assets.find((candidate) => candidate.relativePath === relativePath);
  if (!asset) return false;
  if (asset.metadata?.releaseStatus !== undefined && asset.metadata.releaseStatus !== "approved") return false;
  if (asset.id === book.coverAssetId && asset.kind === "cover") return true;
  const chapters = publicChapters(book);
  if (asset.kind === "chapter_video" && chapters.some((chapter) => chapter.videoAssetId === asset.id)) return true;
  if (asset.kind === "chapter_audio" && chapters.some((chapter) => chapter.audioAssetId === asset.id)) return true;
  const visibleSceneIds = new Set(chapters.flatMap((chapter) => chapter.sceneIds));
  // The public player uses scene images, not raw scene narration or manuscript/reference files.
  return asset.kind === "scene_image" && book.scenes.some((scene) => visibleSceneIds.has(scene.id) && scene.imageAssetId === asset.id);
}
