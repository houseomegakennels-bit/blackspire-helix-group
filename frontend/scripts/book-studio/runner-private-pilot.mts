/** Operator-driven, private, single-chapter pilot. No publish, delete, or overwrite action. */
import { readFile, writeFile, mkdir, rmdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { verifyVideoFile, probeAudioSeconds } from "./media-qa.mjs";
import { planPrivateChapter, assertGenerationApproval, writeVerifiedBackup, verifyReusedAssets } from "./pilot-core.mjs";

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
if (!process.env.BOOK_STUDIO_LOCAL_ROOT || !path.isAbsolute(process.env.BOOK_STUDIO_LOCAL_ROOT)) throw new Error("Explicit BOOK_STUDIO_LOCAL_ROOT is required.");
const { getBookById, readAssetBuffer, mutateBookRecord, readStore } = await import("@/lib/book-studio/store");
const initial = await getBookById(bookId);
const { privateProductionInputs } = await import("@/lib/book-studio/service");
const scopedPlan = async (book: typeof initial) => {
  const scope = planPrivateChapter(book, bookId, order);
  const all = await readStore();
  if (all.books.some((other) => other.id !== bookId && (other.chapters.some((c) => c.id === scope.chapterId) || other.scenes.some((s) => scope.sceneIds.includes(s.id))))) throw new Error("Ambiguous cross-book service identifiers.");
  const inputs = await privateProductionInputs(book!, scope.sceneIds);
  if (inputs.some((input) => scope.missingAudio.includes(input.id) && input.voice !== "onyx")) throw new Error("Pilot narration requires an explicit Onyx character voice assignment.");
  return planPrivateChapter(book, bookId, order, inputs);
};
const plan = await scopedPlan(initial);
console.log(JSON.stringify({ ...plan, reusedAssets: plan.reusedAssets.map((asset) => asset.id), mode: execute ? "execute-private" : "plan-only" }, null, 2));
if (!execute) process.exit(0);
const approvalPath = flags.get("--approval");
if (!approvalPath) throw new Error("A source-bound human approval file is required, including for a reuse-only run.");
const approval = JSON.parse(await readFile(approvalPath, "utf8"));
assertGenerationApproval(plan, approval);
await exec("ffmpeg", ["-version"]);
await exec("ffprobe", ["-version"]);
await mkdir(backupRoot, { recursive: true, mode: 0o700 });
const lockRoot = path.join(process.env.BOOK_STUDIO_LOCAL_ROOT, "pilot-locks");
await mkdir(lockRoot, { recursive: true, mode: 0o700 });
const lock = path.join(lockRoot, `${bookId}-${plan.chapterId}.lock`);
await mkdir(lock); // Single-host fence; stale locks are operator-reviewed, never auto-deleted.
let completed = false;
try {
  // Asset IDs alone are not proof of reusable media: verify actual nonempty bytes first.
  await verifyReusedAssets(plan, approval, readAssetBuffer);
  const stamp = async (ids: Array<string | null>) => mutateBookRecord(bookId, async (book) => {
    for (const id of ids.filter(Boolean)) {
      const asset = book.assets.find((item) => item.id === id);
      if (!asset) throw new Error("Generated asset missing.");
      asset.metadata = { ...asset.metadata, releaseStatus: "private", pilotSourceDigest: plan.sourceDigest,
        pilotSha256: createHash("sha256").update(await readAssetBuffer(asset.relativePath)).digest("hex") };
    }
  });
  const { withPrivateProviderGuard } = await import("@/lib/book-studio/private-provider-guard");
  const { renderSceneImage, generateSceneAudio, renderChapterVideo } = await import("@/lib/book-studio/service");
  const fresh = async () => {
    const book = await getBookById(bookId);
    const current = await scopedPlan(book);
    if (current.sourceDigest !== plan.sourceDigest) throw new Error("Creative inputs changed; new approval required.");
    const currentApproval = JSON.parse(await readFile(approvalPath, "utf8"));
    assertGenerationApproval(current, currentApproval);
    await verifyReusedAssets(current, currentApproval, readAssetBuffer);
    return { book: book!, current };
  };
  // No automatic provider retries: ambiguous responses require review, not duplicate charges.
  for (const sceneId of plan.missingImages) {
    await fresh();
    const rendered = await withPrivateProviderGuard(fresh, () => renderSceneImage(sceneId));
    await stamp([rendered.scenes.find((scene) => scene.id === sceneId)!.imageAssetId]);
  }
  for (const sceneId of plan.missingAudio) {
    await fresh();
    const rendered = await withPrivateProviderGuard(fresh, () => generateSceneAudio(sceneId));
    await stamp([rendered.scenes.find((scene) => scene.id === sceneId)!.audioAssetId]);
  }
  const beforeVideo = await fresh();
  if (beforeVideo.current.missingImages.length || beforeVideo.current.missingAudio.length) throw new Error("Scene generation did not produce every required asset.");
  if (beforeVideo.current.needsVideo) {
    const rendered = await withPrivateProviderGuard(fresh, () => renderChapterVideo(plan.chapterId));
    const chapter = rendered.chapters.find((item) => item.id === plan.chapterId)!;
    await stamp([chapter.videoAssetId, chapter.audioAssetId]);
  }
  await fresh();
  await mutateBookRecord(bookId, async (book) => {
    const current = await scopedPlan(book);
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
  for (const reference of book.references.filter((item) => item.approved && item.source !== "scene_generation")) {
    const asset = book.assets.find((item) => item.id === reference.assetId);
    if (!asset) throw new Error("Canonical reference asset missing.");
    const name = `${asset.id}-${path.basename(asset.relativePath)}`;
    if (!entries.some((item) => item.name === name)) entries.push({ name, bytes: await readAssetBuffer(asset.relativePath) });
  }
  entries.push({ name: "chapter-source.json", bytes: Buffer.from(JSON.stringify({ bookId, chapter, scenes: book.scenes.filter((item) => plan.sceneIds.includes(item.id)), characters: book.characters, references: book.references, style: book.styleProfile }, null, 2)) });
  const destination = path.join(backupRoot, `PRIVATE-${bookId}-chapter-${String(order).padStart(2, "0")}-${randomUUID()}`);
  const manifest = await writeVerifiedBackup(destination, entries, { bookId, chapterId: plan.chapterId, sourceDigest: plan.sourceDigest });
  const videoPath = path.join(destination, videoFilename);
  let expectedAudioSeconds = 0;
  for (const scene of book.scenes.filter((item) => plan.sceneIds.includes(item.id))) {
    const asset = book.assets.find((item) => item.id === scene.audioAssetId)!;
    expectedAudioSeconds += await probeAudioSeconds(path.join(destination, `${asset.id}-${path.basename(asset.relativePath)}`));
  }
  const technical = await verifyVideoFile(videoPath, expectedAudioSeconds);
  await writeFile(path.join(destination, "qa.json"), JSON.stringify({ videoSha256: manifest.files.find((item) => item.name === videoFilename)!.sha256, ...technical,
    expectedAudioSeconds, narrationCoverage: "Scene audio duration checked; human text/pronunciation review still required", playbackReviewedBy: null, narrationReviewedBy: null, published: false }, null, 2), { flag: "wx", mode: 0o600 });
  const qaBytes = await readFile(path.join(destination, "qa.json"));
  manifest.files.push({ name: "qa.json", bytes: qaBytes.length, sha256: createHash("sha256").update(qaBytes).digest("hex"), md5: createHash("md5").update(qaBytes).digest("hex") });
  await writeFile(path.join(destination, "manifest.json"), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  completed = true;
  console.log(JSON.stringify({ status: "PRIVATE_LOCAL_BACKUP_COMPLETE", destination, files: manifest.files.length, fullDecodePassed: true, narrationReviewed: false, driveBackupVerified: false, published: false }, null, 2));
} finally {
  if (completed) await rmdir(lock); // Failed/interrupted runs retain the fence for operator reconciliation.
}
