import { createClient } from "@supabase/supabase-js";

const PROJECT_REF = "kchtrvfcixnimvxxctkj";
const BUCKET = "blackspire-book-studio";
const OBSOLETE_CHAPTER_VIDEO_ASSET_IDS = new Set([
  "asset_3cmlq8mrbht9zw",
  "asset_duksromraml85h",
  "asset_duvlafmraloc4d",
  "asset_fp98e8mram4cvv",
  "asset_hgjktvmraijkao",
  "asset_lx82tqmraizfd8",
  "asset_yjf37fmran2xuc",
]);

type BookRow = { id: string; slug: string; title: string; status: string; manuscript_asset_id: string | null; cover_asset_id: string | null };
type AssetRow = { id: string; book_id: string; kind: string; relative_path: string; metadata: Record<string, unknown> | null };
type ReferenceRow = { id: string; asset_id: string; source_reference_id: string | null };
type CharacterRow = { canonical_reference_id: string | null; backup_reference_ids: string[] | null };
type ChapterRow = { id: string; audio_asset_id: string | null; video_asset_id: string | null };
type SceneRow = { image_asset_id: string | null; audio_asset_id: string | null; render_manifest: Record<string, unknown> | null };
type StorageObjectRow = { name: string; metadata: Record<string, unknown> | null };

type Candidate = {
  path: string;
  bytes: number;
  reason: string;
  assetId: string | null;
  kind: string | null;
};

const mode = process.argv.includes("--execute") ? "execute" : "dry-run";
if (!process.argv.includes("--dry-run") && !process.argv.includes("--execute")) {
  throw new Error("Usage: npx tsx scripts/book-studio/storage-cleanup.mts --dry-run|--execute");
}

function env(name: string) {
  return process.env[name]?.trim() || "";
}

function requiredEnv(name: string) {
  const value = env(name);
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function sizeFromMetadata(metadata: Record<string, unknown> | null) {
  const size = metadata?.size;
  return typeof size === "number" ? size : Number(size) || 0;
}

function addMaybe(set: Set<string>, value: string | null | undefined) {
  if (value) set.add(value);
}

function addArray(set: Set<string>, value: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) if (typeof item === "string" && item) set.add(item);
  }
}

function collectManifestRefs(set: Set<string>, manifest: Record<string, unknown> | null) {
  if (!manifest) return;
  addArray(set, manifest.characterReferenceIds);
  addArray(set, manifest.sceneReferenceIds);
  addArray(set, manifest.moodReferenceIds);
  addArray(set, manifest.visualAnchorReferenceIds);
}

async function selectAll<T>(table: string, columns: string) {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`Unable to read ${table}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

async function selectStorageObjects() {
  const out: StorageObjectRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("storage.objects")
      .select("name,metadata")
      .eq("bucket_id", BUCKET)
      .range(from, from + 999);
    if (error) throw new Error(`Unable to read storage.objects: ${error.message}`);
    out.push(...((data ?? []) as StorageObjectRow[]));
    if (!data || data.length < 1000) return out;
  }
}

const supabaseUrl = env("SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL") || `https://${PROJECT_REF}.supabase.co`;
if (!supabaseUrl.includes(PROJECT_REF)) {
  throw new Error(`Refusing to run against unexpected Supabase project URL: ${supabaseUrl}`);
}
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const [books, assets, references, characters, chapters, scenes, storageObjects] = await Promise.all([
  selectAll<BookRow>("book_studio_books", "id,slug,title,status,manuscript_asset_id,cover_asset_id"),
  selectAll<AssetRow>("book_studio_assets", "id,book_id,kind,relative_path,metadata"),
  selectAll<ReferenceRow>("book_studio_references", "id,asset_id,source_reference_id"),
  selectAll<CharacterRow>("book_studio_characters", "canonical_reference_id,backup_reference_ids"),
  selectAll<ChapterRow>("book_studio_chapters", "id,audio_asset_id,video_asset_id"),
  selectAll<SceneRow>("book_studio_scenes", "image_asset_id,audio_asset_id,render_manifest"),
  selectStorageObjects().then((rows) =>
    rows.filter((row) => row.name && !row.name.endsWith("/") && row.name !== ".emptyFolderPlaceholder"),
  ),
]);

const assetById = new Map(assets.map((asset) => [asset.id, asset]));
const assetByPath = new Map(assets.map((asset) => [asset.relative_path, asset]));
const objectByPath = new Map(storageObjects.map((object) => [object.name, object]));
const referencedAssetIds = new Set<string>();
const referencedReferenceIds = new Set<string>();

for (const book of books) {
  addMaybe(referencedAssetIds, book.manuscript_asset_id);
  addMaybe(referencedAssetIds, book.cover_asset_id);
}
for (const reference of references) {
  addMaybe(referencedAssetIds, reference.asset_id);
  addMaybe(referencedReferenceIds, reference.id);
  addMaybe(referencedReferenceIds, reference.source_reference_id);
}
for (const character of characters) {
  addMaybe(referencedReferenceIds, character.canonical_reference_id);
  addArray(referencedReferenceIds, character.backup_reference_ids);
}
for (const chapter of chapters) {
  addMaybe(referencedAssetIds, chapter.audio_asset_id);
  addMaybe(referencedAssetIds, chapter.video_asset_id);
}
for (const scene of scenes) {
  addMaybe(referencedAssetIds, scene.image_asset_id);
  addMaybe(referencedAssetIds, scene.audio_asset_id);
  collectManifestRefs(referencedReferenceIds, scene.render_manifest);
}
for (const referenceId of referencedReferenceIds) {
  const reference = references.find((candidate) => candidate.id === referenceId);
  addMaybe(referencedAssetIds, reference?.asset_id);
}

const candidates = new Map<string, Candidate>();
for (const object of storageObjects) {
  if (!assetByPath.has(object.name)) {
    candidates.set(object.name, {
      path: object.name,
      bytes: sizeFromMetadata(object.metadata),
      reason: "orphaned_storage_object_no_book_studio_asset_row",
      assetId: null,
      kind: null,
    });
  }
}
for (const assetId of OBSOLETE_CHAPTER_VIDEO_ASSET_IDS) {
  const asset = assetById.get(assetId);
  if (!asset) continue;
  if (referencedAssetIds.has(asset.id)) continue;
  if (asset.kind !== "chapter_video") continue;
  const object = objectByPath.get(asset.relative_path);
  candidates.set(asset.relative_path, {
    path: asset.relative_path,
    bytes: sizeFromMetadata(object?.metadata ?? asset.metadata),
    reason: "obsolete_superseded_chapter_video_asset_unreferenced",
    assetId: asset.id,
    kind: asset.kind,
  });
}
for (const asset of assets) {
  if (referencedAssetIds.has(asset.id)) continue;
  if (candidates.has(asset.relative_path)) continue;
  if (!objectByPath.has(asset.relative_path)) continue;
  candidates.set(asset.relative_path, {
    path: asset.relative_path,
    bytes: sizeFromMetadata(objectByPath.get(asset.relative_path)?.metadata ?? asset.metadata),
    reason: "unreferenced_book_studio_asset_row",
    assetId: asset.id,
    kind: asset.kind,
  });
}

const report = [...candidates.values()].sort((a, b) => a.path.localeCompare(b.path));
const protectedAssetIds = [...referencedAssetIds].filter((id) => assetById.has(id));
const brokenReferences = protectedAssetIds
  .map((id) => assetById.get(id))
  .filter((asset): asset is AssetRow => Boolean(asset))
  .filter((asset) => !objectByPath.has(asset.relative_path));

const totalBytes = report.reduce((sum, candidate) => sum + candidate.bytes, 0);
console.log(JSON.stringify({
  mode,
  projectRef: PROJECT_REF,
  bucket: BUCKET,
  bookCount: books.length,
  publishedBooks: books.filter((book) => book.status === "Published").map((book) => ({ id: book.id, slug: book.slug, title: book.title })),
  storageBefore: { objectCount: storageObjects.length, totalBytes: storageObjects.reduce((sum, object) => sum + sizeFromMetadata(object.metadata), 0) },
  candidates: { count: report.length, totalBytes, files: report },
  verification: {
    referencedAssetIds: protectedAssetIds.length,
    candidateReferencedByCurrentData: report.filter((candidate) => candidate.assetId && referencedAssetIds.has(candidate.assetId)),
    brokenActiveAssetReferences: brokenReferences.map((asset) => ({ id: asset.id, kind: asset.kind, path: asset.relative_path })),
  },
}, null, 2));

if (mode === "execute") {
  if (report.some((candidate) => candidate.assetId && referencedAssetIds.has(candidate.assetId))) {
    throw new Error("Refusing to execute: at least one candidate is currently referenced.");
  }
  const paths = report.map((candidate) => candidate.path);
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await supabase.storage.from(BUCKET).remove(paths.slice(i, i + 100));
    if (error) throw new Error(`Storage deletion failed: ${error.message}`);
  }
  const assetIdsToDelete = report.map((candidate) => candidate.assetId).filter((id): id is string => Boolean(id));
  if (assetIdsToDelete.length) {
    const { error } = await supabase.from("book_studio_assets").delete().in("id", assetIdsToDelete);
    if (error) throw new Error(`Asset row deletion failed after Storage API deletion: ${error.message}`);
  }
  console.log(JSON.stringify({ executed: true, deletedFiles: paths, reclaimedBytes: totalBytes }, null, 2));
}
