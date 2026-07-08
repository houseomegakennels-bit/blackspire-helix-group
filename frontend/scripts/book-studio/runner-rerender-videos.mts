import { readStore } from "@/lib/book-studio/store";
import { renderChapterVideo } from "@/lib/book-studio/service";

const orders = process.argv.slice(2).map(Number);
if (!orders.length) throw new Error("usage: runner-rerender-videos.mts <order> [order...]");

for (const order of orders) {
  const book = (await readStore()).books[0];
  const chapter = book.chapters.find((c) => c.order === order);
  if (!chapter) throw new Error(`No chapter with order ${order}`);
  if (!chapter.audioAssetId && !chapter.sceneIds.length) throw new Error(`${chapter.title} has no media yet`);
  const t0 = Date.now();
  const updated = await renderChapterVideo(chapter.id);
  const after = updated.chapters.find((c) => c.id === chapter.id)!;
  const asset = updated.assets.find((a) => a.id === after.videoAssetId);
  console.log(`rerendered ${chapter.title} in ${Math.round((Date.now() - t0) / 1000)}s -> ${asset?.relativePath}`);
}
