import "server-only";

import AdmZip from "adm-zip";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  parseCharacterBibleDocx,
  parseManuscript,
  parseManuscriptFromBuffer,
} from "@/lib/book-studio/documents";
import {
  concatenateAudioAssets,
  generateImageBuffer,
  generateSpeechAudio,
  renderChapterVideoFromAssets,
  runStructuredPrompt,
  runVisionStructuredPrompt,
} from "@/lib/book-studio/media";
import {
  createId,
  createSignedUploadTarget,
  deleteAssetFile,
  deleteBookRecord,
  getAssetUrl,
  getBookById,
  getBookBySlug,
  listBooks,
  mutateBookRecord,
  readAssetBuffer,
  readStore,
  saveBookRecord,
  slugify,
  writeAssetBuffer,
} from "@/lib/book-studio/store";
import type {
  AssetRecord,
  BookRecord,
  BookStatus,
  CharacterBible,
  CharacterSex,
  ChapterRecord,
  ReferenceRecord,
  ReferenceRole,
  RenderManifest,
  SceneCharacterModifier,
  ScenePriority,
  SceneRecord,
  VoiceName,
} from "@/lib/book-studio/types";

function bookStudioTempDir(...segments: string[]) {
  return path.join(os.tmpdir(), "blackspire-book-studio", ...segments);
}

async function getSharp() {
  return (await import("sharp")).default;
}

const DEFAULT_STYLE = {
  visualDirection: "cinematic realism",
  palette: "black, gold, amber, natural skin tones",
  medium: "high-detail illustrated still",
  tone: "dramatic, polished, immersive",
};

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const REFERENCE_DOCUMENT_EXTENSIONS = new Set(["docx"]);
const WORD_NUMBER_MAP: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
};
const SUPPORTED_IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};
const STORYBOARD_CROP_CONFIDENCE_THRESHOLD = 0.72;
const STORYBOARD_EXTRACTION_MODEL = process.env.OPENAI_BOOK_VISION_MODEL?.trim() || "gpt-4.1-mini";

function nowIso() {
  return new Date().toISOString();
}

function safeJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function estimateDuration(text: string) {
  return Math.max(4, Math.round((text.split(/\s+/).filter(Boolean).length / 160) * 60));
}

function dedupeStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function fileExtension(fileName: string) {
  return fileName.toLowerCase().split(".").pop() || "";
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeLooseText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function characterMatchCandidates(character: Pick<CharacterBible, "name" | "aliases">) {
  return dedupeStrings([character.name, ...character.aliases])
    .map((value) => normalizeLooseText(value))
    .filter(Boolean);
}

function loosePhraseIncludes(haystack: string, candidate: string) {
  if (!haystack || !candidate) return false;
  return ` ${haystack} `.includes(` ${candidate} `);
}

function splitFallbackScenes(chapterId: string, chapterTitle: string, text: string, chapterOrder: number) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const scenes: Array<Omit<SceneRecord, "characterIds" | "modifiers" | "imageStatus" | "audioStatus" | "reviewStatus" | "priority" | "imageAssetId" | "audioAssetId" | "renderManifest">> = [];
  let chunk: string[] = [];

  const flush = () => {
    if (!chunk.length) return;
    const sourceText = chunk.join("\n\n");
    const order = scenes.length + 1;
    scenes.push({
      id: createId("scene"),
      chapterId,
      order: chapterOrder * 100 + order,
      title: `${chapterTitle} Scene ${String(order).padStart(2, "0")}`,
      sourceText,
      summary: sourceText.slice(0, 240),
      mood: "dramatic",
      location: "unspecified",
      timeOfDay: "unspecified",
      imagePrompt: "",
      estimatedDurationSeconds: estimateDuration(sourceText),
    });
    chunk = [];
  };

  for (const paragraph of paragraphs) {
    chunk.push(paragraph);
    if (chunk.join(" ").length > 1800) {
      flush();
    }
  }

  flush();

  return scenes.map((scene, index) => ({
    ...scene,
    characterIds: [],
    modifiers: [],
    imageStatus: "missing" as const,
    audioStatus: "missing" as const,
    reviewStatus: "pending" as const,
    priority: index === 0 ? ("key" as const) : ("supporting" as const),
    imageAssetId: null,
    audioAssetId: null,
    renderManifest: null,
  }));
}

function extractFallbackCharacters(text: string) {
  const matches = text.match(/\b[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g) ?? [];
  const blocked = new Set(
    [
    "Chapter",
    "Chapter One",
    "Chapter Two",
    "Chapter Three",
    "Chapter Four",
    "Chapter Five",
    "Chapter Six",
    "Chapter Seven",
    "Chapter Eight",
    "Chapter Nine",
    "Chapter Ten",
    "Chapter Eleven",
    "Part",
    "The",
    "The Boy",
    "Who Stole",
    "And",
    "But",
    "When",
    "Then",
    "After",
    "Before",
    "Above",
    "Some",
    "They",
    "His",
    "It",
    "One",
    "Someone",
    "Something",
    "Everyone",
    "Every",
    "He",
    "Her",
    "She",
    "In",
    "To",
    "An",
    "Or",
    "No",
    "Not",
    "Down",
    "That",
    "Its",
    "Power",
    "Rain",
    "Another",
    "Friends",
    "Neighbors",
    "Millions",
    "Cargo",
    "Luxury",
    "Military",
    "Merchant",
    "Disaster",
    "Light",
    "Neon",
    "Blackspire",
    "Principal",
    "Character",
    "Bible",
    "Chronological Manuscript",
    "Draft",
    "Working",
    "Edition",
    "Story",
    "Canon",
    "Canonical",
    "Universe",
    "Lower Geminara",
    "Upper Geminara",
    "Geminara",
    ].map((value) => value.toLowerCase()),
  );
  return dedupeStrings(matches.filter((match) => !blocked.has(normalizeName(match).toLowerCase()))).slice(0, 10);
}

function createCharacterBibleCard(
  name: string,
  bookTitle: string,
  patch: Partial<
    Pick<
      CharacterBible,
      "aliases" | "coreDescription" | "ageRange" | "sex" | "facialTraits" | "bodyTraits" | "hair" | "vibe" | "continuityNotes"
    >
  > = {},
): CharacterBible {
  return {
    id: createId("character"),
    name: normalizeName(name),
    aliases: patch.aliases ?? [],
    coreDescription: patch.coreDescription ?? `${name} is a recurring figure in ${bookTitle}.`,
    ageRange: patch.ageRange ?? "adult",
    sex: patch.sex ?? "unknown",
    facialTraits: patch.facialTraits ?? "",
    bodyTraits: patch.bodyTraits ?? "",
    hair: patch.hair ?? "",
    vibe: patch.vibe ?? "",
    continuityNotes: patch.continuityNotes ?? "",
    requiredForRender: true,
    status: "draft",
    canonicalReferenceId: null,
    backupReferenceIds: [],
    voiceAssignment: null,
  };
}

function voiceForCharacter(character: CharacterBible): VoiceName {
  const age = character.ageRange.toLowerCase();
  if (character.sex === "female") {
    if (age.includes("child") || age.includes("teen")) return "shimmer";
    return "verse";
  }
  if (character.sex === "male") {
    if (age.includes("child") || age.includes("teen")) return "ash";
    return "cedar";
  }
  return "alloy";
}

function narratorVoice() {
  return "marin" as const;
}

function fallbackVoice() {
  return "sage" as const;
}

function recalcBookStatus(book: BookRecord) {
  if (book.publishedAt) return "Published" satisfies BookStatus;
  const requiredCharacters = book.characters.filter((character) => character.requiredForRender);
  const ready =
    requiredCharacters.length > 0 &&
    requiredCharacters.every((character) => character.status === "locked" && character.canonicalReferenceId);
  return ready ? "ApprovedForRender" : "Draft";
}

function characterKeys(character: Pick<CharacterBible, "name" | "aliases">) {
  return dedupeStrings([character.name, ...character.aliases]).map((value) => normalizeName(value).toLowerCase());
}

function shouldPreserveCharacterBible(character: CharacterBible) {
  return Boolean(
    character.canonicalReferenceId ||
      character.backupReferenceIds.length ||
      character.coreDescription ||
      character.aliases.length ||
      character.facialTraits ||
      character.bodyTraits ||
      character.hair ||
      character.vibe ||
      character.continuityNotes ||
      character.voiceAssignment,
  );
}

function isLikelyFalseCharacterName(name: string) {
  const normalized = normalizeName(name).toLowerCase();
  if (!normalized) return true;
  if (["kael", "nyx", "orin", "commander solen", "the first rememberer", "ancient luxari elder"].includes(normalized)) {
    return false;
  }
  if (
    /^(chapter|part|draft|manuscript|chronological manuscript|the boy|the boy who|who stole|stole light|light|some|they|his|it|one|two|three|someone|something|everyone|every|he|her|she|in|to|an|as|or|no|not|down|that|its|power|rain|another|friends|neighbors|millions|cargo|luxury|military|merchant|disaster|neon|above|lower geminara|upper geminara|geminara|people|thousands|morning|because|except|even|most|only|for)$/i.test(
      normalized,
    )
  ) {
    return true;
  }
  if (/^(in|at|if|across|as|only|for|between|except|because|even|most|the|another)\s+/i.test(normalized)) return true;
  if (/\b(upper geminara|lower geminara|geminara)\b/i.test(normalized)) return true;
  if (/\bkael$/i.test(normalized) && normalized !== "kael") return true;
  return /\b(chapter|draft|manuscript|edition|working|script)\b/i.test(normalized);
}

function mergeCharacterBibles(existingCharacters: CharacterBible[], analyzedCharacters: CharacterBible[]) {
  const usedExistingIds = new Set<string>();
  const characterIdMap = new Map<string, string>();

  const characters = analyzedCharacters.map((analyzedCharacter) => {
    const analyzedKeys = new Set(characterKeys(analyzedCharacter));
    const existingCharacter = existingCharacters.find((candidate) => {
      if (usedExistingIds.has(candidate.id)) return false;
      return characterKeys(candidate).some((key) => analyzedKeys.has(key));
    });

    if (!existingCharacter) {
      characterIdMap.set(analyzedCharacter.id, analyzedCharacter.id);
      return analyzedCharacter;
    }

    usedExistingIds.add(existingCharacter.id);
    characterIdMap.set(analyzedCharacter.id, existingCharacter.id);

    return {
      ...analyzedCharacter,
      id: existingCharacter.id,
      name: existingCharacter.name || analyzedCharacter.name,
      aliases: dedupeStrings([...existingCharacter.aliases, ...analyzedCharacter.aliases]),
      coreDescription: existingCharacter.coreDescription || analyzedCharacter.coreDescription,
      ageRange: existingCharacter.ageRange || analyzedCharacter.ageRange,
      sex: existingCharacter.sex !== "unknown" ? existingCharacter.sex : analyzedCharacter.sex,
      facialTraits: existingCharacter.facialTraits || analyzedCharacter.facialTraits,
      bodyTraits: existingCharacter.bodyTraits || analyzedCharacter.bodyTraits,
      hair: existingCharacter.hair || analyzedCharacter.hair,
      vibe: existingCharacter.vibe || analyzedCharacter.vibe,
      continuityNotes: existingCharacter.continuityNotes || analyzedCharacter.continuityNotes,
      requiredForRender: existingCharacter.requiredForRender,
      status: existingCharacter.status,
      canonicalReferenceId: existingCharacter.canonicalReferenceId,
      backupReferenceIds: existingCharacter.backupReferenceIds,
      voiceAssignment: existingCharacter.voiceAssignment,
    };
  });

  const preservedCharacters = existingCharacters.filter(
    (character) => !usedExistingIds.has(character.id) && shouldPreserveCharacterBible(character),
  );

  return {
    characters: [...characters, ...preservedCharacters],
    characterIdMap,
  };
}

function bookCharacterReferences(book: BookRecord, character: CharacterBible) {
  return book.references.filter(
    (reference) =>
      reference.characterIds.includes(character.id) &&
      (reference.role === "character_reference" || reference.role === "canonical_candidate"),
  );
}

function getCharacterBibleReferenceIds(book: BookRecord, character: CharacterBible) {
  const approvedLinkedReferenceIds = bookCharacterReferences(book, character)
    .filter((reference) => reference.approved)
    .map((reference) => reference.id);

  return dedupeStrings([
    ...(character.canonicalReferenceId ? [character.canonicalReferenceId] : []),
    ...character.backupReferenceIds,
    ...approvedLinkedReferenceIds,
  ]);
}

function getCharacterBibleSummary(character: CharacterBible) {
  return [
    character.coreDescription || `${character.name} is a recurring character in the novel.`,
    character.ageRange ? `Age range: ${character.ageRange}` : null,
    character.sex !== "unknown" ? `Sex: ${character.sex}` : null,
    character.facialTraits ? `Facial traits: ${character.facialTraits}` : null,
    character.bodyTraits ? `Body traits: ${character.bodyTraits}` : null,
    character.hair ? `Hair: ${character.hair}` : null,
    character.vibe ? `Vibe: ${character.vibe}` : null,
    character.continuityNotes ? `Continuity notes: ${character.continuityNotes}` : null,
  ]
    .filter(Boolean)
    .join("; ");
}

function describeAutoMatch(characterName: string, matchedTerm: string) {
  return `[auto-match:${characterName}|${matchedTerm}]`;
}

function stripAutoMatchNotes(notes: string) {
  return notes
    .split("\n")
    .filter((line) => !line.trim().startsWith("[auto-match:"))
    .join("\n")
    .trim();
}

function isStoryboardLikeText(value: string) {
  return /\bstoryboard\b/i.test(value);
}

function getReferenceAsset(book: BookRecord, reference: ReferenceRecord) {
  return book.assets.find((asset) => asset.id === reference.assetId) ?? null;
}

function getReferenceDisplayLabel(book: BookRecord, reference: ReferenceRecord) {
  return reference.label || getReferenceAsset(book, reference)?.label || reference.id;
}

function getReferenceFigureText(book: BookRecord, reference: ReferenceRecord) {
  const asset = getReferenceAsset(book, reference);
  const figureTitle = typeof asset?.metadata?.figureTitle === "string" ? asset.metadata.figureTitle : "";
  const figureCaption = typeof asset?.metadata?.figureCaption === "string" ? asset.metadata.figureCaption : "";
  const noteTitle = reference.notes.match(/^Title:\s*(.+)$/im)?.[1] ?? "";
  return {
    figureTitle: figureTitle || noteTitle,
    figureCaption: figureCaption || reference.notes,
    combined: [
      asset?.label,
      reference.label,
      figureTitle,
      figureCaption,
      noteTitle,
      reference.notes,
    ]
      .filter((value): value is string => typeof value === "string" && Boolean(value))
      .join("\n"),
  };
}

function isStoryboardSourceReference(book: BookRecord, reference: ReferenceRecord) {
  if (reference.sourceReferenceId || reference.derivationKind !== "none") return false;
  if (reference.role !== "scene_reference") return false;
  const haystack = getReferenceFigureText(book, reference).combined;
  return isStoryboardLikeText(haystack) || reference.source === "character_bible_import";
}

function normalizeCrop(
  crop: { x: number; y: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number,
) {
  const left = Math.max(0, Math.floor(crop.x));
  const top = Math.max(0, Math.floor(crop.y));
  const width = Math.max(1, Math.floor(crop.width));
  const height = Math.max(1, Math.floor(crop.height));
  const clampedLeft = Math.min(left, Math.max(0, imageWidth - 1));
  const clampedTop = Math.min(top, Math.max(0, imageHeight - 1));
  const clampedWidth = Math.min(width, imageWidth - clampedLeft);
  const clampedHeight = Math.min(height, imageHeight - clampedTop);

  if (clampedWidth < 32 || clampedHeight < 32) return null;

  return {
    x: clampedLeft,
    y: clampedTop,
    width: clampedWidth,
    height: clampedHeight,
  };
}

function findCharacterByCandidateName(book: BookRecord, candidateName: string) {
  const normalizedCandidate = normalizeLooseText(candidateName);
  if (!normalizedCandidate) return null;

  return (
    book.characters.find((character) =>
      characterMatchCandidates(character).some((candidate) => {
        if (candidate === normalizedCandidate) return true;
        const candidateWords = candidate.split(" ").filter(Boolean);
        const incomingWords = normalizedCandidate.split(" ").filter(Boolean);
        return (
          candidateWords.length > 0 &&
          incomingWords.length > 0 &&
          candidateWords.every((word) => incomingWords.includes(word))
        );
      }),
    ) ?? null
  );
}

function mentionedCharactersFromReferenceText(book: BookRecord, reference: ReferenceRecord) {
  const haystack = normalizeLooseText(getReferenceFigureText(book, reference).combined);
  return book.characters.filter((character) =>
    characterMatchCandidates(character).some((candidate) => {
      if (!candidate) return false;
      return loosePhraseIncludes(haystack, candidate);
    }),
  );
}

function fallbackStoryboardCandidates(
  book: BookRecord,
  reference: ReferenceRecord,
  imageWidth: number,
  imageHeight: number,
) {
  const mentioned = mentionedCharactersFromReferenceText(book, reference).slice(0, 8);
  if (!mentioned.length) return [];

  const columns = imageWidth >= imageHeight ? 3 : 2;
  const rows = Math.ceil(mentioned.length / columns);
  const cellWidth = Math.floor(imageWidth / columns);
  const cellHeight = Math.floor(imageHeight / rows);

  return mentioned.map((character, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const side = Math.max(64, Math.floor(Math.min(cellWidth, cellHeight) * 0.9));
    return {
      characterName: character.name,
      confidence: 0.73,
      x: column * cellWidth + Math.floor((cellWidth - side) / 2),
      y: row * cellHeight + Math.floor((cellHeight - side) / 2),
      width: side,
      height: side,
      reason: "Fallback crop from storyboard caption mention. Review before using for continuity.",
    };
  });
}

async function cropAndUpscaleStoryboardCandidate(
  buffer: Buffer,
  crop: { x: number; y: number; width: number; height: number },
) {
  const sharp = await getSharp();
  return sharp(buffer)
    .extract({
      left: crop.x,
      top: crop.y,
      width: crop.width,
      height: crop.height,
    })
    .resize({
      width: 1024,
      height: 1024,
      fit: "inside",
      withoutEnlargement: false,
      kernel: sharp.kernel.lanczos3,
    })
    .png()
    .toBuffer();
}

async function normalizeImportedReferenceImage(fileName: string, mimeType: string, buffer: Buffer) {
  if (mimeType === "image/gif" || mimeType === "image/svg+xml") {
    return { fileName, mimeType, buffer };
  }

  try {
    const sharp = await getSharp();
    const image = sharp(buffer, { limitInputPixels: false }).rotate();
    const metadata = await image.metadata();
    const hasAlpha = Boolean(metadata.hasAlpha);
    const baseName = path.basename(fileName, path.extname(fileName));

    if (hasAlpha) {
      return {
        fileName: `${baseName}.png`,
        mimeType: "image/png",
        buffer: await image
          .resize({ width: 2200, height: 2200, fit: "inside", withoutEnlargement: true })
          .png({ compressionLevel: 9 })
          .toBuffer(),
      };
    }

    return {
      fileName: `${baseName}.jpg`,
      mimeType: "image/jpeg",
      buffer: await image
        .resize({ width: 2200, height: 2200, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 88, mozjpeg: true })
        .toBuffer(),
    };
  } catch {
    return { fileName, mimeType, buffer };
  }
}

function findCharacterBibleSection(text: string) {
  const normalized = text.replace(/\r/g, "");
  const headingMatches = Array.from(
    normalized.matchAll(
      /^\s*(principal\s+character\s+bible|character\s+bible(?:\s+\(.*?\)|\s+summaries?)?)\s*$/gim,
    ),
  );
  const match =
    headingMatches[headingMatches.length - 1] ??
    /(principal\s+character\s+bible|character\s+bible(?:\s+\(.*?\)|\s+summaries?)?)/i.exec(normalized);
  if (!match?.index && match?.index !== 0) return null;

  const afterHeading = normalized.slice(match.index + match[0].length).trim();
  if (!afterHeading) return null;

  const stopPatterns = [
    /\n\s*(?:world\s+bible|location\s+bible|reference\s+library|art\s+notes|appendix|glossary|voice\s+cast)\b/i,
    /\n\s*(?:chapter|part)\s+(?:\d+|[ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/i,
  ];

  const stopIndex = stopPatterns
    .map((pattern) => {
      const next = pattern.exec(afterHeading);
      return typeof next?.index === "number" ? next.index : -1;
    })
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];

  return (typeof stopIndex === "number" ? afterHeading.slice(0, stopIndex) : afterHeading).trim();
}

function inferAgeRangeFromEntry(entryText: string) {
  const exactAge = entryText.match(/\b(\d{1,2})\b/);
  if (exactAge) return exactAge[1];
  if (/teen/i.test(entryText)) return "teen";
  if (/child|kid|boy|girl/i.test(entryText)) return "child";
  if (/elder|ancient/i.test(entryText)) return "elder";
  return "adult";
}

function inferSexFromEntry(entryText: string): CharacterSex {
  if (/\b(she|her|woman|girl|female)\b/i.test(entryText)) return "female";
  if (/\b(he|him|man|boy|male)\b/i.test(entryText)) return "male";
  return "unknown";
}

function inferVisualTrait(entryText: string, keywords: string[]) {
  const fragments = entryText
    .split(/[.;]\s+/)
    .map((fragment) => fragment.trim())
    .filter(Boolean);
  return (
    fragments.find((fragment) => keywords.some((keyword) => fragment.toLowerCase().includes(keyword))) ?? ""
  );
}

function splitCharacterBibleEntries(sectionText: string) {
  const blockedHeadings = new Set([
    "story canon",
    "principal character bible",
    "character bible",
    "source images",
    "canonical",
  ]);
  const paragraphs = sectionText
    .split(/\n\s*\n/)
    .map((paragraph) => normalizeName(paragraph))
    .filter(Boolean);

  const looksLikeCharacterHeading = (paragraph: string) => {
    if (!paragraph || blockedHeadings.has(paragraph.toLowerCase())) return false;
    if (/[.!?:]/.test(paragraph)) return false;
    if (/^(chapter|part|figure)\b/i.test(paragraph)) return false;
    const words = paragraph.split(" ").filter(Boolean);
    if (!words.length || words.length > 5) return false;
    return words.every((word) => /^[A-Z][A-Za-z'-]*$/.test(word) || /^(of|the|and)$/i.test(word));
  };

  const paragraphEntries: Array<{ name: string; text: string }> = [];
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    if (!looksLikeCharacterHeading(paragraph)) continue;

    const body: string[] = [];
    let cursor = index + 1;
    while (cursor < paragraphs.length && !looksLikeCharacterHeading(paragraphs[cursor])) {
      body.push(paragraphs[cursor]);
      cursor += 1;
    }

    if (body.length) {
      paragraphEntries.push({
        name: paragraph,
        text: `${paragraph}\n${body.join("\n\n")}`.trim(),
      });
      index = cursor - 1;
    }
  }

  if (paragraphEntries.length) {
    return paragraphEntries;
  }

  const regexMatches =
    sectionText.match(
      /\b(?:[A-Z][a-z]+|[A-Z]{2,})(?:\s+(?:[A-Z][a-z]+|[A-Z]{2,}|of|the|and|Last|Firstborn|Tree|Commander|Chancellor|Hollow))+?\b/g,
    ) ?? [];
  const candidateNames = dedupeStrings([...regexMatches, ...extractFallbackCharacters(sectionText)]).filter((name) => {
    const normalized = normalizeName(name);
    return (
      normalized.length >= 3 &&
      !/^(Theme|Omega|Street|Ancient|Lower|Luxari|Meridian|Authority|Resonance|Field|History)$/i.test(normalized)
    );
  });

  const positioned = candidateNames
    .map((name) => ({ name, index: sectionText.indexOf(name) }))
    .filter((entry) => entry.index >= 0)
    .sort((left, right) => left.index - right.index)
    .filter((entry, index, list) => index === 0 || entry.index - list[index - 1].index > 8);

  if (!positioned.length) return [];

  return positioned.map((entry, index) => {
    const nextIndex = positioned[index + 1]?.index ?? sectionText.length;
    return {
      name: entry.name,
      text: sectionText.slice(entry.index, nextIndex).trim(),
    };
  });
}

async function extractExplicitCharacterBibles(text: string, bookTitle: string) {
  const section = findCharacterBibleSection(text);
  if (!section) {
    return [] as CharacterBible[];
  }

  const fallbackCharacters = splitCharacterBibleEntries(section)
    .slice(0, 20)
    .map((entry) => {
      const body = entry.text.replace(new RegExp(`^${entry.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`), "").trim();
      const themeMatch = body.match(/Theme:\s*([^.;\n]+)/i);
      return createCharacterBibleCard(entry.name, bookTitle, {
        coreDescription: body || `${entry.name} is a recurring figure in ${bookTitle}.`,
        ageRange: inferAgeRangeFromEntry(body),
        sex: inferSexFromEntry(body),
        facialTraits: inferVisualTrait(body, ["eye", "face", "facial", "constellation", "tattoo"]),
        bodyTraits: inferVisualTrait(body, ["streetwear", "body", "survivor", "colossal", "elder", "commander", "organism"]),
        hair: inferVisualTrait(body, ["hair", "braid", "shaved", "silver", "crown"]),
        vibe: themeMatch?.[1]?.trim() || inferVisualTrait(body, ["playful", "protective", "mentor", "ancient", "unknown"]),
        continuityNotes: themeMatch ? `Theme: ${themeMatch[1].trim()}.` : "",
      });
    });

  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["characters"],
    properties: {
      characters: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "name",
            "aliases",
            "coreDescription",
            "ageRange",
            "sex",
            "facialTraits",
            "bodyTraits",
            "hair",
            "vibe",
            "continuityNotes",
          ],
          properties: {
            name: { type: "string" },
            aliases: { type: "array", items: { type: "string" } },
            coreDescription: { type: "string" },
            ageRange: { type: "string" },
            sex: { type: "string", enum: ["female", "male", "unknown"] },
            facialTraits: { type: "string" },
            bodyTraits: { type: "string" },
            hair: { type: "string" },
            vibe: { type: "string" },
            continuityNotes: { type: "string" },
          },
        },
      },
    },
  };

  const payload = await runStructuredPrompt({
    system:
      "You extract explicit character bible cards from a manuscript. Return one compact continuity card per real character or named entity that should persist across scenes. Preserve visual traits and role summaries from the provided text.",
    user: `Book title: ${bookTitle}

Character bible section:
${section.slice(0, 12000)}

Extract the named characters/entities from this character bible section into continuity-ready cards.`,
    schema,
    fallback: {
      characters: fallbackCharacters.map((character) => ({
        name: character.name,
        aliases: character.aliases,
        coreDescription: character.coreDescription,
        ageRange: character.ageRange,
        sex: character.sex,
        facialTraits: character.facialTraits,
        bodyTraits: character.bodyTraits,
        hair: character.hair,
        vibe: character.vibe,
        continuityNotes: character.continuityNotes,
      })),
    },
  });

  return (payload.characters ?? [])
    .filter((character: { name?: string }) => Boolean(character.name?.trim()))
    .map(
      (character: {
        name: string;
        aliases?: string[];
        coreDescription?: string;
        ageRange?: string;
        sex?: CharacterSex;
        facialTraits?: string;
        bodyTraits?: string;
        hair?: string;
        vibe?: string;
        continuityNotes?: string;
      }) =>
        createCharacterBibleCard(character.name, bookTitle, {
          aliases: dedupeStrings(character.aliases ?? []),
          coreDescription: character.coreDescription ?? "",
          ageRange: character.ageRange ?? "adult",
          sex: character.sex ?? "unknown",
          facialTraits: character.facialTraits ?? "",
          bodyTraits: character.bodyTraits ?? "",
          hair: character.hair ?? "",
          vibe: character.vibe ?? "",
          continuityNotes: character.continuityNotes ?? "",
        }),
    );
}

function isGenericCoreDescription(character: CharacterBible, bookTitle: string) {
  const normalized = character.coreDescription.trim().toLowerCase();
  if (!normalized) return true;
  return [
    `${character.name.toLowerCase()} is a recurring figure in ${bookTitle.toLowerCase()}.`,
    `${character.name.toLowerCase()} is a recurring character in the novel.`,
  ].includes(normalized);
}

function inferChapterNumber(value: string) {
  const match = value.match(/\bchapter\s+([a-z0-9ivxlc-]+)\b/i);
  if (!match) return null;
  const token = match[1].toLowerCase().replace(/[^a-z0-9ivxlc]+/g, "");
  return Number.parseInt(token, 10) || WORD_NUMBER_MAP[token] || null;
}

function inferReferenceRoleFromText(text: string): ReferenceRole {
  const normalized = text.toLowerCase();
  if (/\bside view\b/.test(normalized) || /\b3\/4 view\b/.test(normalized) || /\bthree-quarter view\b/.test(normalized)) {
    return "character_reference";
  }
  if (/\bstoryboard\b/.test(normalized) || inferChapterNumber(normalized)) return "scene_reference";
  if (
    /\bcityscape\b/.test(normalized) ||
    /\bcities\b/.test(normalized) ||
    /\bsky\b/.test(normalized) ||
    /\bplanet\b/.test(normalized) ||
    /\bworld\b/.test(normalized) ||
    /\benvironment\b/.test(normalized) ||
    /\blandscape\b/.test(normalized) ||
    /\bshared atmosphere\b/.test(normalized)
  ) {
    return "mood_reference";
  }
  return "character_reference";
}

function mergeTextFragments(values: string[], limit = 4) {
  return dedupeStrings(values.map((value) => value.trim()).filter(Boolean)).slice(0, limit).join(" ");
}

function inferCharacterFieldsFromDescription(description: string) {
  const fragments = description
    .split(/[.;]\s+/)
    .map((fragment) => fragment.trim())
    .filter(Boolean);

  return {
    coreDescription: mergeTextFragments(fragments.slice(0, 2), 2),
    facialTraits: inferVisualTrait(description, ["eye", "face", "facial", "tattoo", "constellation"]),
    bodyTraits: inferVisualTrait(description, ["streetwear", "clothing", "silhouette", "body", "survivor", "worn", "layered"]),
    hair: inferVisualTrait(description, ["hair", "braid", "shaved", "silver"]),
    vibe: inferVisualTrait(description, ["dreamer", "protective", "playful", "mentor", "resilient", "ancient", "loyal"]),
  };
}

function matchChapterIds(book: BookRecord, values: string[]) {
  const normalizedHaystack = normalizeLooseText(values.join(" "));
  if (!normalizedHaystack) return [];

  return book.chapters
    .filter((chapter) => {
      const chapterNumber = inferChapterNumber(chapter.title);
      if (chapterNumber && normalizedHaystack.includes(`chapter ${chapterNumber}`)) return true;
      const title = normalizeLooseText(chapter.title);
      return Boolean(title && normalizedHaystack.includes(title));
    })
    .map((chapter) => chapter.id);
}

function matchSceneIds(book: BookRecord, values: string[]) {
  const normalizedHaystack = normalizeLooseText(values.join(" "));
  if (!normalizedHaystack) return [];

  return book.scenes
    .filter((scene) => {
      const title = normalizeLooseText(scene.title);
      if (title && normalizedHaystack.includes(title)) return true;
      const summaryTerms = normalizeLooseText(scene.summary)
        .split(" ")
        .filter((word) => word.length > 5)
        .slice(0, 8);
      return summaryTerms.length >= 3 && summaryTerms.filter((word) => normalizedHaystack.includes(word)).length >= 3;
    })
    .map((scene) => scene.id);
}

function extractKnownCharactersFromText(book: BookRecord, text: string) {
  const haystack = normalizeLooseText(text);
  return book.characters
    .filter((character) =>
      characterMatchCandidates(character).some((candidate) => {
        if (!candidate) return false;
        return loosePhraseIncludes(haystack, candidate);
      }),
    )
    .map((character) => character.id);
}

function characterNameFromWorldBibleFigure(figure: {
  sourceCode?: string | null;
  title: string;
  caption: string;
  inferredRole: ReferenceRole;
}) {
  if (figure.inferredRole !== "character_reference") return "";
  if (!figure.sourceCode?.startsWith("GH-")) return "";

  const source = figure.title || figure.caption;
  const withoutFigure = source.replace(/^Figure\s+/i, "");
  const withoutCode = withoutFigure.replace(/\bGH-\d+[A-Z]?\b\s*[:—-]?\s*/i, "");
  const name = withoutCode.split(/\s+[—-]\s+/)[0]?.replace(/\bproduction profile sheet\b.*$/i, "").trim();
  if (!name || name.length > 80) return "";
  return normalizeName(name.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()));
}

function ensureWorldBibleCharacter(draft: BookRecord, name: string, figureDescription: string) {
  if (!name) return null;
  const existing = draft.characters.find((character) =>
    characterMatchCandidates(character).some((candidate) => candidate === normalizeLooseText(name)),
  );
  if (existing) return existing;

  const card = createCharacterBibleCard(name, draft.title, {
    coreDescription: figureDescription.slice(0, 420),
    continuityNotes: "Seeded from imported Geminara World Bible character production sheet.",
  });
  draft.characters.push(card);
  return card;
}

function referenceSignalText(book: BookRecord, reference: ReferenceRecord) {
  const asset = getReferenceAsset(book, reference);
  const { figureTitle, figureCaption } = getReferenceFigureText(book, reference);
  return [reference.label ?? "", asset?.label ?? "", figureTitle, figureCaption, stripAutoMatchNotes(reference.notes)]
    .filter(Boolean)
    .join(" ");
}

function upsertCharacterBibleSeed(draft: BookRecord, characters: CharacterBible[]) {
  const { characters: merged } = mergeCharacterBibles(draft.characters, characters);
  draft.characters = merged;
}

function enrichCharactersFromImportedCards(
  draft: BookRecord,
  importedCards: Array<Pick<CharacterBible, "name" | "aliases" | "coreDescription" | "ageRange" | "sex" | "facialTraits" | "bodyTraits" | "hair" | "vibe" | "continuityNotes">>,
) {
  const byKey = new Map<string, CharacterBible>();
  draft.characters.forEach((character) => {
    for (const key of characterKeys(character)) byKey.set(key, character);
  });

  for (const card of importedCards) {
    const target = characterKeys({ name: card.name, aliases: card.aliases }).map((key) => byKey.get(key)).find(Boolean);
    if (!target) continue;

    if (isGenericCoreDescription(target, draft.title) && card.coreDescription) {
      target.coreDescription = card.coreDescription;
    }
    if ((target.ageRange === "adult" || !target.ageRange) && card.ageRange && card.ageRange !== "adult") {
      target.ageRange = card.ageRange;
    }
    if (target.sex === "unknown" && card.sex && card.sex !== "unknown") {
      target.sex = card.sex;
    }
    if (!target.facialTraits && card.facialTraits) target.facialTraits = card.facialTraits;
    if (!target.bodyTraits && card.bodyTraits) target.bodyTraits = card.bodyTraits;
    if (!target.hair && card.hair) target.hair = card.hair;
    if (!target.vibe && card.vibe) target.vibe = card.vibe;
    if (card.continuityNotes) {
      target.continuityNotes = dedupeStrings([target.continuityNotes, card.continuityNotes]).join(" ");
    }
  }
}

function buildImportedCardsFromFigures(book: BookRecord, descriptions: Array<{ title: string; caption: string; description: string }>) {
  return book.characters
    .map((character) => {
      const relevant = descriptions.filter((entry) =>
        characterMatchCandidates(character).some((candidate) => loosePhraseIncludes(normalizeLooseText(entry.description), candidate)),
      );
      if (!relevant.length) return null;
      const mergedDescription = mergeTextFragments(relevant.map((entry) => [entry.title, entry.caption].filter(Boolean).join(". ")), 4);
      const inferred = inferCharacterFieldsFromDescription(mergedDescription);
      return {
        name: character.name,
        aliases: character.aliases,
        coreDescription: inferred.coreDescription || mergedDescription,
        ageRange: character.ageRange,
        sex: character.sex,
        facialTraits: inferred.facialTraits,
        bodyTraits: inferred.bodyTraits,
        hair: inferred.hair,
        vibe: inferred.vibe,
        continuityNotes: mergeTextFragments(relevant.map((entry) => entry.description), 3),
      };
    })
    .filter(
      (
        card,
      ): card is Pick<CharacterBible, "name" | "aliases" | "coreDescription" | "ageRange" | "sex" | "facialTraits" | "bodyTraits" | "hair" | "vibe" | "continuityNotes"> =>
        Boolean(card),
    );
}

function autoLinkReferencesToCharacters(book: BookRecord) {
  const assetsById = new Map(book.assets.map((asset) => [asset.id, asset] as const));

  book.references = book.references.map((reference) => {
    if (reference.role === "scene_reference" || reference.role === "mood_reference" || reference.role === "excluded") {
      return reference;
    }

    const asset = assetsById.get(reference.assetId);
    const haystack = normalizeLooseText([asset?.label ?? "", stripAutoMatchNotes(reference.notes)].filter(Boolean).join(" "));
    if (!haystack) {
      return reference;
    }

    const matches = book.characters
      .map((character) => {
        const matchedTerm = characterMatchCandidates(character).find((candidate) => {
          return loosePhraseIncludes(haystack, candidate);
        });

        return matchedTerm ? { characterId: character.id, characterName: character.name, matchedTerm } : null;
      })
      .filter((match): match is { characterId: string; characterName: string; matchedTerm: string } => Boolean(match));

    if (!matches.length) {
      return {
        ...reference,
        notes: stripAutoMatchNotes(reference.notes),
      };
    }

    const preservedNotes = stripAutoMatchNotes(reference.notes);
    const autoMatchNotes = matches.map((match) => describeAutoMatch(match.characterName, match.matchedTerm));

    return {
      ...reference,
      role: reference.role === "canonical_candidate" ? reference.role : "character_reference",
      characterIds: dedupeStrings([...reference.characterIds, ...matches.map((match) => match.characterId)]),
      notes: [preservedNotes, ...autoMatchNotes].filter(Boolean).join("\n"),
    };
  });
}

function autoLinkReferencesToScenes(book: BookRecord) {
  book.references = book.references.map((reference) => {
    if (reference.role !== "scene_reference" && reference.role !== "mood_reference") {
      return reference;
    }

    const signalText = referenceSignalText(book, reference);
    const sceneIds = matchSceneIds(book, [signalText]);
    const chapterIds = matchChapterIds(book, [signalText]);

    if (!sceneIds.length && !chapterIds.length) return reference;

    return {
      ...reference,
      sceneIds: dedupeStrings([...reference.sceneIds, ...sceneIds]),
      chapterIds: dedupeStrings([...reference.chapterIds, ...chapterIds]),
    };
  });
}

function syncCharacterBibleReferences(book: BookRecord) {
  book.characters = book.characters.map((character) => {
    const approvedLinkedReferenceIds = bookCharacterReferences(book, character)
      .filter((reference) => reference.approved)
      .map((reference) => reference.id);
    const canonicalReference = character.canonicalReferenceId
      ? book.references.find((reference) => reference.id === character.canonicalReferenceId)
      : null;
    const canonicalReferenceId =
      canonicalReference &&
      canonicalReference.approved &&
      canonicalReference.role !== "excluded" &&
      canonicalReference.characterIds.includes(character.id)
        ? canonicalReference.id
        : null;

    return {
      ...character,
      canonicalReferenceId,
      backupReferenceIds: dedupeStrings([
        ...(canonicalReferenceId ? [canonicalReferenceId] : []),
        ...approvedLinkedReferenceIds,
      ]),
      status: canonicalReferenceId ? character.status : "draft",
    };
  });

  book.status = recalcBookStatus(book);
}

async function loadReferenceInputs(
  draft: BookRecord,
  referenceIds: string[],
): Promise<Array<{ mimeType: string; fileName: string; buffer: Buffer }>> {
  const uniqueReferenceIds = dedupeStrings(referenceIds);
  const assets = uniqueReferenceIds
    .map((referenceId) => draft.references.find((reference) => reference.id === referenceId))
    .filter((reference): reference is ReferenceRecord => Boolean(reference))
    .map((reference) => draft.assets.find((asset) => asset.id === reference.assetId))
    .filter((asset): asset is AssetRecord => Boolean(asset));

  return Promise.all(
    assets.map(async (asset) => ({
      mimeType: asset.mimeType,
      fileName: asset.label,
      buffer: await readAssetBuffer(asset.relativePath),
    })),
  );
}

function buildCharacterPrompt(book: BookRecord, character: CharacterBible) {
  const bibleReferenceIds = getCharacterBibleReferenceIds(book, character);

  return [
    `Create a canonical portrait for ${character.name}.`,
    `Character bible: ${getCharacterBibleSummary(character)}`,
    `Age range: ${character.ageRange || "adult"}.`,
    `Sex: ${character.sex}.`,
    `Facial traits: ${character.facialTraits || "clear, memorable facial structure"}.`,
    `Body traits: ${character.bodyTraits || "book-appropriate silhouette"}.`,
    `Hair: ${character.hair || "story-consistent hair styling"}.`,
    `Vibe: ${character.vibe || "cinematic and emotionally readable"}.`,
    `Continuity notes: ${character.continuityNotes || "This portrait becomes the canonical reference for all later scenes."}`,
    `Visual direction: ${book.styleProfile.visualDirection}.`,
    `Palette: ${book.styleProfile.palette}.`,
    bibleReferenceIds.length
      ? `Use the approved character bible reference images to preserve face, silhouette, and identity.`
      : "Create a clean master look that can become the canonical character bible portrait.",
    "Framing: upper-body or three-quarter portrait, clean composition, no text, no watermark.",
  ].join("\n");
}

function sceneVisualReferences(book: BookRecord, scene: SceneRecord, role: "scene_reference" | "mood_reference") {
  return book.references.filter((reference) => {
    if (reference.role !== role || !reference.approved) return false;
    if (reference.derivationStatus === "rejected") return false;
    if (reference.sceneIds.includes(scene.id)) return true;
    if (reference.chapterIds.includes(scene.chapterId)) return true;
    return role === "mood_reference" && !reference.sceneIds.length && !reference.chapterIds.length;
  });
}

function referencePromptLine(book: BookRecord, reference: ReferenceRecord) {
  const asset = getReferenceAsset(book, reference);
  const { figureTitle, figureCaption } = getReferenceFigureText(book, reference);
  return [
    reference.label || figureTitle || asset?.label || "Untitled reference",
    figureCaption || "",
    stripAutoMatchNotes(reference.notes) || "",
  ]
    .filter(Boolean)
    .join(" - ");
}

function buildScenePrompt(book: BookRecord, scene: SceneRecord) {
  const characters = scene.characterIds
    .map((characterId) => book.characters.find((candidate) => candidate.id === characterId))
    .filter((candidate): candidate is CharacterBible => Boolean(candidate));
  const sceneReferences = sceneVisualReferences(book, scene, "scene_reference");
  const moodReferences = sceneVisualReferences(book, scene, "mood_reference");
  const continuity = characters
    .map((character) => {
      const modifier = scene.modifiers.find((entry) => entry.characterId === character.id);
      return `${character.name}: ${getCharacterBibleSummary(character)}${modifier ? `; scene modifier ${modifier.description}` : ""}`;
    })
    .join("\n");
  const sceneReferenceNotes = sceneReferences.map((reference) => referencePromptLine(book, reference)).join("\n");
  const moodReferenceNotes = moodReferences.map((reference) => referencePromptLine(book, reference)).join("\n");
  const characterReferenceIds = dedupeStrings(characters.flatMap((character) => getCharacterBibleReferenceIds(book, character)));
  const sceneReferenceIds = sceneReferences.map((reference) => reference.id);
  const moodReferenceIds = moodReferences.map((reference) => reference.id);

  const prompt = [
    `Create one polished key image for a book scene titled "${scene.title}".`,
    `Summary: ${scene.summary}.`,
    `Location: ${scene.location || "story location"}.`,
    `Time of day: ${scene.timeOfDay || "story-consistent lighting"}.`,
    `Mood: ${scene.mood || book.styleProfile.tone}.`,
    `Visual direction: ${book.styleProfile.visualDirection}.`,
    `Palette: ${book.styleProfile.palette}.`,
    `Medium: ${book.styleProfile.medium}.`,
    `Tone: ${book.styleProfile.tone}.`,
    continuity ? `Character continuity:\n${continuity}` : "Focus on environment, storytelling, and scene composition.",
    sceneReferenceNotes
      ? `Approved scene visual anchors:\n${sceneReferenceNotes}\nUse the attached scene reference images as direct composition, camera, setting, prop, color, and lighting anchors. Mirror the approved reference as closely as possible while adapting only what the scene text requires.`
      : "",
    moodReferenceNotes
      ? `Approved mood/world anchors:\n${moodReferenceNotes}\nUse these attached references to preserve the world look, atmosphere, architecture, materials, and palette.`
      : "",
    "Respect continuity. Keep recurring faces stable. Preserve approved visual anchors. No text, no watermark, no collage.",
  ].join("\n\n");

  const manifest: RenderManifest = {
    compiledPrompt: prompt,
    characterReferenceIds,
    sceneReferenceIds,
    moodReferenceIds,
    visualAnchorReferenceIds: dedupeStrings([...sceneReferenceIds, ...moodReferenceIds, ...characterReferenceIds]),
    styleNotes: `${book.styleProfile.visualDirection}; ${book.styleProfile.palette}; ${book.styleProfile.tone}`,
    modifiers: safeJson(scene.modifiers),
  };

  return { prompt, manifest };
}

function refreshScenePrompts(draft: BookRecord) {
  draft.scenes = draft.scenes.map((scene) => {
    const { prompt, manifest } = buildScenePrompt(draft, scene);
    return {
      ...scene,
      imagePrompt: prompt,
      renderManifest: manifest,
    };
  });
}

async function detectStoryboardCharacterPanels(
  draft: BookRecord,
  reference: ReferenceRecord,
  image: { mimeType: string; buffer: Buffer },
) {
  const { figureTitle, figureCaption } = getReferenceFigureText(draft, reference);
  const roster = draft.characters.map((character) => ({
    name: character.name,
    aliases: character.aliases,
    summary: getCharacterBibleSummary(character),
  }));

  const fallback = { candidates: [] as Array<{ characterName: string; confidence: number; x: number; y: number; width: number; height: number; reason: string }> };
  const result = await runVisionStructuredPrompt({
    model: STORYBOARD_EXTRACTION_MODEL,
    system: [
      "You identify single-character storyboard panels for an audiobook illustration pipeline.",
      "Only return crops when one named character is the clear visual subject.",
      "Do not return crops for environment shots, cityscapes, wide establishing shots, multi-character collages, or ambiguous tiny figures.",
      "Bounding boxes must be pixel coordinates relative to the full input image.",
    ].join("\n"),
    user: [
      `Reference label: ${getReferenceDisplayLabel(draft, reference)}.`,
      figureTitle ? `Figure title: ${figureTitle}.` : "",
      figureCaption ? `Figure caption: ${figureCaption}.` : "",
      `Known characters: ${JSON.stringify(roster)}.`,
      "Return only high-confidence single-character panels. Use empty candidates when uncertain.",
    ]
      .filter(Boolean)
      .join("\n"),
    image,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        candidates: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              characterName: { type: "string" },
              confidence: { type: "number" },
              x: { type: "number" },
              y: { type: "number" },
              width: { type: "number" },
              height: { type: "number" },
              reason: { type: "string" },
            },
            required: ["characterName", "confidence", "x", "y", "width", "height", "reason"],
          },
        },
      },
      required: ["candidates"],
    },
    fallback,
  });

  return Array.isArray(result.candidates) ? result.candidates : fallback.candidates;
}

async function extractStoryboardDerivedReferences(draft: BookRecord, parentReference: ReferenceRecord) {
  if (!isStoryboardSourceReference(draft, parentReference)) return;

  const parentAsset = getReferenceAsset(draft, parentReference);
  if (!parentAsset) return;

  const existingDerived = draft.references.filter(
    (reference) =>
      reference.sourceReferenceId === parentReference.id &&
      reference.derivationKind === "storyboard_crop_upscale",
  );
  const removableDerived = existingDerived.filter((reference) => {
    const lockedByCharacter = draft.characters.some((character) => character.canonicalReferenceId === reference.id);
    return !lockedByCharacter && reference.derivationStatus !== "approved";
  });

  if (removableDerived.length) {
    const removableAssetIds = new Set(removableDerived.map((reference) => reference.assetId));
    draft.references = draft.references.filter((reference) => !removableDerived.some((candidate) => candidate.id === reference.id));
    draft.assets = draft.assets.filter((asset) => !removableAssetIds.has(asset.id));
  }

  const preservedDerivedCharacterIds = new Set(
    existingDerived
      .filter((reference) => reference.derivationStatus === "approved")
      .flatMap((reference) => reference.characterIds),
  );

  const sourceBuffer = await readAssetBuffer(parentAsset.relativePath);
  const sharp = await getSharp();
  const imageInfo = await sharp(sourceBuffer).metadata();
  if (!imageInfo.width || !imageInfo.height) return;

  let candidates = await detectStoryboardCharacterPanels(draft, parentReference, {
    mimeType: parentAsset.mimeType,
    buffer: sourceBuffer,
  });
  if (!candidates.length) {
    candidates = fallbackStoryboardCandidates(draft, parentReference, imageInfo.width, imageInfo.height);
  }

  for (const candidate of candidates) {
    if (candidate.confidence < STORYBOARD_CROP_CONFIDENCE_THRESHOLD) continue;
    const character = findCharacterByCandidateName(draft, candidate.characterName);
    if (!character) continue;
    if (preservedDerivedCharacterIds.has(character.id)) continue;

    const crop = normalizeCrop(candidate, imageInfo.width, imageInfo.height);
    if (!crop) continue;

    const upscaledBuffer = await cropAndUpscaleStoryboardCandidate(sourceBuffer, crop);
    const label = `${character.name} storyboard crop`;
    const asset = await writeAssetBuffer(
      draft.id,
      "reference_image",
      `${slugify(character.name)}-${slugify(parentAsset.label)}-storyboard-crop.png`,
      "image/png",
      upscaledBuffer,
      {
        sourceDocument: typeof parentAsset.metadata?.sourceDocument === "string" ? parentAsset.metadata.sourceDocument : null,
        sourceReferenceId: parentReference.id,
        derivationKind: "storyboard_crop_upscale",
        parentFigureTitle: typeof parentAsset.metadata?.figureTitle === "string" ? parentAsset.metadata.figureTitle : null,
      },
    );

    draft.assets.push(asset);
    draft.references.push({
      id: createId("reference"),
      assetId: asset.id,
      source: "storyboard_derivation",
      role: "character_reference",
      approved: false,
      characterIds: [character.id],
      sceneIds: [],
      chapterIds: [...parentReference.chapterIds],
      sourceReferenceId: parentReference.id,
      derivationKind: "storyboard_crop_upscale",
      derivationStatus: "provisional",
      confidence: candidate.confidence,
      label,
      crop,
      notes: [
        `Derived from storyboard source ${getReferenceDisplayLabel(draft, parentReference)}.`,
        `Reason: ${candidate.reason}`,
        typeof parentAsset.metadata?.figureTitle === "string" ? `Parent title: ${parentAsset.metadata.figureTitle}` : "",
        typeof parentAsset.metadata?.figureCaption === "string" ? parentAsset.metadata.figureCaption : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
  }
}

async function analyzeChapters(
  parsedChapters: Array<{ id: string; title: string; text: string; order: number }>,
  bookTitle: string,
) {
  const aggregatedScenes: SceneRecord[] = [];
  const characterMap = new Map<string, CharacterBible>();

  for (const chapter of parsedChapters) {
    const fallbackScenes = splitFallbackScenes(chapter.id, chapter.title, chapter.text, chapter.order);
    const fallbackCharacterNames = extractFallbackCharacters(chapter.text);
    const fallbackPayload = {
      chapterSummary: chapter.text.slice(0, 220),
      scenes: fallbackScenes.map((scene) => ({
        title: scene.title,
        summary: scene.summary,
        mood: scene.mood,
        location: scene.location,
        timeOfDay: scene.timeOfDay,
        sourceText: scene.sourceText.slice(0, 1400),
        characters: fallbackCharacterNames.slice(0, 3),
        priority: scene.priority,
      })),
      characters: fallbackCharacterNames.map((name) => ({
        name,
        aliases: [],
        coreDescription: `${name} is a recurring figure in ${bookTitle}.`,
        ageRange: "adult",
        sex: "unknown",
        facialTraits: "",
        bodyTraits: "",
        hair: "",
        vibe: "",
        continuityNotes: "",
      })),
    };

    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["chapterSummary", "scenes", "characters"],
      properties: {
        chapterSummary: { type: "string" },
        scenes: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "summary", "mood", "location", "timeOfDay", "sourceText", "characters", "priority"],
            properties: {
              title: { type: "string" },
              summary: { type: "string" },
              mood: { type: "string" },
              location: { type: "string" },
              timeOfDay: { type: "string" },
              sourceText: { type: "string" },
              characters: { type: "array", items: { type: "string" } },
              priority: { type: "string", enum: ["key", "supporting", "background"] },
            },
          },
        },
        characters: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "name",
              "aliases",
              "coreDescription",
              "ageRange",
              "sex",
              "facialTraits",
              "bodyTraits",
              "hair",
              "vibe",
              "continuityNotes",
            ],
            properties: {
              name: { type: "string" },
              aliases: { type: "array", items: { type: "string" } },
              coreDescription: { type: "string" },
              ageRange: { type: "string" },
              sex: { type: "string", enum: ["female", "male", "unknown"] },
              facialTraits: { type: "string" },
              bodyTraits: { type: "string" },
              hair: { type: "string" },
              vibe: { type: "string" },
              continuityNotes: { type: "string" },
            },
          },
        },
      },
    };

    const payload = await runStructuredPrompt({
      system:
        "You are a story-production analyst. Segment a chapter into coherent scene units, identify recurring characters, and produce continuity-ready notes for illustration and audiobook rendering.",
      user: `Book title: ${bookTitle}
Chapter title: ${chapter.title}

Chapter text:
${chapter.text.slice(0, 12000)}

Return a compact scene list for production. Include only important recurring characters or scene-specific speakers. Keep sourceText excerpts short and representative.`,
      schema,
      fallback: fallbackPayload,
    });

    const payloadSceneTexts = (payload.scenes ?? []).map((scene: { sourceText?: string; summary?: string }) => scene.sourceText || scene.summary || "");
    const averageSceneLength =
      payloadSceneTexts.length > 0
        ? payloadSceneTexts.reduce((total: number, value: string) => total + value.length, 0) / payloadSceneTexts.length
        : 0;
    const scenePayload =
      (payload.scenes ?? []).length > 12 || averageSceneLength < 350 ? fallbackPayload.scenes : (payload.scenes ?? fallbackPayload.scenes);
    const characterPayload = (payload.characters ?? fallbackPayload.characters).filter(
      (character: { name?: string }) => character.name && !isLikelyFalseCharacterName(character.name),
    );

    for (const character of characterPayload) {
      const key = normalizeName(character.name).toLowerCase();
      if (!key) continue;
      const existing = characterMap.get(key);
      if (!existing) {
        characterMap.set(
          key,
          createCharacterBibleCard(normalizeName(character.name), bookTitle, {
            aliases: dedupeStrings(character.aliases ?? []),
            coreDescription: character.coreDescription ?? "",
            ageRange: character.ageRange ?? "adult",
            sex: (character.sex as CharacterSex) ?? "unknown",
            facialTraits: character.facialTraits ?? "",
            bodyTraits: character.bodyTraits ?? "",
            hair: character.hair ?? "",
            vibe: character.vibe ?? "",
            continuityNotes: character.continuityNotes ?? "",
          }),
        );
      }
    }

    scenePayload.forEach((scene, index) => {
      const characterIds = dedupeStrings(scene.characters ?? [])
        .map((name) => characterMap.get(normalizeName(name).toLowerCase())?.id ?? null)
        .filter((value): value is string => Boolean(value));

      aggregatedScenes.push({
        id: createId("scene"),
        chapterId: chapter.id,
        order: chapter.order * 100 + index + 1,
        title: scene.title || `${chapter.title} Scene ${index + 1}`,
        sourceText: scene.sourceText || chapter.text.slice(index * 800, index * 800 + 1200),
        summary: scene.summary || chapter.text.slice(0, 240),
        mood: scene.mood || "dramatic",
        location: scene.location || "unspecified",
        timeOfDay: scene.timeOfDay || "unspecified",
        characterIds,
        modifiers: [],
        imagePrompt: "",
        imageStatus: "missing",
        audioStatus: "missing",
        reviewStatus: "pending",
        priority: (scene.priority as ScenePriority) || "supporting",
        imageAssetId: null,
        audioAssetId: null,
        estimatedDurationSeconds: estimateDuration(scene.sourceText || scene.summary || ""),
        renderManifest: null,
      });
    });
  }

  return {
    scenes: aggregatedScenes,
    characters: [...characterMap.values()],
  };
}

export async function listBookSummaries() {
  return listBooks();
}

export async function deleteBookWorkspace(bookId: string) {
  const book = await getBookById(bookId);
  if (!book) throw new Error("Book not found.");
  await deleteBookRecord(bookId);
  return { id: bookId, title: book.title };
}

function buildBookRecord(
  bookId: string,
  parsed: Awaited<ReturnType<typeof parseManuscript>>,
  manuscriptAsset: AssetRecord,
): BookRecord {
  const chapters: ChapterRecord[] = parsed.chapters.map((chapter, index) => ({
    id: createId("chapter"),
    order: index + 1,
    title: chapter.title || `Chapter ${index + 1}`,
    summary: chapter.text.slice(0, 220),
    sceneIds: [],
    audioAssetId: null,
    videoAssetId: null,
  }));

  return {
    id: bookId,
    slug: slugify(parsed.title),
    title: parsed.title,
    synopsis: parsed.synopsis,
    status: "Draft",
    manuscriptText: parsed.text,
    manuscriptAssetId: manuscriptAsset.id,
    coverAssetId: null,
    styleProfile: { ...DEFAULT_STYLE },
    chapters,
    scenes: [],
    characters: [],
    references: [],
    assets: [manuscriptAsset],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    publishedAt: null,
  };
}

async function importCharacterBibleDocument(
  bookId: string,
  input: {
    fileName: string;
    mimeType: string;
    buffer: Buffer;
    existingAsset?: AssetRecord;
    skipSourceAsset?: boolean;
  },
) {
  const parsed = await parseCharacterBibleDocx(input.fileName, input.buffer);

  return (
    await mutateBookRecord(bookId, async (draft) => {
      if (!draft.characters.length) {
        const seeds = await extractExplicitCharacterBibles(draft.manuscriptText, draft.title);
        if (seeds.length) {
          upsertCharacterBibleSeed(draft, seeds);
        }
      }

      const sourceAsset =
        input.existingAsset ??
        (input.skipSourceAsset
          ? null
          : await writeAssetBuffer(
              bookId,
              "character_bible_document",
              input.fileName,
              input.mimeType || "application/octet-stream",
              input.buffer,
              {
                sourceDocument: input.fileName,
                documentRole: "character_bible",
              },
            ));

      if (sourceAsset && !draft.assets.some((asset) => asset.id === sourceAsset.id)) {
        draft.assets.push(sourceAsset);
      }

      const replaceableReferenceIds = new Set(
        draft.references
          .filter((reference) => {
            if (reference.source !== "character_bible_import" || reference.approved) return false;
            if (draft.characters.some((character) => character.canonicalReferenceId === reference.id)) return false;
            const asset = draft.assets.find((candidate) => candidate.id === reference.assetId);
            return asset?.metadata?.sourceDocument === input.fileName;
          })
          .map((reference) => reference.id),
      );
      const replaceableAssetIds = new Set(
        draft.references
          .filter((reference) => replaceableReferenceIds.has(reference.id))
          .map((reference) => reference.assetId),
      );

      if (replaceableReferenceIds.size) {
        draft.references = draft.references.filter((reference) => !replaceableReferenceIds.has(reference.id));
        const stillUsedAssetIds = new Set(draft.references.map((reference) => reference.assetId));
        const assetsToDelete = draft.assets.filter(
          (asset) => replaceableAssetIds.has(asset.id) && !stillUsedAssetIds.has(asset.id),
        );
        draft.assets = draft.assets.filter((asset) => !assetsToDelete.some((deletedAsset) => deletedAsset.id === asset.id));
        await Promise.all(assetsToDelete.map((asset) => deleteAssetFile(asset).catch(() => undefined)));
      }

      const importedCards =
        parsed.figures.length === 0
          ? await extractExplicitCharacterBibles(parsed.text, draft.title)
          : buildImportedCardsFromFigures(
              draft,
              parsed.figures
                .filter((figure) => inferReferenceRoleFromText([figure.title, figure.caption].join(" ")) === "character_reference")
                .map((figure) => ({
                  title: figure.title,
                  caption: figure.caption,
                  description: [figure.title, figure.caption].filter(Boolean).join(". "),
                })),
            ).map((card) => createCharacterBibleCard(card.name, draft.title, card));

      if (parsed.figures.length === 0 && importedCards.length) {
        upsertCharacterBibleSeed(draft, importedCards);
      }

      if (importedCards.length) {
        enrichCharactersFromImportedCards(
          draft,
          importedCards.map((card) => ({
            name: card.name,
            aliases: card.aliases,
            coreDescription: card.coreDescription,
            ageRange: card.ageRange,
            sex: card.sex,
            facialTraits: card.facialTraits,
            bodyTraits: card.bodyTraits,
            hair: card.hair,
            vibe: card.vibe,
            continuityNotes: card.continuityNotes,
          })),
        );
      }

      const newAssets: AssetRecord[] = [];
      const newReferences: ReferenceRecord[] = [];

      for (const figure of parsed.figures) {
        if (!figure.image) continue;

        const role = figure.inferredRole;
        const seededCharacter = ensureWorldBibleCharacter(
          draft,
          characterNameFromWorldBibleFigure(figure),
          figure.description,
        );
        const referenceSignalText = [figure.sourceCode ?? "", figure.title, figure.caption, figure.description].filter(Boolean).join(" ");
        const characterIds = dedupeStrings([
          ...(seededCharacter ? [seededCharacter.id] : []),
          ...extractKnownCharactersFromText(draft, referenceSignalText),
        ]);
        const chapterIds = matchChapterIds(draft, [
          figure.sourceCode ?? "",
          figure.title,
          figure.caption,
          figure.inferredChapterLabel ?? "",
          String(figure.inferredChapterNumber ?? ""),
        ]);
        const normalizedImage = await normalizeImportedReferenceImage(
          figure.image.fileName,
          figure.image.mimeType,
          figure.image.buffer,
        );

        const asset = await writeAssetBuffer(
          bookId,
          "reference_image",
          normalizedImage.fileName,
          normalizedImage.mimeType,
          normalizedImage.buffer,
          {
            sourceDocument: input.fileName,
            sourceCode: figure.sourceCode ?? null,
            sourceSection: figure.sourceSection ?? null,
            sourceStatus: figure.status ?? null,
            canonBaseline: figure.canonBaseline ?? null,
            figureTitle: figure.title || null,
            figureCaption: figure.caption || null,
            inferredRole: role,
            inferredChapterLabel: figure.inferredChapterLabel ?? null,
            inferredChapterNumber: figure.inferredChapterNumber ?? null,
          },
        );

        newAssets.push(asset);
        newReferences.push({
          id: createId("reference"),
          assetId: asset.id,
          source: "character_bible_import",
          role,
          approved: false,
          characterIds,
          sceneIds: [],
          chapterIds,
          sourceReferenceId: null,
          derivationKind: "none",
          derivationStatus: "approved",
          confidence: null,
          label: figure.caption?.replace(/^Figure\s+/i, "") || figure.title || figure.sourceCode || path.basename(figure.image.fileName),
          crop: null,
          notes: [
            `Imported from ${input.fileName}.`,
            figure.sourceCode ? `Code: ${figure.sourceCode}` : "",
            figure.sourceSection,
            figure.status,
            figure.canonBaseline,
            figure.title ? `Title: ${figure.title}` : "",
            figure.caption,
          ]
            .filter(Boolean)
            .join("\n\n"),
        });
      }

      draft.assets.push(...newAssets);
      draft.references.push(...newReferences);
      autoLinkReferencesToCharacters(draft);
      autoLinkReferencesToScenes(draft);
      syncCharacterBibleReferences(draft);
      refreshScenePrompts(draft);
      return draft;
    })
  ).book;
}

/**
 * Step 1 of the large-file upload flow: mint a direct-to-storage upload target.
 * The browser uploads the manuscript straight to Supabase Storage (no size
 * limit), then calls importBookFromStorageRef with the returned reference.
 * Returns { direct: false } when remote storage is unavailable so the client
 * can fall back to the legacy in-request formData upload.
 */
export async function createBookAssetUploadTarget(
  fileName: string,
  mimeType: string,
  kind: "manuscript" | "character_bible_document" | "character_bible_chunk" = "manuscript",
  bookId = createId("book"),
) {
  if (!fileName) {
    throw new Error("A file name is required to start the upload.");
  }

  const target = await createSignedUploadTarget(bookId, kind, fileName);
  if (!target) {
    return { direct: false as const, bookId };
  }

  return {
    direct: true as const,
    bookId,
    assetId: target.assetId,
    relativePath: target.relativePath,
    signedUrl: target.signedUrl,
    fileName,
    mimeType: mimeType || "application/octet-stream",
  };
}

export async function createManuscriptUploadTarget(fileName: string, mimeType: string) {
  return createBookAssetUploadTarget(fileName, mimeType, "manuscript");
}

/**
 * Step 2 of the large-file upload flow: the manuscript is already in storage;
 * download it, parse it, and create the workspace. No analysis here (see note
 * in importBookFromUpload) — that runs separately via /analyze.
 */
export async function importBookFromStorageRef(input: {
  bookId: string;
  assetId: string;
  relativePath: string;
  fileName: string;
  mimeType: string;
}) {
  if (!input?.bookId || !input.assetId || !input.relativePath || !input.fileName) {
    throw new Error("Incomplete upload reference. Please re-upload the manuscript.");
  }

  const buffer = await readAssetBuffer(input.relativePath);
  const parsed = await parseManuscriptFromBuffer(input.fileName, buffer);

  const manuscriptAsset: AssetRecord = {
    id: input.assetId,
    kind: "manuscript",
    label: input.fileName,
    mimeType: input.mimeType || "application/octet-stream",
    relativePath: input.relativePath,
    createdAt: nowIso(),
  };

  const book = buildBookRecord(input.bookId, parsed, manuscriptAsset);
  return saveBookRecord(book);
}

export async function importCharacterBibleFromStorageRef(
  bookId: string,
  input: {
    assetId: string;
    relativePath: string;
    fileName: string;
    mimeType: string;
    chunks?: Array<{ relativePath: string; assetId?: string }>;
  },
) {
  if (!bookId || !input?.fileName || (!input.relativePath && !input.chunks?.length)) {
    throw new Error("Incomplete character bible upload reference. Please re-upload the file.");
  }

  if (input.chunks?.length) {
    const buffers = await Promise.all(input.chunks.map((chunk) => readAssetBuffer(chunk.relativePath)));
    const buffer = Buffer.concat(buffers);
    const book = await importCharacterBibleDocument(bookId, {
      fileName: input.fileName,
      mimeType: input.mimeType,
      buffer,
      skipSourceAsset: true,
    });

    await Promise.all(
      input.chunks.map((chunk) =>
        deleteAssetFile({
          id: chunk.assetId ?? chunk.relativePath,
          kind: "character_bible_document",
          label: path.basename(chunk.relativePath),
          mimeType: input.mimeType || "application/octet-stream",
          relativePath: chunk.relativePath,
          createdAt: nowIso(),
        }).catch(() => undefined),
      ),
    );

    return book;
  }

  if (!input.assetId || !input.relativePath) {
    throw new Error("Incomplete character bible upload reference. Please re-upload the file.");
  }

  const buffer = await readAssetBuffer(input.relativePath);
  const asset: AssetRecord = {
    id: input.assetId,
    kind: "character_bible_document",
    label: input.fileName,
    mimeType: input.mimeType || "application/octet-stream",
    relativePath: input.relativePath,
    createdAt: nowIso(),
    metadata: {
      sourceDocument: input.fileName,
      documentRole: "character_bible",
    },
  };

  return importCharacterBibleDocument(bookId, {
    fileName: input.fileName,
    mimeType: input.mimeType,
    buffer,
    existingAsset: asset,
  });
}

export async function importBookFromUpload(formData: FormData) {
  const manuscript = formData.get("manuscript");
  if (!(manuscript instanceof File)) {
    throw new Error("Upload a manuscript file to create a book.");
  }

  const parsed = await parseManuscript(manuscript);
  const bookId = createId("book");
  const manuscriptAsset = await writeAssetBuffer(
    bookId,
    "manuscript",
    manuscript.name,
    manuscript.type || "application/octet-stream",
    Buffer.from(await manuscript.arrayBuffer()),
  );

  const book = buildBookRecord(bookId, parsed, manuscriptAsset);

  const savedBook = await saveBookRecord(book);

  // Note: scene/character analysis is intentionally NOT run here. It makes one
  // sequential OpenAI call per chapter and can exceed the serverless function
  // timeout on large manuscripts, which previously crashed the upload to an
  // error page. The workspace is created instantly; analysis is triggered
  // separately from the studio console ("Analyze manuscript") via /analyze.
  const imports = formData.getAll("references").filter((entry): entry is File => entry instanceof File && entry.size > 0);
  const referenceZip = formData.get("referenceZip");
  if (imports.length || (referenceZip instanceof File && referenceZip.size > 0)) {
    return importReferenceFiles(bookId, formData);
  }

  return savedBook;
}

export async function importCharacterBibleUpload(bookId: string, formData: FormData) {
  const characterBible = formData.get("characterBible");
  if (!(characterBible instanceof File) || characterBible.size === 0) {
    throw new Error("Upload a character bible file to continue.");
  }

  return importCharacterBibleDocument(bookId, {
    fileName: characterBible.name,
    mimeType: characterBible.type || "application/octet-stream",
    buffer: Buffer.from(await characterBible.arrayBuffer()),
  });
}

export async function analyzeBook(bookId: string) {
  const book = await getBookById(bookId);
  if (!book) throw new Error("Book not found.");

  const reparsed = await parseManuscriptFromBuffer(`${book.slug || book.id}.txt`, Buffer.from(book.manuscriptText, "utf8"));
  const chapters = book.chapters.map((chapter) => {
    const parsedChapter = reparsed.chapters[chapter.order - 1];
    return {
      id: chapter.id,
      title: parsedChapter?.title || chapter.title,
      text: parsedChapter?.text || chapter.summary || book.manuscriptText,
      order: chapter.order,
    };
  });

  const analyzed = await analyzeChapters(chapters, book.title);
  const explicitCharacterBibles = await extractExplicitCharacterBibles(book.manuscriptText, book.title);
  const filteredAnalyzedCharacters = explicitCharacterBibles.length
    ? analyzed.characters.filter((character) => {
        const analyzedKeys = new Set(characterKeys(character));
        return explicitCharacterBibles.some((explicitCharacter) =>
          characterKeys(explicitCharacter).some((key) => analyzedKeys.has(key)),
        );
      })
    : analyzed.characters;
  const enrichedCharacters = mergeCharacterBibles(explicitCharacterBibles, filteredAnalyzedCharacters);
  const chapterSceneMap = new Map<string, string[]>();
  analyzed.scenes.forEach((scene) => {
    const list = chapterSceneMap.get(scene.chapterId) ?? [];
    list.push(scene.id);
    chapterSceneMap.set(scene.chapterId, list);
  });

  return (
    await mutateBookRecord(bookId, (draft) => {
      const { characters, characterIdMap } = mergeCharacterBibles(draft.characters, enrichedCharacters.characters);
      draft.characters = characters;
      const falseCharacterIds = new Set(
        draft.characters
          .filter((character) => isLikelyFalseCharacterName(character.name) && !character.canonicalReferenceId)
          .map((character) => character.id),
      );
      if (falseCharacterIds.size) {
        draft.references = draft.references.map((reference) => ({
          ...reference,
          characterIds: reference.characterIds.filter((characterId) => !falseCharacterIds.has(characterId)),
        }));
        draft.characters = draft.characters.filter((character) => !falseCharacterIds.has(character.id));
      }
      autoLinkReferencesToCharacters(draft);
      autoLinkReferencesToScenes(draft);
      syncCharacterBibleReferences(draft);
      draft.scenes = analyzed.scenes.map((scene) => {
        const mappedCharacterIds = scene.characterIds.map((characterId) => characterIdMap.get(characterId) ?? characterId);
        const knownCharacterIds = extractKnownCharactersFromText(draft, [scene.sourceText, scene.summary, scene.title].join("\n"));
        const nextScene = {
          ...scene,
          characterIds: dedupeStrings(knownCharacterIds.length ? knownCharacterIds : mappedCharacterIds).filter((characterId) => {
            const character = draft.characters.find((candidate) => candidate.id === characterId);
            return character ? !isLikelyFalseCharacterName(character.name) : false;
          }),
        };
        const { prompt, manifest } = buildScenePrompt(draft, nextScene);
        return { ...nextScene, imagePrompt: prompt, renderManifest: manifest };
      });
      const usedCharacterIds = new Set(draft.scenes.flatMap((scene) => scene.characterIds));
      const referencedCharacterIds = new Set(draft.references.flatMap((reference) => reference.characterIds));
      draft.characters = draft.characters.filter((character) => {
        if (!isLikelyFalseCharacterName(character.name)) return true;
        if (usedCharacterIds.has(character.id)) return true;
        if (referencedCharacterIds.has(character.id)) return true;
        return Boolean(character.canonicalReferenceId || character.backupReferenceIds.length);
      });
      draft.chapters = draft.chapters.map((chapter) => ({
        ...chapter,
        title: reparsed.chapters[chapter.order - 1]?.title || chapter.title,
        summary: reparsed.chapters[chapter.order - 1]?.text.slice(0, 240) || chapter.summary,
        sceneIds: chapterSceneMap.get(chapter.id) ?? [],
      }));
      return draft;
    })
  ).book;
}

// Appends new chapters to a book that already has rendered media, without
// touching its existing chapters/scenes/assets. Unlike analyzeBook, which
// reparses the book's *entire* manuscript and replaces the whole scene list
// (fine for a fresh import, but it would mint new scene IDs for every
// chapter and orphan already-rendered images/audio/video), this only runs
// scene/character analysis on the supplied new-chapter text and merges the
// result in additively. Do not call analyzeBook again on a book this has
// been used on.
export async function appendChaptersFromText(bookId: string, additionalManuscriptText: string) {
  const book = await getBookById(bookId);
  if (!book) throw new Error("Book not found.");

  const parsed = await parseManuscriptFromBuffer(
    `${book.slug || book.id}-addendum.txt`,
    Buffer.from(additionalManuscriptText, "utf8"),
  );
  if (!parsed.chapters.length) throw new Error("No chapters found in the supplied text.");

  const startOrder = book.chapters.length ? Math.max(...book.chapters.map((chapter) => chapter.order)) + 1 : 1;

  const newChapterInputs = parsed.chapters.map((chapter, index) => ({
    id: createId("chapter"),
    title: chapter.title,
    text: chapter.text,
    order: startOrder + index,
  }));

  const analyzed = await analyzeChapters(newChapterInputs, book.title);

  return (
    await mutateBookRecord(bookId, (draft) => {
      const existingCharacterIds = new Set(draft.characters.map((character) => character.id));
      const { characters, characterIdMap } = mergeCharacterBibles(draft.characters, analyzed.characters);

      // Characters that didn't match the existing roster are new to this
      // batch. Match the precedent from the original import: only the
      // locked canon cast blocks rendering, so new incidental names default
      // to optional instead of stalling every scene they appear in on a
      // missing portrait. Give them the book's established uniform
      // narration voice instead of the default per-character voice policy.
      draft.characters = characters.map((character) => {
        if (existingCharacterIds.has(character.id)) return character;
        return {
          ...character,
          requiredForRender: false,
          voiceAssignment: {
            narratorVoice: "marin",
            characterVoice: "onyx",
            fallbackVoice: "sage",
            rationale: `${character.name} assigned the book's uniform narration voice (onyx).`,
          },
        };
      });

      const chapterSceneMap = new Map<string, string[]>();
      analyzed.scenes.forEach((scene) => {
        const list = chapterSceneMap.get(scene.chapterId) ?? [];
        list.push(scene.id);
        chapterSceneMap.set(scene.chapterId, list);
      });

      const newScenes: SceneRecord[] = analyzed.scenes.map((scene) => {
        const mappedCharacterIds = scene.characterIds.map((characterId) => characterIdMap.get(characterId) ?? characterId);
        const knownCharacterIds = extractKnownCharactersFromText(draft, [scene.sourceText, scene.summary, scene.title].join("\n"));
        const nextScene = {
          ...scene,
          characterIds: dedupeStrings(knownCharacterIds.length ? knownCharacterIds : mappedCharacterIds).filter((characterId) => {
            const character = draft.characters.find((candidate) => candidate.id === characterId);
            return character ? !isLikelyFalseCharacterName(character.name) : false;
          }),
        };
        const { prompt, manifest } = buildScenePrompt(draft, nextScene);
        return { ...nextScene, imagePrompt: prompt, renderManifest: manifest };
      });

      draft.scenes = [...draft.scenes, ...newScenes];

      const newChapters: ChapterRecord[] = newChapterInputs.map((input) => ({
        id: input.id,
        order: input.order,
        title: input.title,
        summary: input.text.slice(0, 220),
        sceneIds: chapterSceneMap.get(input.id) ?? [],
        audioAssetId: null,
        videoAssetId: null,
      }));

      draft.chapters = [...draft.chapters, ...newChapters];
      draft.manuscriptText = `${draft.manuscriptText.trim()}\n\n${newChapterInputs
        .map((input) => `${input.title}\n\n${input.text}`)
        .join("\n\n")}`;

      autoLinkReferencesToCharacters(draft);
      autoLinkReferencesToScenes(draft);
      syncCharacterBibleReferences(draft);

      return draft;
    })
  ).book;
}

export async function importReferenceFiles(bookId: string, formData: FormData) {
  const book = await getBookById(bookId);
  if (!book) throw new Error("Book not found.");

  const uploadedFiles = formData.getAll("references").filter((entry): entry is File => entry instanceof File && entry.size > 0);
  const uploadedZip = formData.get("referenceZip");
  const newAssets: AssetRecord[] = [];
  const newReferences: ReferenceRecord[] = [];
  let importedCount = 0;

  const pushReferenceBuffer = async (
    fileName: string,
    mimeType: string,
    buffer: Buffer,
    options: {
      notes?: string;
      sourceDocument?: string | null;
      role?: ReferenceRole;
      label?: string | null;
      chapterIds?: string[];
      figureTitle?: string | null;
      figureCaption?: string | null;
      sourceCode?: string | null;
      sourceSection?: string | null;
      sourceStatus?: string | null;
      canonBaseline?: string | null;
    } = {},
  ) => {
    const normalizedImage = await normalizeImportedReferenceImage(fileName, mimeType, buffer);
    const asset = await writeAssetBuffer(bookId, "reference_image", normalizedImage.fileName, normalizedImage.mimeType, normalizedImage.buffer, {
      importedFromDocument: options.sourceDocument ?? null,
      sourceCode: options.sourceCode ?? null,
      sourceSection: options.sourceSection ?? null,
      sourceStatus: options.sourceStatus ?? null,
      canonBaseline: options.canonBaseline ?? null,
      figureTitle: options.figureTitle ?? null,
      figureCaption: options.figureCaption ?? null,
    });
    newAssets.push(asset);
    newReferences.push({
      id: createId("reference"),
      assetId: asset.id,
      source: "upload",
      role: options.role ?? "character_reference",
      approved: false,
      characterIds: [],
      sceneIds: [],
      chapterIds: options.chapterIds ?? [],
      sourceReferenceId: null,
      derivationKind: "none",
      derivationStatus: "approved",
      confidence: null,
      label: options.label ?? fileName,
      crop: null,
      notes: options.notes ?? "",
    });
    importedCount += 1;
  };

  const importReferenceDoc = async (fileName: string, buffer: Buffer) => {
    const parsed = await parseCharacterBibleDocx(fileName, buffer);
    for (const figure of parsed.figures) {
      if (!figure.image) continue;
      const notes = [
        `Imported from ${figure.sourceDocument}.`,
        figure.title ? `Title: ${figure.title}` : "",
        figure.caption,
      ]
        .filter(Boolean)
        .join("\n\n");
      await pushReferenceBuffer(figure.image.fileName, figure.image.mimeType, figure.image.buffer, {
        notes,
        sourceDocument: figure.sourceDocument,
        role: figure.inferredRole,
        label: figure.caption?.replace(/^Figure\s+/i, "") || figure.title || figure.sourceCode || figure.image.fileName,
        chapterIds: matchChapterIds(book, [
          figure.sourceCode ?? "",
          figure.title,
          figure.caption,
          figure.inferredChapterLabel ?? "",
          String(figure.inferredChapterNumber ?? ""),
        ]),
        figureTitle: figure.title || null,
        figureCaption: figure.caption || null,
        sourceCode: figure.sourceCode ?? null,
        sourceSection: figure.sourceSection ?? null,
        sourceStatus: figure.status ?? null,
        canonBaseline: figure.canonBaseline ?? null,
      });
    }
  };

  for (const file of uploadedFiles) {
    const extension = fileExtension(file.name);
    const buffer = Buffer.from(await file.arrayBuffer());
    if (IMAGE_EXTENSIONS.has(extension)) {
      await pushReferenceBuffer(
        file.name,
        file.type || SUPPORTED_IMAGE_TYPES[extension] || "application/octet-stream",
        buffer,
      );
      continue;
    }

    if (REFERENCE_DOCUMENT_EXTENSIONS.has(extension)) {
      await importReferenceDoc(file.name, buffer);
    }
  }

  if (uploadedZip instanceof File && uploadedZip.size > 0) {
    const zip = new AdmZip(Buffer.from(await uploadedZip.arrayBuffer()));
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      const extension = fileExtension(entry.entryName);
      if (IMAGE_EXTENSIONS.has(extension)) {
        await pushReferenceBuffer(path.basename(entry.entryName), SUPPORTED_IMAGE_TYPES[extension], entry.getData());
        continue;
      }

      if (REFERENCE_DOCUMENT_EXTENSIONS.has(extension)) {
        await importReferenceDoc(path.basename(entry.entryName), entry.getData());
      }
    }
  }

  if (!importedCount && (uploadedFiles.length || (uploadedZip instanceof File && uploadedZip.size > 0))) {
    throw new Error("Reference imports support image files, .docx files, and .zip packages containing either.");
  }

  if (!newAssets.length) {
    return book;
  }

  return (
    await mutateBookRecord(bookId, async (draft) => {
      draft.assets.push(...newAssets);
      draft.references.push(...newReferences);
      for (const reference of newReferences.filter((candidate) => isStoryboardSourceReference(draft, candidate))) {
        await extractStoryboardDerivedReferences(draft, reference);
      }
      autoLinkReferencesToCharacters(draft);
      autoLinkReferencesToScenes(draft);
      syncCharacterBibleReferences(draft);
      refreshScenePrompts(draft);
      draft.updatedAt = nowIso();
      return draft;
    })
  ).book;
}

export async function getBookSnapshot(bookId: string) {
  return getBookById(bookId);
}

export async function getPublishedBook(slug: string) {
  const book = await getBookBySlug(slug);
  if (!book || book.status !== "Published") return null;
  return book;
}

export async function listPublishedBooks() {
  const store = await readStore();
  return store.books.filter((book) => book.status === "Published");
}

export async function updateReference(referenceId: string, patch: Partial<ReferenceRecord>) {
  const store = await readStore();
  const book = store.books.find((candidate) =>
    candidate.references.some((reference) => reference.id === referenceId),
  );
  if (!book) throw new Error("Reference not found.");

  return (
    await mutateBookRecord(book.id, (draft) => {
      const reference = draft.references.find((candidate) => candidate.id === referenceId);
      if (!reference) throw new Error("Reference not found.");
      reference.role = (patch.role as ReferenceRole) ?? reference.role;
      reference.approved = patch.approved ?? reference.approved;
      reference.characterIds = patch.characterIds ? dedupeStrings(patch.characterIds) : reference.characterIds;
      reference.sceneIds = patch.sceneIds ? dedupeStrings(patch.sceneIds) : reference.sceneIds;
      reference.chapterIds = patch.chapterIds ? dedupeStrings(patch.chapterIds) : reference.chapterIds;
      reference.sourceReferenceId = patch.sourceReferenceId ?? reference.sourceReferenceId;
      reference.derivationKind = patch.derivationKind ?? reference.derivationKind;
      reference.derivationStatus = patch.derivationStatus ?? reference.derivationStatus;
      reference.confidence = typeof patch.confidence === "number" ? patch.confidence : reference.confidence;
      reference.label = patch.label ?? reference.label;
      reference.crop = patch.crop ?? reference.crop;
      reference.notes = patch.notes ?? reference.notes;
      if ((patch.role || patch.label !== undefined || patch.notes !== undefined) && !patch.sceneIds && !patch.chapterIds) {
        autoLinkReferencesToScenes(draft);
      }
      syncCharacterBibleReferences(draft);
      refreshScenePrompts(draft);
      return draft;
    })
  ).book;
}

export async function extractReferenceCharacterCandidates(referenceId: string) {
  const store = await readStore();
  const book = store.books.find((candidate) =>
    candidate.references.some((reference) => reference.id === referenceId),
  );
  if (!book) throw new Error("Reference not found.");

  return (
    await mutateBookRecord(book.id, async (draft) => {
      const reference = draft.references.find((candidate) => candidate.id === referenceId);
      if (!reference) throw new Error("Reference not found.");
      if (!isStoryboardSourceReference(draft, reference)) {
        throw new Error("Only storyboard source references can generate character crops.");
      }

      await extractStoryboardDerivedReferences(draft, reference);
      autoLinkReferencesToCharacters(draft);
      autoLinkReferencesToScenes(draft);
      syncCharacterBibleReferences(draft);
      refreshScenePrompts(draft);
      return draft;
    })
  ).book;
}

export async function updateCharacterBible(
  characterId: string,
  patch: Partial<
    Pick<
      CharacterBible,
      | "name"
      | "aliases"
      | "coreDescription"
      | "ageRange"
      | "sex"
      | "facialTraits"
      | "bodyTraits"
      | "hair"
      | "vibe"
      | "continuityNotes"
      | "requiredForRender"
    >
  >,
) {
  const store = await readStore();
  const book = store.books.find((candidate) => candidate.characters.some((character) => character.id === characterId));
  if (!book) throw new Error("Character not found.");

  return (
    await mutateBookRecord(book.id, (draft) => {
      const character = draft.characters.find((candidate) => candidate.id === characterId);
      if (!character) throw new Error("Character not found.");

      character.name = patch.name ? normalizeName(patch.name) : character.name;
      character.aliases = patch.aliases ? dedupeStrings(patch.aliases.map((alias) => normalizeName(alias))) : character.aliases;
      character.coreDescription = patch.coreDescription ?? character.coreDescription;
      character.ageRange = patch.ageRange ?? character.ageRange;
      character.sex = patch.sex ?? character.sex;
      character.facialTraits = patch.facialTraits ?? character.facialTraits;
      character.bodyTraits = patch.bodyTraits ?? character.bodyTraits;
      character.hair = patch.hair ?? character.hair;
      character.vibe = patch.vibe ?? character.vibe;
      character.continuityNotes = patch.continuityNotes ?? character.continuityNotes;
      character.requiredForRender = patch.requiredForRender ?? character.requiredForRender;

      autoLinkReferencesToCharacters(draft);
      syncCharacterBibleReferences(draft);
      draft.scenes = draft.scenes.map((scene) => {
        if (!scene.characterIds.includes(character.id)) return scene;
        const { prompt, manifest } = buildScenePrompt(draft, scene);
        return { ...scene, imagePrompt: prompt, renderManifest: manifest };
      });
      return draft;
    })
  ).book;
}

export async function updateScene(sceneId: string, patch: Partial<SceneRecord>) {
  const store = await readStore();
  const book = store.books.find((candidate) => candidate.scenes.some((scene) => scene.id === sceneId));
  if (!book) throw new Error("Scene not found.");

  return (
    await mutateBookRecord(book.id, (draft) => {
      const scene = draft.scenes.find((candidate) => candidate.id === sceneId);
      if (!scene) throw new Error("Scene not found.");
      scene.title = patch.title ?? scene.title;
      scene.summary = patch.summary ?? scene.summary;
      scene.location = patch.location ?? scene.location;
      scene.mood = patch.mood ?? scene.mood;
      scene.timeOfDay = patch.timeOfDay ?? scene.timeOfDay;
      scene.reviewStatus = patch.reviewStatus ?? scene.reviewStatus;
      scene.priority = patch.priority ?? scene.priority;
      scene.imagePrompt = patch.imagePrompt ?? scene.imagePrompt;
      if (patch.modifiers) scene.modifiers = safeJson(patch.modifiers as SceneCharacterModifier[]);
      const { prompt, manifest } = buildScenePrompt(draft, scene);
      scene.imagePrompt = patch.imagePrompt ?? prompt;
      scene.renderManifest = manifest;
      return draft;
    })
  ).book;
}

export async function assignVoices(bookId: string) {
  return (
    await mutateBookRecord(bookId, (draft) => {
      draft.characters = draft.characters.map((character) => ({
        ...character,
        voiceAssignment: {
          narratorVoice: narratorVoice(),
          characterVoice: voiceForCharacter(character),
          fallbackVoice: fallbackVoice(),
          rationale: `${character.name} assigned by ${character.sex}/${character.ageRange || "adult"} voice policy.`,
        },
      }));
      return draft;
    })
  ).book;
}

export async function generateCharacterReferences(bookId: string, characterId: string) {
  return (
    await mutateBookRecord(bookId, async (draft) => {
      const character = draft.characters.find((candidate) => candidate.id === characterId);
      if (!character) throw new Error("Character not found.");

      const prompt = buildCharacterPrompt(draft, character);
      const referenceInputs = await loadReferenceInputs(draft, getCharacterBibleReferenceIds(draft, character));
      const candidates: ReferenceRecord[] = [];
      const assets: AssetRecord[] = [];

      for (let i = 0; i < 2; i += 1) {
        const image = await generateImageBuffer({
          prompt: `${prompt}\nVariation note: candidate ${i + 1}.`,
          references: referenceInputs,
          title: `${character.name} Portrait ${i + 1}`,
        });
        const asset = await writeAssetBuffer(
          draft.id,
          "character_portrait",
          `${slugify(character.name)}-portrait-${i + 1}.${image.extension}`,
          image.mimeType,
          image.buffer,
          { characterId, candidate: i + 1 },
        );
        assets.push(asset);
        candidates.push({
          id: createId("reference"),
          assetId: asset.id,
          source: "portrait_generation",
          role: "canonical_candidate",
          approved: false,
          characterIds: [character.id],
          sceneIds: [],
          chapterIds: [],
          sourceReferenceId: null,
          derivationKind: "none",
          derivationStatus: "approved",
          confidence: null,
          label: `${character.name} portrait candidate ${i + 1}`,
          crop: null,
          notes: `Generated portrait candidate ${i + 1}.`,
        });
      }

      draft.assets.push(...assets);
      draft.references.push(...candidates);
      syncCharacterBibleReferences(draft);
      return draft;
    })
  ).book;
}

export async function approveCanonicalLook(characterId: string, referenceId: string) {
  const store = await readStore();
  const book = store.books.find((candidate) => candidate.characters.some((character) => character.id === characterId));
  if (!book) throw new Error("Character not found.");

  return (
    await mutateBookRecord(book.id, (draft) => {
      const character = draft.characters.find((candidate) => candidate.id === characterId);
      const reference = draft.references.find((candidate) => candidate.id === referenceId);
      if (!character || !reference) throw new Error("Character or reference not found.");

      reference.approved = true;
      if (!reference.characterIds.includes(character.id)) {
        reference.characterIds.push(character.id);
      }
      character.canonicalReferenceId = reference.id;
      character.status = "locked";
      syncCharacterBibleReferences(draft);
      refreshScenePrompts(draft);
      return draft;
    })
  ).book;
}

function canRenderScene(book: BookRecord, scene: SceneRecord) {
  for (const characterId of scene.characterIds) {
    const character = book.characters.find((candidate) => candidate.id === characterId);
    if (!character) continue;
    if (character.requiredForRender && (!character.canonicalReferenceId || character.status !== "locked")) {
      return {
        ok: false,
        reason: `${character.name} needs an approved canonical portrait before this scene can render.`,
      };
    }
  }

  return { ok: true, reason: "" };
}

export async function renderSceneImage(sceneId: string) {
  const store = await readStore();
  const book = store.books.find((candidate) => candidate.scenes.some((scene) => scene.id === sceneId));
  if (!book) throw new Error("Scene not found.");

  return (
    await mutateBookRecord(book.id, async (draft) => {
      const scene = draft.scenes.find((candidate) => candidate.id === sceneId);
      if (!scene) throw new Error("Scene not found.");

      const gate = canRenderScene(draft, scene);
      if (!gate.ok) {
        scene.imageStatus = "blocked";
        throw new Error(gate.reason);
      }

      const { prompt, manifest } = buildScenePrompt(draft, scene);
      const resolvedReferences = await loadReferenceInputs(draft, manifest.visualAnchorReferenceIds);

      const image = await generateImageBuffer({
        prompt,
        references: resolvedReferences,
        title: scene.title,
      });

      const asset = await writeAssetBuffer(
        draft.id,
        "scene_image",
        `${slugify(scene.title)}.${image.extension}`,
        image.mimeType,
        image.buffer,
        { sceneId: scene.id },
      );

      draft.assets.push(asset);
      scene.imageAssetId = asset.id;
      scene.imageStatus = scene.reviewStatus === "approved" ? "ready" : "provisional";
      scene.imagePrompt = prompt;
      scene.renderManifest = manifest;
      if (!draft.coverAssetId) draft.coverAssetId = asset.id;
      return draft;
    })
  ).book;
}

async function ensureSceneAudioAsset(draft: BookRecord, scene: SceneRecord) {
  const speakingCharacters = scene.characterIds
    .map((characterId) => draft.characters.find((character) => character.id === characterId))
    .filter((character): character is CharacterBible => Boolean(character));

  const primaryCharacter = speakingCharacters[0];
  const voice = primaryCharacter?.voiceAssignment?.characterVoice || fallbackVoice();
  const tempDir = bookStudioTempDir("audio");
  await mkdir(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, `${scene.id}.wav`);

  try {
    const audio = await generateSpeechAudio({
      text: scene.sourceText,
      voice,
      targetPath: tempPath,
    });

    const asset = await writeAssetBuffer(
      draft.id,
      "scene_audio",
      `${slugify(scene.title)}.${audio.extension}`,
      audio.mimeType,
      await readFile(tempPath),
      { sceneId: scene.id, durationSeconds: audio.durationSeconds },
    );

    draft.assets.push(asset);
    scene.audioAssetId = asset.id;
    scene.audioStatus = "ready";
    scene.estimatedDurationSeconds = audio.durationSeconds;
    return asset;
  } catch (error) {
    if (scene.audioAssetId) {
      const previous = draft.assets.find((asset) => asset.id === scene.audioAssetId);
      if (previous) await deleteAssetFile(previous);
      draft.assets = draft.assets.filter((asset) => asset.id !== scene.audioAssetId);
    }
    scene.audioAssetId = null;
    scene.audioStatus = "failed";
    throw error;
  }
}

export async function generateSceneAudio(sceneId: string) {
  const store = await readStore();
  const book = store.books.find((candidate) => candidate.scenes.some((scene) => scene.id === sceneId));
  if (!book) throw new Error("Scene not found.");

  return (
    await mutateBookRecord(book.id, async (draft) => {
      const scene = draft.scenes.find((candidate) => candidate.id === sceneId);
      if (!scene) throw new Error("Scene not found.");
      await ensureSceneAudioAsset(draft, scene);
      return draft;
    })
  ).book;
}

async function ensureChapterAudio(draft: BookRecord, chapterId: string) {
  const chapter = draft.chapters.find((candidate) => candidate.id === chapterId);
  if (!chapter) throw new Error("Chapter not found.");
  const sceneAssets: AssetRecord[] = [];

  for (const sceneId of chapter.sceneIds) {
    const scene = draft.scenes.find((candidate) => candidate.id === sceneId);
    if (!scene) continue;
    if (!scene.audioAssetId) {
      await ensureSceneAudioAsset(draft, scene);
    }
    const asset = draft.assets.find((candidate) => candidate.id === scene.audioAssetId);
    if (asset) sceneAssets.push(asset);
  }

  if (chapter.audioAssetId) {
    const existing = draft.assets.find((candidate) => candidate.id === chapter.audioAssetId);
    if (existing) return existing;
  }

  const tmpDir = bookStudioTempDir("audio");
  await mkdir(tmpDir, { recursive: true });
  const targetPath = path.join(tmpDir, `${chapter.id}.wav`);
  await concatenateAudioAssets({ assets: sceneAssets, outputPath: targetPath });

  const asset = await writeAssetBuffer(
    draft.id,
    "chapter_audio",
    `${slugify(chapter.title)}.wav`,
    "audio/wav",
    await readFile(targetPath),
    { chapterId: chapter.id },
  );
  draft.assets.push(asset);
  chapter.audioAssetId = asset.id;
  return asset;
}

export async function renderChapterVideo(chapterId: string) {
  const store = await readStore();
  const book = store.books.find((candidate) => candidate.chapters.some((chapter) => chapter.id === chapterId));
  if (!book) throw new Error("Chapter not found.");

  return (
    await mutateBookRecord(book.id, async (draft) => {
      const chapter = draft.chapters.find((candidate) => candidate.id === chapterId);
      if (!chapter) throw new Error("Chapter not found.");

      const audioAsset = await ensureChapterAudio(draft, chapterId);
      const sceneAssets = chapter.sceneIds
        .map((sceneId) => draft.scenes.find((scene) => scene.id === sceneId))
        .filter((scene): scene is SceneRecord => Boolean(scene))
        .map(async (scene) => {
          const asset = draft.assets.find((candidate) => candidate.id === scene.imageAssetId);
          if (!asset) throw new Error(`Scene ${scene.title} is missing a rendered image.`);
          const tmpDir = bookStudioTempDir("video-stage", chapter.id);
          await mkdir(tmpDir, { recursive: true });
          const stagedPath = path.join(tmpDir, `${scene.id}${path.extname(asset.label || asset.relativePath) || ".png"}`);
          await writeFile(stagedPath, await readAssetBuffer(asset.relativePath));
          return { path: stagedPath, durationSeconds: scene.estimatedDurationSeconds };
        });
      const stagedSceneAssets = await Promise.all(sceneAssets);

      const tmpDir = bookStudioTempDir("video");
      await mkdir(tmpDir, { recursive: true });
      const outputPath = path.join(tmpDir, `${chapter.id}.mp4`);
      const stagedAudioPath = path.join(tmpDir, `${chapter.id}.audio.wav`);
      await writeFile(stagedAudioPath, await readAssetBuffer(audioAsset.relativePath));
      await renderChapterVideoFromAssets({
        sceneAssets: stagedSceneAssets,
        audioPath: stagedAudioPath,
        outputPath,
      });

      const asset = await writeAssetBuffer(
        draft.id,
        "chapter_video",
        `${slugify(chapter.title)}.mp4`,
        "video/mp4",
        await readFile(outputPath),
        { chapterId: chapter.id },
      );
      draft.assets.push(asset);
      chapter.videoAssetId = asset.id;
      return draft;
    })
  ).book;
}

export async function renderQueue(bookId: string, mode: "key_scenes" | "full_book") {
  const book = await getBookById(bookId);
  if (!book) throw new Error("Book not found.");

  const targetScenes = book.scenes.filter((scene) => {
    if (mode === "key_scenes") return scene.priority === "key";
    return true;
  });

  let latest = book;
  for (const scene of targetScenes) {
    latest = (await renderSceneImage(scene.id)) as BookRecord;
  }
  return latest;
}

export async function publishBook(bookId: string) {
  const book = await getBookById(bookId);
  if (!book) throw new Error("Book not found.");

  const chaptersMissingMedia = book.chapters
    .filter((chapter) => !chapter.videoAssetId && !chapter.audioAssetId)
    .map((chapter) => chapter.title);
  if (chaptersMissingMedia.length) {
    throw new Error(
      `Cannot publish yet. Render chapter media first for: ${chaptersMissingMedia.join(", ")}.`,
    );
  }

  return (
    await mutateBookRecord(bookId, (draft) => {
      draft.status = "Published";
      draft.publishedAt = nowIso();
      return draft;
    })
  ).book;
}

export function hydrateBookForClient(book: BookRecord) {
  return {
    ...book,
    assets: book.assets.map((asset) => ({
      ...asset,
      url: getAssetUrl(asset),
    })),
  };
}
