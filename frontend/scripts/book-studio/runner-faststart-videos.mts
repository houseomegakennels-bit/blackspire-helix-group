import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { readAssetBuffer, overwriteAssetBuffer, readStore } from "@/lib/book-studio/store";

const execFileAsync = promisify(execFile);

const orders = process.argv.slice(2).map(Number);
if (!orders.length) throw new Error("usage: runner-faststart-videos.mts <chapterOrder> [chapterOrder...]");

const tmpDir = path.join(os.tmpdir(), "book-studio-faststart");
await mkdir(tmpDir, { recursive: true });

for (const order of orders) {
  const book = (await readStore()).books[0];
  const chapter = book.chapters.find((c) => c.order === order);
  if (!chapter) throw new Error(`No chapter with order ${order}`);
  const asset = book.assets.find((a) => a.id === chapter.videoAssetId);
  if (!asset) {
    console.log(`Chapter ${order}: no video asset, skipping`);
    continue;
  }

  const inputPath = path.join(tmpDir, `${chapter.id}-in.mp4`);
  const outputPath = path.join(tmpDir, `${chapter.id}-out.mp4`);
  await writeFile(inputPath, await readAssetBuffer(asset.relativePath));

  await execFileAsync("ffmpeg", ["-y", "-i", inputPath, "-c", "copy", "-movflags", "+faststart", outputPath]);

  const fixedBytes = await readFile(outputPath);
  await overwriteAssetBuffer(asset.relativePath, fixedBytes, asset.mimeType);
  console.log(`Chapter ${order}: remuxed ${asset.relativePath} (${fixedBytes.length} bytes)`);
}
