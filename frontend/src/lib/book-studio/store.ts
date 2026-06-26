import "server-only";

import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type {
  AssetKind,
  AssetRecord,
  BookListItem,
  BookRecord,
  BookStudioStore,
  CharacterBible,
  CharacterSex,
  CharacterStatus,
  ReferenceRecord,
  RenderManifest,
  SceneCharacterModifier,
  SceneRecord,
  VoiceAssignment,
} from "@/lib/book-studio/types";

const STORE_VERSION = 1 as const;
const STORE_ROOT = path.join(process.cwd(), "data", "book-studio");
const STORE_FILE = path.join(STORE_ROOT, "store.json");
const ASSET_ROOT = path.join(STORE_ROOT, "assets");
const BOOK_STUDIO_BUCKET = "blackspire-book-studio";
const BOOKS_TABLE = "book_studio_books";
const ASSETS_TABLE = "book_studio_assets";
const REFERENCES_TABLE = "book_studio_references";
const CHARACTERS_TABLE = "book_studio_characters";
const CHAPTERS_TABLE = "book_studio_chapters";
const SCENES_TABLE = "book_studio_scenes";

function nowIso() {
  return new Date().toISOString();
}

export function createId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`;
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 64) || createId("book");
}

async function ensureStoreFiles() {
  await mkdir(ASSET_ROOT, { recursive: true });
  try {
    await stat(STORE_FILE);
  } catch {
    const initial: BookStudioStore = { version: STORE_VERSION, books: [], updatedAt: nowIso() };
    await writeFile(STORE_FILE, JSON.stringify(initial, null, 2), "utf8");
  }
}

function hasSupabaseStoreEnv() {
  return Boolean(process.env.SUPABASE_URL?.trim() && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
}

function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("Missing Supabase server credentials for Book Studio.");
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function ensureBookStudioBucket(supabase: SupabaseClient) {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) {
    throw new Error(`Unable to list storage buckets: ${error.message}`);
  }

  const existingBucket = (buckets ?? []).find((bucket) => bucket.name === BOOK_STUDIO_BUCKET);
  if (!existingBucket) {
    const { error: createError } = await supabase.storage.createBucket(BOOK_STUDIO_BUCKET, {
      public: false,
    });

    if (createError && !createError.message.toLowerCase().includes("already exists")) {
      throw new Error(`Unable to create Book Studio bucket: ${createError.message}`);
    }
  }
}

async function uploadRemoteBytes(
  supabase: SupabaseClient,
  remotePath: string,
  bytes: Blob | Buffer | string,
  contentType: string,
) {
  const { error } = await supabase.storage.from(BOOK_STUDIO_BUCKET).upload(remotePath, bytes, {
    contentType,
    upsert: true,
  });

  if (error) {
    throw new Error(`Unable to upload Book Studio asset: ${error.message}`);
  }
}

async function ensureRemoteBookStudioStorage() {
  const supabase = getSupabaseAdmin();
  await ensureBookStudioBucket(supabase);
  return supabase;
}

async function isDatabaseReady(supabase: SupabaseClient) {
  const { error } = await supabase.from(BOOKS_TABLE).select("id").limit(1);
  return !error;
}

type BookRow = {
  id: string;
  slug: string;
  title: string;
  synopsis: string;
  status: BookRecord["status"];
  manuscript_text: string;
  manuscript_asset_id: string | null;
  cover_asset_id: string | null;
  visual_direction: string;
  palette: string;
  medium: string;
  tone: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

type AssetRow = {
  id: string;
  book_id: string;
  kind: AssetRecord["kind"];
  label: string;
  mime_type: string;
  relative_path: string;
  metadata: Record<string, string | number | boolean | null> | null;
  created_at: string;
};

type ReferenceRow = {
  id: string;
  book_id: string;
  asset_id: string;
  source: ReferenceRecord["source"];
  role: ReferenceRecord["role"];
  approved: boolean;
  character_ids: string[] | null;
  scene_ids: string[] | null;
  chapter_ids?: string[] | null;
  source_reference_id?: string | null;
  derivation_kind?: ReferenceRecord["derivationKind"] | null;
  derivation_status?: ReferenceRecord["derivationStatus"] | null;
  confidence?: number | null;
  label?: string | null;
  crop?: ReferenceRecord["crop"] | null;
  notes: string;
};

type CharacterRow = {
  id: string;
  book_id: string;
  name: string;
  aliases: string[] | null;
  core_description: string;
  age_range: string;
  sex: CharacterSex;
  facial_traits: string;
  body_traits: string;
  hair: string;
  vibe: string;
  continuity_notes: string;
  required_for_render: boolean;
  status: CharacterStatus;
  canonical_reference_id: string | null;
  backup_reference_ids: string[] | null;
  voice_assignment: VoiceAssignment | null;
};

type ChapterRow = {
  id: string;
  book_id: string;
  chapter_order: number;
  title: string;
  summary: string;
  audio_asset_id: string | null;
  video_asset_id: string | null;
};

type SceneRow = {
  id: string;
  book_id: string;
  chapter_id: string;
  scene_order: number;
  title: string;
  source_text: string;
  summary: string;
  mood: string;
  location: string;
  time_of_day: string;
  character_ids: string[] | null;
  modifiers: SceneCharacterModifier[] | null;
  image_prompt: string;
  image_status: SceneRecord["imageStatus"];
  audio_status: SceneRecord["audioStatus"];
  review_status: SceneRecord["reviewStatus"];
  priority: SceneRecord["priority"];
  image_asset_id: string | null;
  audio_asset_id: string | null;
  estimated_duration_seconds: number;
  render_manifest: RenderManifest | null;
};

const CHAPTER_LINK_NOTE_PREFIX = "[chapter-link:";
const SOURCE_REFERENCE_NOTE_PREFIX = "[source-reference:";
const DERIVATION_KIND_NOTE_PREFIX = "[derivation-kind:";
const DERIVATION_STATUS_NOTE_PREFIX = "[derivation-status:";
const CONFIDENCE_NOTE_PREFIX = "[confidence:";
const LABEL_NOTE_PREFIX = "[reference-label:";
const CROP_NOTE_PREFIX = "[crop:";

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function decodeReferenceNotes(reference: ReferenceRow) {
  const detectedChapterIds = [...(reference.chapter_ids ?? [])];
  let sourceReferenceId = reference.source_reference_id ?? null;
  let derivationKind = reference.derivation_kind ?? "none";
  let derivationStatus = reference.derivation_status ?? "approved";
  let confidence = typeof reference.confidence === "number" ? reference.confidence : null;
  let label = reference.label ?? null;
  let crop = reference.crop ?? null;
  const cleanedLines = reference.notes
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      let match = line.match(/^\[chapter-link:(.+?)\]$/);
      if (match) {
        detectedChapterIds.push(match[1]);
        return false;
      }

      match = line.match(/^\[source-reference:(.+?)\]$/);
      if (match) {
        sourceReferenceId = match[1] || null;
        return false;
      }

      match = line.match(/^\[derivation-kind:(.+?)\]$/);
      if (match) {
        derivationKind = (match[1] as ReferenceRecord["derivationKind"]) || "none";
        return false;
      }

      match = line.match(/^\[derivation-status:(.+?)\]$/);
      if (match) {
        derivationStatus = (match[1] as ReferenceRecord["derivationStatus"]) || "approved";
        return false;
      }

      match = line.match(/^\[confidence:(.+?)\]$/);
      if (match) {
        const parsed = Number.parseFloat(match[1]);
        confidence = Number.isFinite(parsed) ? parsed : null;
        return false;
      }

      match = line.match(/^\[reference-label:(.+?)\]$/);
      if (match) {
        label = match[1] || null;
        return false;
      }

      match = line.match(/^\[crop:(.+?)\]$/);
      if (match) {
        try {
          const parsed = JSON.parse(match[1]) as ReferenceRecord["crop"];
          if (
            parsed &&
            typeof parsed.x === "number" &&
            typeof parsed.y === "number" &&
            typeof parsed.width === "number" &&
            typeof parsed.height === "number"
          ) {
            crop = parsed;
          }
        } catch {
          crop = null;
        }
        return false;
      }

      return true;
    });

  return {
    notes: cleanedLines.join("\n").trim(),
    chapterIds: uniqueStrings(detectedChapterIds),
    sourceReferenceId,
    derivationKind,
    derivationStatus,
    confidence,
    label,
    crop,
  };
}

function encodeReferenceNotes(reference: ReferenceRecord) {
  return [
    reference.notes.trim(),
    ...uniqueStrings(reference.chapterIds).map((chapterId) => `${CHAPTER_LINK_NOTE_PREFIX}${chapterId}]`),
    reference.sourceReferenceId ? `${SOURCE_REFERENCE_NOTE_PREFIX}${reference.sourceReferenceId}]` : "",
    reference.derivationKind !== "none" ? `${DERIVATION_KIND_NOTE_PREFIX}${reference.derivationKind}]` : "",
    reference.derivationStatus !== "approved" ? `${DERIVATION_STATUS_NOTE_PREFIX}${reference.derivationStatus}]` : "",
    typeof reference.confidence === "number" ? `${CONFIDENCE_NOTE_PREFIX}${reference.confidence}]` : "",
    reference.label ? `${LABEL_NOTE_PREFIX}${reference.label}]` : "",
    reference.crop ? `${CROP_NOTE_PREFIX}${JSON.stringify(reference.crop)}]` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function toBookRecord({
  book,
  assets,
  references,
  characters,
  chapters,
  scenes,
}: {
  book: BookRow;
  assets: AssetRow[];
  references: ReferenceRow[];
  characters: CharacterRow[];
  chapters: ChapterRow[];
  scenes: SceneRow[];
}): BookRecord {
  const mappedAssets: AssetRecord[] = assets.map((asset) => ({
    id: asset.id,
    kind: asset.kind,
    label: asset.label,
    mimeType: asset.mime_type,
    relativePath: asset.relative_path,
    createdAt: asset.created_at,
    metadata: asset.metadata ?? undefined,
  }));

  const mappedReferences: ReferenceRecord[] = references.map((reference) => ({
    ...decodeReferenceNotes(reference),
    id: reference.id,
    assetId: reference.asset_id,
    source: reference.source,
    role: reference.role,
    approved: reference.approved,
    characterIds: reference.character_ids ?? [],
    sceneIds: reference.scene_ids ?? [],
  }));

  const mappedCharacters: CharacterBible[] = characters.map((character) => ({
    id: character.id,
    name: character.name,
    aliases: character.aliases ?? [],
    coreDescription: character.core_description,
    ageRange: character.age_range,
    sex: character.sex,
    facialTraits: character.facial_traits,
    bodyTraits: character.body_traits,
    hair: character.hair,
    vibe: character.vibe,
    continuityNotes: character.continuity_notes,
    requiredForRender: character.required_for_render,
    status: character.status,
    canonicalReferenceId: character.canonical_reference_id,
    backupReferenceIds: character.backup_reference_ids ?? [],
    voiceAssignment: character.voice_assignment ?? null,
  }));

  const mappedScenes: SceneRecord[] = scenes
    .sort((left, right) => left.scene_order - right.scene_order)
    .map((scene) => ({
      id: scene.id,
      chapterId: scene.chapter_id,
      order: scene.scene_order,
      title: scene.title,
      sourceText: scene.source_text,
      summary: scene.summary,
      mood: scene.mood,
      location: scene.location,
      timeOfDay: scene.time_of_day,
      characterIds: scene.character_ids ?? [],
      modifiers: scene.modifiers ?? [],
      imagePrompt: scene.image_prompt,
      imageStatus: scene.image_status,
      audioStatus: scene.audio_status,
      reviewStatus: scene.review_status,
      priority: scene.priority,
      imageAssetId: scene.image_asset_id,
      audioAssetId: scene.audio_asset_id,
      estimatedDurationSeconds: scene.estimated_duration_seconds,
      renderManifest: scene.render_manifest ?? null,
    }));

  const scenesByChapter = new Map<string, string[]>();
  mappedScenes.forEach((scene) => {
    const current = scenesByChapter.get(scene.chapterId) ?? [];
    current.push(scene.id);
    scenesByChapter.set(scene.chapterId, current);
  });

  const mappedChapters = chapters
    .sort((left, right) => left.chapter_order - right.chapter_order)
    .map((chapter) => ({
      id: chapter.id,
      order: chapter.chapter_order,
      title: chapter.title,
      summary: chapter.summary,
      sceneIds: scenesByChapter.get(chapter.id) ?? [],
      audioAssetId: chapter.audio_asset_id,
      videoAssetId: chapter.video_asset_id,
    }));

  return {
    id: book.id,
    slug: book.slug,
    title: book.title,
    synopsis: book.synopsis,
    status: book.status,
    manuscriptText: book.manuscript_text,
    manuscriptAssetId: book.manuscript_asset_id,
    coverAssetId: book.cover_asset_id,
    styleProfile: {
      visualDirection: book.visual_direction,
      palette: book.palette,
      medium: book.medium,
      tone: book.tone,
    },
    chapters: mappedChapters,
    scenes: mappedScenes,
    characters: mappedCharacters,
    references: mappedReferences,
    assets: mappedAssets,
    createdAt: book.created_at,
    updatedAt: book.updated_at,
    publishedAt: book.published_at,
  };
}

function normalizeBookRecord(book: BookRecord): BookRecord {
  return {
    ...book,
    references: (book.references ?? []).map((reference) => ({
      ...reference,
      characterIds: reference.characterIds ?? [],
      sceneIds: reference.sceneIds ?? [],
      chapterIds: reference.chapterIds ?? [],
      sourceReferenceId: reference.sourceReferenceId ?? null,
      derivationKind: reference.derivationKind ?? "none",
      derivationStatus: reference.derivationStatus ?? "approved",
      confidence: typeof reference.confidence === "number" ? reference.confidence : null,
      label: reference.label ?? null,
      crop: reference.crop ?? null,
      notes: reference.notes ?? "",
    })),
  };
}

async function loadBooksFromDatabase(supabase: SupabaseClient, where?: { column: "id" | "slug"; value: string }) {
  let query = supabase.from(BOOKS_TABLE).select("*");
  if (where) {
    query = query.eq(where.column, where.value);
  }
  const { data: bookRows, error } = await query.order("updated_at", { ascending: false });
  if (error) {
    throw new Error(`Unable to load Book Studio books: ${error.message}`);
  }

  const books = (bookRows ?? []) as BookRow[];
  if (!books.length) return [];
  const bookIds = books.map((book) => book.id);

  const [
    { data: assetRows, error: assetError },
    { data: referenceRows, error: referenceError },
    { data: characterRows, error: characterError },
    { data: chapterRows, error: chapterError },
    { data: sceneRows, error: sceneError },
  ] = await Promise.all([
    supabase.from(ASSETS_TABLE).select("*").in("book_id", bookIds),
    supabase.from(REFERENCES_TABLE).select("*").in("book_id", bookIds),
    supabase.from(CHARACTERS_TABLE).select("*").in("book_id", bookIds),
    supabase.from(CHAPTERS_TABLE).select("*").in("book_id", bookIds),
    supabase.from(SCENES_TABLE).select("*").in("book_id", bookIds),
  ]);

  if (assetError || referenceError || characterError || chapterError || sceneError) {
    throw new Error(
      assetError?.message ||
        referenceError?.message ||
        characterError?.message ||
        chapterError?.message ||
        sceneError?.message ||
        "Unable to load Book Studio relations.",
    );
  }

  return books.map((book) =>
    toBookRecord({
      book,
      assets: ((assetRows ?? []) as AssetRow[]).filter((row) => row.book_id === book.id),
      references: ((referenceRows ?? []) as ReferenceRow[]).filter((row) => row.book_id === book.id),
      characters: ((characterRows ?? []) as CharacterRow[]).filter((row) => row.book_id === book.id),
      chapters: ((chapterRows ?? []) as ChapterRow[]).filter((row) => row.book_id === book.id),
      scenes: ((sceneRows ?? []) as SceneRow[]).filter((row) => row.book_id === book.id),
    }),
  );
}

let supportsReferenceChapterIdsCache: boolean | null = null;
let supportsReferenceMetadataColumnsCache: boolean | null = null;

async function supportsReferenceChapterIdsColumn(supabase: SupabaseClient) {
  if (supportsReferenceChapterIdsCache !== null) return supportsReferenceChapterIdsCache;
  const { error } = await supabase.from(REFERENCES_TABLE).select("chapter_ids").limit(1);
  supportsReferenceChapterIdsCache = !error;
  return supportsReferenceChapterIdsCache;
}

async function supportsReferenceMetadataColumns(supabase: SupabaseClient) {
  if (supportsReferenceMetadataColumnsCache !== null) return supportsReferenceMetadataColumnsCache;
  const { error } = await supabase
    .from(REFERENCES_TABLE)
    .select("source_reference_id, derivation_kind, derivation_status, confidence, label, crop")
    .limit(1);
  supportsReferenceMetadataColumnsCache = !error;
  return supportsReferenceMetadataColumnsCache;
}

async function deleteRowsNotInSet(
  supabase: SupabaseClient,
  table: string,
  bookId: string,
  keepIds: string[],
) {
  const { data, error } = await supabase.from(table).select("id").eq("book_id", bookId);
  if (error) {
    throw new Error(`Unable to inspect ${table}: ${error.message}`);
  }
  const existingIds = (data ?? []).map((row) => String((row as { id: string }).id));
  const toDelete = existingIds.filter((id) => !keepIds.includes(id));
  if (!toDelete.length) return;
  const { error: deleteError } = await supabase.from(table).delete().in("id", toDelete);
  if (deleteError) {
    throw new Error(`Unable to delete old ${table} rows: ${deleteError.message}`);
  }
}

async function persistBookToDatabase(supabase: SupabaseClient, book: BookRecord) {
  const updatedAt = nowIso();
  const next = { ...book, updatedAt };
  const supportsReferenceChapterIds = await supportsReferenceChapterIdsColumn(supabase);
  const supportsReferenceMetadata = await supportsReferenceMetadataColumns(supabase);

  const { error: bookError } = await supabase.from(BOOKS_TABLE).upsert(
    {
      id: next.id,
      slug: next.slug,
      title: next.title,
      synopsis: next.synopsis,
      status: next.status,
      manuscript_text: next.manuscriptText,
      manuscript_asset_id: next.manuscriptAssetId,
      cover_asset_id: next.coverAssetId,
      visual_direction: next.styleProfile.visualDirection,
      palette: next.styleProfile.palette,
      medium: next.styleProfile.medium,
      tone: next.styleProfile.tone,
      created_at: next.createdAt,
      updated_at: updatedAt,
      published_at: next.publishedAt,
    },
    { onConflict: "id" },
  );
  if (bookError) {
    throw new Error(`Unable to persist Book Studio book: ${bookError.message}`);
  }

  const assetRows = next.assets.map((asset) => ({
    id: asset.id,
    book_id: next.id,
    kind: asset.kind,
    label: asset.label,
    mime_type: asset.mimeType,
    relative_path: asset.relativePath,
    metadata: asset.metadata ?? {},
    created_at: asset.createdAt,
  }));
  if (assetRows.length) {
    const { error } = await supabase.from(ASSETS_TABLE).upsert(assetRows, { onConflict: "id" });
    if (error) throw new Error(`Unable to persist Book Studio assets: ${error.message}`);
  }
  await deleteRowsNotInSet(supabase, ASSETS_TABLE, next.id, next.assets.map((asset) => asset.id));

  const referenceRows = next.references.map((reference) => ({
    id: reference.id,
    book_id: next.id,
    asset_id: reference.assetId,
    source: reference.source,
    role: reference.role,
    approved: reference.approved,
    character_ids: reference.characterIds,
    scene_ids: reference.sceneIds,
    ...(supportsReferenceChapterIds ? { chapter_ids: reference.chapterIds } : {}),
    ...(supportsReferenceMetadata
      ? {
          source_reference_id: reference.sourceReferenceId,
          derivation_kind: reference.derivationKind,
          derivation_status: reference.derivationStatus,
          confidence: reference.confidence,
          label: reference.label,
          crop: reference.crop,
        }
      : {}),
    notes:
      supportsReferenceChapterIds && supportsReferenceMetadata
        ? reference.notes
        : encodeReferenceNotes(reference),
  }));
  if (referenceRows.length) {
    const { error } = await supabase.from(REFERENCES_TABLE).upsert(referenceRows, { onConflict: "id" });
    if (error) throw new Error(`Unable to persist Book Studio references: ${error.message}`);
  }
  await deleteRowsNotInSet(supabase, REFERENCES_TABLE, next.id, next.references.map((reference) => reference.id));

  const characterRows = next.characters.map((character) => ({
    id: character.id,
    book_id: next.id,
    name: character.name,
    aliases: character.aliases,
    core_description: character.coreDescription,
    age_range: character.ageRange,
    sex: character.sex,
    facial_traits: character.facialTraits,
    body_traits: character.bodyTraits,
    hair: character.hair,
    vibe: character.vibe,
    continuity_notes: character.continuityNotes,
    required_for_render: character.requiredForRender,
    status: character.status,
    canonical_reference_id: character.canonicalReferenceId,
    backup_reference_ids: character.backupReferenceIds,
    voice_assignment: character.voiceAssignment,
  }));
  if (characterRows.length) {
    const { error } = await supabase.from(CHARACTERS_TABLE).upsert(characterRows, { onConflict: "id" });
    if (error) throw new Error(`Unable to persist Book Studio characters: ${error.message}`);
  }
  await deleteRowsNotInSet(supabase, CHARACTERS_TABLE, next.id, next.characters.map((character) => character.id));

  const chapterRows = next.chapters.map((chapter) => ({
    id: chapter.id,
    book_id: next.id,
    chapter_order: chapter.order,
    title: chapter.title,
    summary: chapter.summary,
    audio_asset_id: chapter.audioAssetId,
    video_asset_id: chapter.videoAssetId,
  }));
  if (chapterRows.length) {
    const { error } = await supabase.from(CHAPTERS_TABLE).upsert(chapterRows, { onConflict: "id" });
    if (error) throw new Error(`Unable to persist Book Studio chapters: ${error.message}`);
  }
  await deleteRowsNotInSet(supabase, CHAPTERS_TABLE, next.id, next.chapters.map((chapter) => chapter.id));

  const sceneRows = next.scenes.map((scene) => ({
    id: scene.id,
    book_id: next.id,
    chapter_id: scene.chapterId,
    scene_order: scene.order,
    title: scene.title,
    source_text: scene.sourceText,
    summary: scene.summary,
    mood: scene.mood,
    location: scene.location,
    time_of_day: scene.timeOfDay,
    character_ids: scene.characterIds,
    modifiers: scene.modifiers,
    image_prompt: scene.imagePrompt,
    image_status: scene.imageStatus,
    audio_status: scene.audioStatus,
    review_status: scene.reviewStatus,
    priority: scene.priority,
    image_asset_id: scene.imageAssetId,
    audio_asset_id: scene.audioAssetId,
    estimated_duration_seconds: scene.estimatedDurationSeconds,
    render_manifest: scene.renderManifest,
  }));
  if (sceneRows.length) {
    const { error } = await supabase.from(SCENES_TABLE).upsert(sceneRows, { onConflict: "id" });
    if (error) throw new Error(`Unable to persist Book Studio scenes: ${error.message}`);
  }
  await deleteRowsNotInSet(supabase, SCENES_TABLE, next.id, next.scenes.map((scene) => scene.id));

  return next;
}

async function deleteBookFromDatabase(supabase: SupabaseClient, book: BookRecord) {
  const assetPaths = book.assets.map((asset) => asset.relativePath).filter(Boolean);
  if (assetPaths.length) {
    await supabase.storage.from(BOOK_STUDIO_BUCKET).remove(assetPaths).catch(() => undefined);
  }

  for (const table of [REFERENCES_TABLE, CHARACTERS_TABLE, SCENES_TABLE, CHAPTERS_TABLE, ASSETS_TABLE]) {
    const { error } = await supabase.from(table).delete().eq("book_id", book.id);
    if (error) {
      throw new Error(`Unable to delete ${table} rows: ${error.message}`);
    }
  }

  const { error: bookError } = await supabase.from(BOOKS_TABLE).delete().eq("id", book.id);
  if (bookError) {
    throw new Error(`Unable to delete Book Studio book: ${bookError.message}`);
  }
}

async function maybeMigrateLocalStoreToDatabase(supabase: SupabaseClient) {
  try {
    await stat(STORE_FILE);
  } catch {
    return;
  }

  const existing = await loadBooksFromDatabase(supabase).catch(() => []);
  if (existing.length > 0) return;

  const localRaw = await readFile(STORE_FILE, "utf8");
  const local = JSON.parse(localRaw) as BookStudioStore;
  for (const book of local.books) {
    for (const asset of book.assets) {
      const absolutePath = path.join(ASSET_ROOT, asset.relativePath);
      try {
        const bytes = await readFile(absolutePath);
        await uploadRemoteBytes(supabase, asset.relativePath, bytes, asset.mimeType);
      } catch {
        // skip missing local assets during migration
      }
    }
    await persistBookToDatabase(supabase, book);
  }
}

export async function readStore(): Promise<BookStudioStore> {
  if (hasSupabaseStoreEnv()) {
    const supabase = await ensureRemoteBookStudioStorage();
    if (await isDatabaseReady(supabase)) {
      await maybeMigrateLocalStoreToDatabase(supabase);
      const books = await loadBooksFromDatabase(supabase);
      return { version: STORE_VERSION, books, updatedAt: nowIso() };
    }
  }

  await ensureStoreFiles();
  const raw = await readFile(STORE_FILE, "utf8");
  const parsed = JSON.parse(raw) as BookStudioStore;
  if (parsed.version !== STORE_VERSION || !Array.isArray(parsed.books)) {
    throw new Error("Book Studio store is unreadable.");
  }
  return {
    ...parsed,
    books: parsed.books.map((book) => normalizeBookRecord(book as BookRecord)),
  };
}

export async function writeStore(store: BookStudioStore) {
  if (hasSupabaseStoreEnv()) {
    const supabase = await ensureRemoteBookStudioStorage();
    if (await isDatabaseReady(supabase)) {
      for (const book of store.books) {
        await persistBookToDatabase(supabase, book);
      }
      return;
    }
  }

  await ensureStoreFiles();
  const tmpPath = `${STORE_FILE}.tmp`;
  store.updatedAt = nowIso();
  await writeFile(tmpPath, JSON.stringify(store, null, 2), "utf8");
  await rename(tmpPath, STORE_FILE);
}

export async function listBooks(): Promise<BookListItem[]> {
  if (hasSupabaseStoreEnv()) {
    const supabase = await ensureRemoteBookStudioStorage();
    if (await isDatabaseReady(supabase)) {
      const books = await loadBooksFromDatabase(supabase);
      return books
        .map((book) => ({
          id: book.id,
          slug: book.slug,
          title: book.title,
          synopsis: book.synopsis,
          status: book.status,
          createdAt: book.createdAt,
          updatedAt: book.updatedAt,
          publishedAt: book.publishedAt,
          chapterCount: book.chapters.length,
          sceneCount: book.scenes.length,
          characterCount: book.characters.length,
        }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
  }

  const store = await readStore();
  return store.books
    .map((book) => ({
      id: book.id,
      slug: book.slug,
      title: book.title,
      synopsis: book.synopsis,
      status: book.status,
      createdAt: book.createdAt,
      updatedAt: book.updatedAt,
      publishedAt: book.publishedAt,
      chapterCount: book.chapters.length,
      sceneCount: book.scenes.length,
      characterCount: book.characters.length,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getBookById(bookId: string) {
  if (hasSupabaseStoreEnv()) {
    const supabase = await ensureRemoteBookStudioStorage();
    if (await isDatabaseReady(supabase)) {
      return (await loadBooksFromDatabase(supabase, { column: "id", value: bookId }))[0] ?? null;
    }
  }

  const store = await readStore();
  return store.books.find((book) => book.id === bookId) ?? null;
}

export async function getBookBySlug(slug: string) {
  if (hasSupabaseStoreEnv()) {
    const supabase = await ensureRemoteBookStudioStorage();
    if (await isDatabaseReady(supabase)) {
      return (await loadBooksFromDatabase(supabase, { column: "slug", value: slug }))[0] ?? null;
    }
  }

  const store = await readStore();
  return store.books.find((book) => book.slug === slug) ?? null;
}

export async function saveBookRecord(book: BookRecord) {
  if (hasSupabaseStoreEnv()) {
    const supabase = await ensureRemoteBookStudioStorage();
    if (await isDatabaseReady(supabase)) {
      return persistBookToDatabase(supabase, book);
    }
  }

  const store = await readStore();
  const index = store.books.findIndex((candidate) => candidate.id === book.id);
  const next = { ...book, updatedAt: nowIso() };
  if (index >= 0) {
    store.books[index] = next;
  } else {
    store.books.unshift(next);
  }
  await writeStore(store);
  return next;
}

export async function mutateBookRecord<T>(
  bookId: string,
  mutator: (book: BookRecord) => Promise<T> | T,
) {
  if (hasSupabaseStoreEnv()) {
    const supabase = await ensureRemoteBookStudioStorage();
    if (await isDatabaseReady(supabase)) {
      const existing = (await loadBooksFromDatabase(supabase, { column: "id", value: bookId }))[0];
      if (!existing) throw new Error("Book not found.");
      const book = structuredClone(existing) as BookRecord;
      const result = await mutator(book);
      const persisted = await persistBookToDatabase(supabase, book);
      return { book: persisted, result };
    }
  }

  const store = await readStore();
  const index = store.books.findIndex((candidate) => candidate.id === bookId);
  if (index < 0) throw new Error("Book not found.");
  const book = structuredClone(store.books[index]) as BookRecord;
  const result = await mutator(book);
  book.updatedAt = nowIso();
  store.books[index] = book;
  await writeStore(store);
  return { book, result };
}

export async function deleteBookRecord(bookId: string) {
  if (hasSupabaseStoreEnv()) {
    const supabase = await ensureRemoteBookStudioStorage();
    if (await isDatabaseReady(supabase)) {
      const existing = (await loadBooksFromDatabase(supabase, { column: "id", value: bookId }))[0];
      if (!existing) throw new Error("Book not found.");
      await deleteBookFromDatabase(supabase, existing);
      return;
    }
  }

  const store = await readStore();
  const index = store.books.findIndex((candidate) => candidate.id === bookId);
  if (index < 0) throw new Error("Book not found.");
  const [book] = store.books.splice(index, 1);
  for (const asset of book.assets) {
    await deleteAssetFile(asset);
  }
  await writeStore(store);
}

export async function writeAssetBuffer(
  bookId: string,
  kind: AssetKind,
  fileName: string,
  mimeType: string,
  buffer: Buffer,
  metadata?: Record<string, string | number | boolean | null>,
) {
  const assetId = createId("asset");
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, "-");
  const relativePath = path.join(bookId, kind, `${assetId}-${safeName}`);
  const absolutePath = path.join(ASSET_ROOT, relativePath);
  if (hasSupabaseStoreEnv()) {
    const supabase = await ensureRemoteBookStudioStorage();
    await uploadRemoteBytes(supabase, relativePath.replace(/\\/g, "/"), buffer, mimeType);
  } else {
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, buffer);
  }

  const asset: AssetRecord = {
    id: assetId,
    kind,
    label: fileName,
    mimeType,
    relativePath: relativePath.replace(/\\/g, "/"),
    createdAt: nowIso(),
    metadata,
  };

  return asset;
}

/**
 * Mint a direct-to-storage upload target so the browser can PUT a large file
 * straight to Supabase Storage, bypassing the serverless 4.5MB request-body
 * limit. Returns null when remote storage is not configured (local dev), so
 * callers can fall back to the in-request formData upload path.
 */
export async function createSignedUploadTarget(bookId: string, kind: AssetKind | "character_bible_chunk", fileName: string) {
  const assetId = createId("asset");
  const safeName = (fileName || "manuscript").replace(/[^a-zA-Z0-9._-]+/g, "-");
  const relativePath = path.join(bookId, kind, `${assetId}-${safeName}`).replace(/\\/g, "/");

  if (!hasSupabaseStoreEnv()) {
    return null;
  }

  const supabase = await ensureRemoteBookStudioStorage();
  const { data, error } = await supabase.storage.from(BOOK_STUDIO_BUCKET).createSignedUploadUrl(relativePath);
  if (error || !data) {
    throw new Error(`Unable to create upload URL: ${error?.message ?? "unknown error"}`);
  }

  return { assetId, relativePath, signedUrl: data.signedUrl };
}

export function getAssetAbsolutePath(asset: AssetRecord) {
  return path.join(ASSET_ROOT, asset.relativePath);
}

export function getAssetUrl(asset: AssetRecord) {
  return `/api/book-assets/${asset.relativePath}`;
}

export async function deleteAssetFile(asset: AssetRecord) {
  if (hasSupabaseStoreEnv()) {
    const supabase = await ensureRemoteBookStudioStorage();
    await supabase.storage.from(BOOK_STUDIO_BUCKET).remove([asset.relativePath]).catch(() => undefined);
    return;
  }

  try {
    await unlink(getAssetAbsolutePath(asset));
  } catch {
    // ignore
  }
}

export async function readAssetBuffer(relativePath: string) {
  if (hasSupabaseStoreEnv()) {
    const supabase = await ensureRemoteBookStudioStorage();
    const { data, error } = await supabase.storage.from(BOOK_STUDIO_BUCKET).download(relativePath);
    if (error) {
      throw new Error(`Unable to read Book Studio asset: ${error.message}`);
    }
    return Buffer.from(await data.arrayBuffer());
  }

  return readFile(path.join(ASSET_ROOT, relativePath));
}
