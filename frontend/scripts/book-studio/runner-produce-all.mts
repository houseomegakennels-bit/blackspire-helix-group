import { readStore } from "@/lib/book-studio/store";
import {
  generateSceneAudio,
  publishBook,
  renderChapterVideo,
  renderSceneImage,
} from "@/lib/book-studio/service";

const startedAt = Date.now();
function log(...parts: unknown[]) {
  const t = Math.round((Date.now() - startedAt) / 1000);
  console.log(`[+${t}s]`, ...parts);
}

async function withRetry<T>(label: string, attempts: number, fn: () => Promise<T>) {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`FAIL ${label} (attempt ${i}/${attempts}): ${message.slice(0, 300)}`);
      if (i === attempts) throw error;
      await new Promise((r) => setTimeout(r, 15_000 * i));
    }
  }
  throw new Error("unreachable");
}

const store = await readStore();
const bookId = store.books[0].id;

// Phase 1 — scene images
{
  const book = (await readStore()).books.find((b) => b.id === bookId)!;
  const pending = [...book.scenes].sort((a, b) => a.order - b.order).filter((s) => !s.imageAssetId);
  log(`phase 1: ${pending.length} scene images to render`);
  let done = 0;
  for (const scene of pending) {
    await withRetry(`image ${scene.title}`, 3, () => renderSceneImage(scene.id));
    done += 1;
    log(`image ok (${done}/${pending.length}): ${scene.title}`);
  }
}

// Phase 2 — scene audio
{
  const book = (await readStore()).books.find((b) => b.id === bookId)!;
  const pending = [...book.scenes].sort((a, b) => a.order - b.order).filter((s) => !s.audioAssetId);
  log(`phase 2: ${pending.length} scene audio tracks to generate`);
  let done = 0;
  for (const scene of pending) {
    await withRetry(`audio ${scene.title}`, 3, () => generateSceneAudio(scene.id));
    done += 1;
    log(`audio ok (${done}/${pending.length}): ${scene.title}`);
  }
}

// Phase 3 — chapter videos (skip already-rendered so the run is resumable)
{
  const book = (await readStore()).books.find((b) => b.id === bookId)!;
  const pending = [...book.chapters].sort((a, b) => a.order - b.order).filter((c) => !c.videoAssetId);
  log(`phase 3: ${pending.length} chapter videos to render`);
  let done = 0;
  for (const chapter of pending) {
    await withRetry(`video ${chapter.title}`, 2, () => renderChapterVideo(chapter.id));
    done += 1;
    log(`video ok (${done}/${pending.length}): ${chapter.title}`);
  }
}

// Phase 4 — publish
const published = await publishBook(bookId);
log(`PUBLISHED: status=${published.status} slug=${published.slug} publishedAt=${published.publishedAt}`);
