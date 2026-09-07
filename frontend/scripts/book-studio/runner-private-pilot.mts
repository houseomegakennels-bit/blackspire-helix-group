/** Operator-driven, private, single-chapter pilot. No publish, delete, or overwrite action. */
import { readFile, writeFile, mkdir, rmdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { planPrivateChapter, assertGenerationApproval, writeVerifiedBackup } from "./pilot-core.mjs";

const exec = promisify(execFile);
const flags = new Map<string, string>();
let execute = false;
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (key === "--execute") { if (execute) throw new Error("Duplicate --execute"); execute = true; continue; }
  if (!["--book", "--chapter", "--backup-root", "--approval"].includes(key) || flags.has(key) || !process.argv[i + 1] || process.argv[i + 1].startsWith("--")) {
    throw new Error("Usage: runner-private-pilot.mts --book ID --chapter N --backup-root /PRIVATE/DIR [--execute --approval /PRIVATE/approval.json]");
  }
  flags.set(key, process.argv[++i]);
}
const bookId = flags.get("--book") || "";
const order = Number(flags.get("--chapter"));
const backupRoot = flags.get("--backup-root");
if (!bookId || !Number.isSafeInteger(order) || order < 1 || !backupRoot || !path.isAbsolute(backupRoot)) throw new Error("Explicit book, chapter, and absolute backup root are required.");
// Fail closed: a private staging run must never inherit live Supabase settings.
// Remote/private mode is intentionally not implemented until access-control rollout is verified.
if (["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "VERCEL"].some((key) => process.env[key]?.trim())) {
  throw new Error("Private pilot is staging-only. Use a separate local store without Supabase/Vercel credentials; remote execution is not enabled.");
}
const { getBookById, readAssetBuffer, mutateBookRecord } = await import("@/lib/book-studio/store");
const initial = await getBookById(bookId);
const plan = planPrivateChapter(initial, bookId, order);
console.log(JSON.stringify({ ...plan, reusedAssets: plan.reusedAssets.map((asset) => asset.id), mode: execute ? "execute-private" : "plan-only" }, null, 2));
if (!execute) process.exit(0);
const approvalPath = flags.get("--approval");
if (!approvalPath) throw new Error("A source-bound human approval file is required, including for a reuse-only run.");
const approval = JSON.parse(await readFile(approvalPath, "utf8"));
assertGenerationApproval(plan, approval);
await exec("ffmpeg", ["-version"]);
await exec("ffprobe", ["-version"]);
await mkdir(backupRoot, { recursive: true, mode: 0o700 });
const lockRoot = path.join(process.cwd(), "data", "book-studio", "pilot-locks");
await mkdir(lockRoot, { recursive: true, mode: 0o700 });
const lock = path.join(lockRoot, `${bookId}-${plan.chapterId}.lock`);
await mkdir(lock); // Single-host fence; stale locks are operator-reviewed, never auto-deleted.
try {
  // Asset IDs alone are not proof of reusable media: verify actual nonempty bytes first.
  for (const asset of plan.reusedAssets) {
    const bytes = await readAssetBuffer(asset.relativePath);
    if (!bytes.length) throw new Error(`Existing media is empty: ${asset.id}`);
  }
  const { renderSceneImage, generateSceneAudio, renderChapterVideo } = await import("@/lib/book-studio/service");
  const fresh = async () => {
    const book = await getBookById(bookId);
    const current = planPrivateChapter(book, bookId, order);
    if (current.sourceDigest !== plan.sourceDigest) throw new Error("Creative inputs changed; new approval required.");
    assertGenerationApproval(current, approval);
    return { book: book!, current };
  };
  // No automatic provider retries: ambiguous responses require review, not duplicate charges.
  for (const sceneId of plan.missingImages) {
    await fresh();
    await renderSceneImage(sceneId);
  }
  for (const sceneId of plan.missingAudio) {
    await fresh();
    await generateSceneAudio(sceneId);
  }
  const beforeVideo = await fresh();
  if (beforeVideo.current.missingImages.length || beforeVideo.current.missingAudio.length) throw new Error("Scene generation did not produce every required asset.");
  if (beforeVideo.current.needsVideo) await renderChapterVideo(plan.chapterId);
  await fresh();
  await mutateBookRecord(bookId, (book) => {
    const current = planPrivateChapter(book, bookId, order);
    if (current.sourceDigest !== plan.sourceDigest) throw new Error("Source changed before finalization.");
    const chapter = book.chapters.find((item) => item.id === plan.chapterId)!;
    for (const id of [chapter.videoAssetId, chapter.audioAssetId].filter(Boolean)) {
      const asset = book.assets.find((item) => item.id === id);
      if (!asset) throw new Error("Finished chapter asset is missing.");
      asset.metadata = { ...asset.metadata, releaseStatus: "private", pilotSourceDigest: plan.sourceDigest };
    }
  });
  const { book } = await fresh();
  const chapter = book.chapters.find((item) => item.id === plan.chapterId)!;
  const ids = new Set<string>();
  for (const id of [chapter.videoAssetId, chapter.audioAssetId]) if (id) ids.add(id);
  for (const scene of book.scenes.filter((item) => plan.sceneIds.includes(item.id))) {
    for (const id of [scene.imageAssetId, scene.audioAssetId]) if (id) ids.add(id);
  }
  const entries: Array<{ name: string; bytes: Buffer }> = [];
  let videoFilename = "";
  for (const id of ids) {
    const asset = book.assets.find((item) => item.id === id)!;
    const filename = `${asset.id}-${path.basename(asset.relativePath)}`;
    if (id === chapter.videoAssetId) videoFilename = filename;
    entries.push({ name: filename, bytes: await readAssetBuffer(asset.relativePath) });
  }
  if (!videoFilename) throw new Error("No completed MP4; run is not complete.");
  entries.push({ name: "chapter-source.json", bytes: Buffer.from(JSON.stringify({ bookId, chapter, scenes: book.scenes.filter((item) => plan.sceneIds.includes(item.id)), characters: book.characters, references: book.references, style: book.styleProfile }, null, 2)) });
  const destination = path.join(backupRoot, `PRIVATE-${bookId}-chapter-${String(order).padStart(2, "0")}-${randomUUID()}`);
  const manifest = await writeVerifiedBackup(destination, entries, { bookId, chapterId: plan.chapterId, sourceDigest: plan.sourceDigest });
  const videoPath = path.join(destination, videoFilename);
  const probe = JSON.parse((await exec("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", videoPath])).stdout);
  const video = probe.streams.find((stream: { codec_type: string }) => stream.codec_type === "video");
  const audio = probe.streams.find((stream: { codec_type: string }) => stream.codec_type === "audio");
  if (!video || !audio || !Number.isFinite(Number(probe.format.duration)) || Number(probe.format.duration) <= 0) throw new Error("Finished media lacks valid video/audio streams.");
  if (!Number.isFinite(Number(video.duration)) || !Number.isFinite(Number(audio.duration)) || Number(video.duration) + 0.5 < Number(audio.duration)) throw new Error("Video/audio duration verification failed.");
  await exec("ffmpeg", ["-v", "error", "-xerror", "-i", videoPath, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"], { maxBuffer: 1024 * 1024 });
  await writeFile(path.join(destination, "qa.json"), JSON.stringify({ videoSha256: manifest.files.find((item) => item.name === videoFilename)!.sha256, fullDecodePassed: true, durationSeconds: Number(probe.format.duration), playbackReviewedBy: null, narrationReviewedBy: null, published: false }, null, 2), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ status: "PRIVATE_LOCAL_BACKUP_COMPLETE", destination, files: manifest.files.length, fullDecodePassed: true, narrationReviewed: false, driveBackupVerified: false, published: false }, null, 2));
} finally {
  await rmdir(lock);
}
