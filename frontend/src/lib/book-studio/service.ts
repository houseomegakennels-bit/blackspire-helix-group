import "server-only";

import AdmZip from "adm-zip";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { parseManuscript, parseReferenceDocx } from "@/lib/book-studio/documents";
import {
  concatenateAudioAssets,
  generateImageBuffer,
  generateSpeechAudio,
  renderChapterVideoFromAssets,
  runStructuredPrompt,
} from "@/lib/book-studio/media";
import {
  createId,
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

const DEFAULT_STYLE = {
  visualDirection: "cinematic realism",
  palette: "black, gold, amber, natural skin tones",
  medium: "high-detail illustrated still",
  tone: "dramatic, polished, immersive",
};

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const REFERENCE_DOCUMENT_EXTENSIONS = new Set(["docx"]);
const SUPPORTED_IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

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
    if (chunk.join(" ").length > 1100 || chunk.length >= 3) {
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
  const matches = text.match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g) ?? [];
  const blocked = new Set([
    "Chapter",
    "Part",
    "The",
    "And",
    "But",
    "When",
    "Then",
    "After",
    "Before",
    "Blackspire",
    "Principal",
    "Character",
    "Bible",
    "Working",
    "Edition",
    "Story",
    "Canon",
    "Canonical",
    "Universe",
  ]);
  return dedupeStrings(matches.filter((match) => !blocked.has(match))).slice(0, 10);
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
    (reference) => reference.characterIds.includes(character.id) && reference.role !== "excluded",
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

function findCharacterBibleSection(text: string) {
  const normalized = text.replace(/\r/g, "");
  const match = /(principal\s+character\s+bible|character\s+bible(?:\s+\(.*?\)|\s+summaries?)?)/i.exec(normalized);
  if (!match?.index && match?.index !== 0) return null;

  const afterHeading = normalized.slice(match.index + match[0].length).trim();
  if (!afterHeading) return null;

  const stopPatterns = [
    /\n\s*(?:world\s+bible|location\s+bible|reference\s+library|art\s+notes|appendix|glossary|voice\s+cast)\b/i,
    /\n\s*(?:chapter|part)\s+[\divxlc]+\b/i,
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
          const words = candidate.split(" ").filter(Boolean);
          if (!words.length) return false;
          if (haystack.includes(candidate)) return true;
          return words.every((word) => haystack.includes(word));
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

function buildScenePrompt(book: BookRecord, scene: SceneRecord) {
  const characters = scene.characterIds
    .map((characterId) => book.characters.find((candidate) => candidate.id === characterId))
    .filter((candidate): candidate is CharacterBible => Boolean(candidate));
  const continuity = characters
    .map((character) => {
      const modifier = scene.modifiers.find((entry) => entry.characterId === character.id);
      return `${character.name}: ${getCharacterBibleSummary(character)}${modifier ? `; scene modifier ${modifier.description}` : ""}`;
    })
    .join("\n");

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
    "Respect continuity. Keep recurring faces stable. No text, no watermark, no collage.",
  ].join("\n\n");

  const manifest: RenderManifest = {
    compiledPrompt: prompt,
    characterReferenceIds: dedupeStrings(
      characters.flatMap((character) => getCharacterBibleReferenceIds(book, character)),
    ),
    styleNotes: `${book.styleProfile.visualDirection}; ${book.styleProfile.palette}; ${book.styleProfile.tone}`,
    modifiers: safeJson(scene.modifiers),
  };

  return { prompt, manifest };
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

    for (const character of payload.characters) {
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

    payload.scenes.forEach((scene, index) => {
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

export async function importBookFromUpload(formData: FormData) {
  const manuscript = formData.get("manuscript");
  if (!(manuscript instanceof File)) {
    throw new Error("Upload a manuscript file to create a book.");
  }

  const parsed = await parseManuscript(manuscript);
  const bookId = createId("book");
  const slug = slugify(parsed.title);
  const manuscriptAsset = await writeAssetBuffer(
    bookId,
    "manuscript",
    manuscript.name,
    manuscript.type || "application/octet-stream",
    Buffer.from(await manuscript.arrayBuffer()),
  );

  const chapters: ChapterRecord[] = parsed.chapters.map((chapter, index) => ({
    id: createId("chapter"),
    order: index + 1,
    title: chapter.title || `Chapter ${index + 1}`,
    summary: chapter.text.slice(0, 220),
    sceneIds: [],
    audioAssetId: null,
    videoAssetId: null,
  }));

  const book: BookRecord = {
    id: bookId,
    slug,
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

  await saveBookRecord(book);

  const imports = formData.getAll("references").filter((entry): entry is File => entry instanceof File && entry.size > 0);
  const referenceZip = formData.get("referenceZip");
  if (imports.length || (referenceZip instanceof File && referenceZip.size > 0)) {
    await importReferenceFiles(bookId, formData);
  }

  return analyzeBook(bookId);
}

export async function analyzeBook(bookId: string) {
  const book = await getBookById(bookId);
  if (!book) throw new Error("Book not found.");

  const chapters = book.chapters.map((chapter) => ({
    id: chapter.id,
    title: chapter.title,
    text:
      book.manuscriptText
        .split(/\n\s*\n/)
        .filter(Boolean)
        .slice((chapter.order - 1) * 6, chapter.order * 6)
        .join("\n\n") || book.manuscriptText,
    order: chapter.order,
  }));

  const analyzed = await analyzeChapters(chapters, book.title);
  const explicitCharacterBibles = await extractExplicitCharacterBibles(book.manuscriptText, book.title);
  const enrichedCharacters = mergeCharacterBibles(explicitCharacterBibles, analyzed.characters);
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
      autoLinkReferencesToCharacters(draft);
      syncCharacterBibleReferences(draft);
      draft.scenes = analyzed.scenes.map((scene) => {
        const nextScene = {
          ...scene,
          characterIds: dedupeStrings(scene.characterIds.map((characterId) => characterIdMap.get(characterId) ?? characterId)),
        };
        const { prompt, manifest } = buildScenePrompt(draft, nextScene);
        return { ...nextScene, imagePrompt: prompt, renderManifest: manifest };
      });
      draft.chapters = draft.chapters.map((chapter) => ({
        ...chapter,
        sceneIds: chapterSceneMap.get(chapter.id) ?? [],
      }));
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
    } = {},
  ) => {
    const asset = await writeAssetBuffer(bookId, "reference_image", fileName, mimeType, buffer, {
      importedFromDocument: options.sourceDocument ?? null,
    });
    newAssets.push(asset);
    newReferences.push({
      id: createId("reference"),
      assetId: asset.id,
      source: "upload",
      role: "character_reference",
      approved: false,
      characterIds: [],
      sceneIds: [],
      notes: options.notes ?? "",
    });
    importedCount += 1;
  };

  const importReferenceDoc = async (fileName: string, buffer: Buffer) => {
    const parsed = await parseReferenceDocx(fileName, buffer);
    for (const image of parsed.images) {
      const notes = [`Imported from ${image.sourceDocument}.`, image.description].filter(Boolean).join("\n\n");
      await pushReferenceBuffer(image.fileName, image.mimeType, image.buffer, {
        notes,
        sourceDocument: image.sourceDocument,
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
    await mutateBookRecord(bookId, (draft) => {
      draft.assets.push(...newAssets);
      draft.references.push(...newReferences);
      autoLinkReferencesToCharacters(draft);
      syncCharacterBibleReferences(draft);
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
      reference.notes = patch.notes ?? reference.notes;
      syncCharacterBibleReferences(draft);
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
        return draft;
      }

      const { prompt, manifest } = buildScenePrompt(draft, scene);
      const resolvedReferences = await loadReferenceInputs(draft, manifest.characterReferenceIds);

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
  const tempDir = path.join(process.cwd(), "data", "book-studio", "tmp");
  await mkdir(tempDir, { recursive: true });
  const tempPath = path.join(tempDir, `${scene.id}.wav`);

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

  const tmpDir = path.join(process.cwd(), "data", "book-studio", "tmp");
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
          const tmpDir = path.join(process.cwd(), "data", "book-studio", "tmp", "video-stage", chapter.id);
          await mkdir(tmpDir, { recursive: true });
          const stagedPath = path.join(tmpDir, `${scene.id}${path.extname(asset.label || asset.relativePath) || ".png"}`);
          await writeFile(stagedPath, await readAssetBuffer(asset.relativePath));
          return { path: stagedPath, durationSeconds: scene.estimatedDurationSeconds };
        });
      const stagedSceneAssets = await Promise.all(sceneAssets);

      const tmpDir = path.join(process.cwd(), "data", "book-studio", "tmp");
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

export async function renderQueue(bookId: string, mode: "key_scenes" | "chapter" | "full_book") {
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

  let latest = book;
  await assignVoices(bookId);

  for (const chapter of latest.chapters) {
    latest = (await renderChapterVideo(chapter.id)) as BookRecord;
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
