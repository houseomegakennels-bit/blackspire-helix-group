import { readStore } from "@/lib/book-studio/store";
import {
  generateSceneAudio,
  renderChapterVideo,
  renderSceneImage,
} from "@/lib/book-studio/service";

const chapterOrders = process.argv.slice(2).map(Number);
if (!chapterOrders.length) throw new Error("usage: runner-produce-chapters.mts <order> [order...]");

const startedAt = Date.now();
function log(...parts: unknown[]) {
  console.log(`[+${Math.round((Date.now() - startedAt) / 1000)}s]`, ...parts);
}

async function withRetry<T>(label: string, attempts: number, fn: () => Promise<T>) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`FAIL ${label} (attempt ${i}/${attempts}): ${message.slice(0, 240)}`);
      if (/billing|quota/i.test(message)) throw error; // no point retrying an empty wallet
      if (i === attempts) throw error;
      await new Promise((r) => setTimeout(r, 15_000 * i));
    }
  }
  throw new Error("unreachable");
}

for (const order of chapterOrders) {
  const book = (await readStore()).books[0];
  const chapter = book.chapters.find((c) => c.order === order);
  if (!chapter) throw new Error(`No chapter with order ${order}`);
  const scenes = chapter.sceneIds
    .map((id) => book.scenes.find((s) => s.id === id)!)
    .sort((a, b) => a.order - b.order);

  log(`=== ${chapter.title}: ${scenes.length} scenes ===`);

  for (const scene of scenes) {
    if (scene.imageAssetId) { log(`image skip (exists): ${scene.title}`); continue; }
    await withRetry(`image ${scene.title}`, 3, () => renderSceneImage(scene.id));
    log(`image ok: ${scene.title}`);
  }

  for (const scene of scenes) {
    if (scene.audioAssetId) { log(`audio skip (exists): ${scene.title}`); continue; }
    await withRetry(`audio ${scene.title}`, 3, () => generateSceneAudio(scene.id));
    log(`audio ok: ${scene.title}`);
  }

  if (chapter.videoAssetId) {
    log(`video skip (exists): ${chapter.title}`);
  } else {
    await withRetry(`video ${chapter.title}`, 2, () => renderChapterVideo(chapter.id));
    log(`video ok: ${chapter.title}`);
  }
  log(`=== ${chapter.title} COMPLETE ===`);
}
log("ALL REQUESTED CHAPTERS DONE");
