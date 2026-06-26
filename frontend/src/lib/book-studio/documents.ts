import "server-only";

import AdmZip from "adm-zip";
import path from "node:path";

import mammoth from "mammoth";

export type ParsedManuscript = {
  title: string;
  synopsis: string;
  text: string;
  chapters: Array<{ title: string; text: string }>;
};

export type ParsedReferenceDoc = {
  text: string;
  summary: string;
  images: Array<{
    fileName: string;
    mimeType: string;
    buffer: Buffer;
    description: string;
    sourceDocument: string;
  }>;
};

export type ParsedCharacterBibleFigure = {
  title: string;
  caption: string;
  description: string;
  sourceDocument: string;
  sourceCode: string | null;
  sourceSection: string | null;
  status: string | null;
  canonBaseline: string | null;
  inferredChapterLabel: string | null;
  inferredChapterNumber: number | null;
  inferredRole: "character_reference" | "scene_reference" | "mood_reference";
  image: {
    fileName: string;
    mimeType: string;
    buffer: Buffer;
  } | null;
};

export type ParsedCharacterBibleDoc = {
  text: string;
  summary: string;
  figures: ParsedCharacterBibleFigure[];
};

const DOCX_IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  svg: "image/svg+xml",
};
const CHAPTER_MARKER =
  "(?:\\d+|[ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)";

function cleanText(text: string) {
  return text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function summarizeText(text: string, maxLength = 640) {
  return text.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function parseChapterLabel(value: string) {
  const match = value.match(/\bchapter\s+([a-z0-9ivxlc-]+)\b/i);
  if (!match) return { label: null, number: null as number | null };

  const token = match[1].toLowerCase().replace(/[^a-z0-9ivxlc]+/g, "");
  const words: Record<string, number> = {
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
  const roman: Record<string, number> = {
    i: 1,
    ii: 2,
    iii: 3,
    iv: 4,
    v: 5,
    vi: 6,
    vii: 7,
    viii: 8,
    ix: 9,
    x: 10,
    xi: 11,
    xii: 12,
    xiii: 13,
    xiv: 14,
    xv: 15,
    xvi: 16,
    xvii: 17,
    xviii: 18,
    xix: 19,
    xx: 20,
  };

  return {
    label: match[0],
    number: Number.parseInt(token, 10) || words[token] || roman[token] || null,
  };
}

function readZipText(zip: AdmZip, entryName: string) {
  const entry = zip.getEntry(entryName);
  return entry ? entry.getData().toString("utf8") : "";
}

function xmlParagraphText(paragraphXml: string) {
  return cleanText(
    decodeXmlEntities(
      paragraphXml
        .replace(/<w:tab\/>/g, " ")
        .replace(/<w:br\s*\/>/g, "\n")
        .replace(/<\/w:t>/g, " ")
        .replace(/<[^>]+>/g, " "),
    ),
  );
}

function parseDocxParagraphs(documentXml: string) {
  const paragraphs = documentXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? [];
  return paragraphs.map((paragraphXml) => ({
    text: xmlParagraphText(paragraphXml),
    relIds: uniqueStrings(
      Array.from(paragraphXml.matchAll(/(?:r:embed|r:id|r:link)="([^"]+)"/g), (match) => match[1] ?? ""),
    ),
  }));
}

function buildRelationshipMap(relsXml: string) {
  const map = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    const relId = match[1];
    const target = match[2];
    if (relId && target) {
      map.set(relId, target);
    }
  }
  return map;
}

function findParagraphContext(paragraphs: Array<{ text: string; relIds: string[] }>, index: number) {
  const context: string[] = [];
  for (let offset = -7; offset <= 3; offset += 1) {
    const paragraph = paragraphs[index + offset];
    if (!paragraph?.text) continue;
    context.push(paragraph.text);
  }
  return uniqueStrings(context).join("\n");
}

function findNearbyLine(
  paragraphs: Array<{ text: string; relIds: string[] }>,
  index: number,
  matcher: (text: string) => boolean,
  before = 12,
  after = 3,
) {
  for (let cursor = index; cursor >= Math.max(0, index - before); cursor -= 1) {
    const text = paragraphs[cursor]?.text?.trim() ?? "";
    if (text && matcher(text)) return text;
  }
  for (let cursor = index + 1; cursor <= Math.min(paragraphs.length - 1, index + after); cursor += 1) {
    const text = paragraphs[cursor]?.text?.trim() ?? "";
    if (text && matcher(text)) return text;
  }
  return "";
}

function parseProductionCode(text: string) {
  const match = text.match(/\b((?:GH|FS|UG|LG|CM|CH|PR|AR|TE|LU|UM)-\d+[A-Z]?)\b/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function roleFromProductionCode(code: string | null): ParsedCharacterBibleFigure["inferredRole"] | null {
  const prefix = code?.split("-")[0] ?? "";
  if (prefix === "GH" || prefix === "FS") return "character_reference" as const;
  if (prefix === "UG" || prefix === "LG" || prefix === "LU" || prefix === "UM" || prefix === "PR" || prefix === "AR" || prefix === "TE") {
    return "mood_reference" as const;
  }
  if (prefix === "CM" || prefix === "CH") return "scene_reference" as const;
  return null;
}

function resolveDocxTargetPath(target: string) {
  const normalized = target.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) return "";
  return normalized.startsWith("word/") ? normalized : path.posix.join("word", normalized);
}

function mimeTypeFromFileName(fileName: string) {
  const extension = path.extname(fileName).slice(1).toLowerCase();
  return DOCX_IMAGE_TYPES[extension] ?? "";
}

function inferFigureRole(text: string): ParsedCharacterBibleFigure["inferredRole"] {
  const productionCode = parseProductionCode(text);
  const productionRole = roleFromProductionCode(productionCode);
  if (productionRole) return productionRole;

  const normalized = text.toLowerCase();
  if (
    /\bstoryboard\b/.test(normalized) ||
    /\bchapter\s+(?:\d+|[ivxlc]+|one|two|three|four|five|six|seven|eight|nine|ten)\b/.test(normalized)
  ) {
    return "scene_reference" as const;
  }
  if (
    /\bcityscape\b/.test(normalized) ||
    /\bcities\b/.test(normalized) ||
    /\bsky\b/.test(normalized) ||
    /\bplanet\b/.test(normalized) ||
    /\bworld\b/.test(normalized) ||
    /\benvironment\b/.test(normalized) ||
    /\blandscape\b/.test(normalized) ||
    /\bview\b/.test(normalized)
  ) {
    return "mood_reference" as const;
  }
  return "character_reference" as const;
}

function nearestFigureCaption(paragraphs: Array<{ text: string; relIds: string[] }>, index: number) {
  for (let offset = 0; offset <= 8; offset += 1) {
    const candidates = [paragraphs[index - offset], paragraphs[index + offset]].filter(Boolean);
    for (const paragraph of candidates) {
      if (paragraph?.text && /^figure\s+(?:[A-Z]{2}-\d+[A-Z]?|\d+):/i.test(paragraph.text)) {
        return paragraph.text;
      }
    }
  }
  return "";
}

function nearestFigureTitle(paragraphs: Array<{ text: string; relIds: string[] }>, index: number) {
  const codedHeading = findNearbyLine(
    paragraphs,
    index,
    (text) => /^[A-Z]{2}-\d+[A-Z]?\s+[—-]/.test(text),
    16,
    2,
  );
  if (codedHeading) return codedHeading;

  for (let cursor = index; cursor >= Math.max(0, index - 8); cursor -= 1) {
    const text = paragraphs[cursor]?.text?.trim() ?? "";
    if (!text || /^figure\s+(?:[A-Z]{2}-\d+[A-Z]?|\d+):/i.test(text)) continue;
    return text;
  }
  return "";
}

function deriveTitle(fileName: string, text: string) {
  const heading = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && (line.startsWith("# ") || line === line.toUpperCase()));
  if (heading?.startsWith("# ")) return heading.slice(2).trim();
  if (heading && heading.length <= 80) return heading;
  return fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim();
}

function deriveSynopsis(text: string) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  return paragraphs.slice(0, 2).join(" ").slice(0, 420);
}

function splitChapters(text: string) {
  const lines = text.split("\n");
  const chapters: Array<{ title: string; text: string }> = [];
  let currentTitle = "";
  let currentLines: string[] = [];

  const flush = () => {
    const chapterText = cleanText(currentLines.join("\n"));
    if (chapterText && currentTitle) {
      chapters.push({ title: currentTitle, text: chapterText });
    }
    currentLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const isChapterBreak =
      new RegExp(`^chapter\\s+${CHAPTER_MARKER}\\b`, "i").test(trimmed) ||
      /^#{1,2}\s+/.test(trimmed) ||
      new RegExp(`^part\\s+${CHAPTER_MARKER}\\b`, "i").test(trimmed);

    if (isChapterBreak) {
      flush();
      currentTitle = trimmed.replace(/^#{1,2}\s+/, "");
      continue;
    }

    currentLines.push(line);
  }

  flush();

  if (!chapters.length) {
    return [{ title: "Chapter 1", text: cleanText(text) }];
  }

  return chapters;
}

export async function parseManuscriptFromBuffer(fileName: string, buffer: Buffer): Promise<ParsedManuscript> {
  const extension = fileName.toLowerCase().split(".").pop();
  let text = "";

  if (extension === "txt" || extension === "md") {
    text = cleanText(buffer.toString("utf8"));
  } else if (extension === "docx") {
    const result = await mammoth.extractRawText({ buffer });
    text = cleanText(result.value);
  } else {
    throw new Error("Supported manuscript formats are .txt, .md, and .docx.");
  }

  if (!text) {
    throw new Error("The uploaded manuscript did not contain readable text.");
  }

  const title = deriveTitle(fileName, text);
  return {
    title,
    synopsis: deriveSynopsis(text),
    text,
    chapters: splitChapters(text),
  };
}

export async function parseManuscript(file: File): Promise<ParsedManuscript> {
  return parseManuscriptFromBuffer(file.name, Buffer.from(await file.arrayBuffer()));
}

export async function parseReferenceDocx(fileName: string, buffer: Buffer): Promise<ParsedReferenceDoc> {
  const parsed = await parseCharacterBibleDocx(fileName, buffer);
  return {
    text: parsed.text,
    summary: parsed.summary,
    images: parsed.figures
      .filter((figure): figure is ParsedCharacterBibleFigure & { image: NonNullable<ParsedCharacterBibleFigure["image"]> } => Boolean(figure.image))
      .map((figure, index) => ({
        fileName: figure.image.fileName || `${path.basename(fileName, path.extname(fileName))}-reference-${index + 1}.png`,
        mimeType: figure.image.mimeType,
        buffer: figure.image.buffer,
        description: figure.description,
        sourceDocument: figure.sourceDocument,
      })),
  };
}

export async function parseCharacterBibleDocx(fileName: string, buffer: Buffer): Promise<ParsedCharacterBibleDoc> {
  const result = await mammoth.extractRawText({ buffer });
  const text = cleanText(result.value);
  const summary = summarizeText(text);
  const zip = new AdmZip(buffer);
  const documentXml = readZipText(zip, "word/document.xml");
  const relsXml = readZipText(zip, "word/_rels/document.xml.rels");

  if (!documentXml || !relsXml) {
    return { text, summary, figures: [] };
  }

  const paragraphs = parseDocxParagraphs(documentXml);
  const relationshipMap = buildRelationshipMap(relsXml);
  const seenTargets = new Set<string>();

  const figures = paragraphs
    .flatMap((paragraph, index) =>
      paragraph.relIds.map((relId) => {
        const target = relationshipMap.get(relId);
        if (!target) return null;
        const entryPath = resolveDocxTargetPath(target);
        if (!entryPath || seenTargets.has(entryPath)) return null;
        seenTargets.add(entryPath);

        const mimeType = mimeTypeFromFileName(entryPath);
        if (!mimeType) return null;
        const entry = zip.getEntry(entryPath);
        if (!entry) return null;

        const title = nearestFigureTitle(paragraphs, index);
        const caption = nearestFigureCaption(paragraphs, index);
        const context = findParagraphContext(paragraphs, index);
        const sourceCode = parseProductionCode([caption, title, context].join(" "));
        const sourceSection = findNearbyLine(paragraphs, index, (text) => /^subsection:/i.test(text), 14, 2);
        const status = findNearbyLine(paragraphs, index, (text) => /^status:/i.test(text), 14, 2);
        const canonBaseline = findNearbyLine(paragraphs, index, (text) => /^canon visual baseline:/i.test(text), 14, 2);
        const description = uniqueStrings([title, sourceSection, status, canonBaseline, caption, context]).join("\n\n") || summary || `Imported from ${fileName}.`;
        const chapter = parseChapterLabel([title, caption, context].join(" "));
        const inferredRole = roleFromProductionCode(sourceCode) ?? inferFigureRole([title, caption, sourceSection, context].join(" "));

        return {
          title,
          caption,
          description,
          sourceDocument: fileName,
          sourceCode,
          sourceSection,
          status,
          canonBaseline,
          inferredChapterLabel: chapter.label,
          inferredChapterNumber: chapter.number,
          inferredRole,
          image: {
            fileName: `${path.basename(fileName, path.extname(fileName))}-reference-${seenTargets.size}${path.extname(entryPath)}`,
            mimeType,
            buffer: entry.getData(),
          },
        };
      }),
    )
    .filter((figure): figure is NonNullable<typeof figure> => Boolean(figure));

  const mappedFigures: ParsedCharacterBibleFigure[] = [...figures];
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory || !entry.entryName.startsWith("word/media/")) continue;
    if (seenTargets.has(entry.entryName)) continue;

    const mimeType = mimeTypeFromFileName(entry.entryName);
    if (!mimeType) continue;

    seenTargets.add(entry.entryName);
    mappedFigures.push({
      title: "",
      caption: "",
      description: summary || `Imported from ${fileName}.`,
      sourceDocument: fileName,
      sourceCode: null,
      sourceSection: null,
      status: null,
      canonBaseline: null,
      inferredChapterLabel: null,
      inferredChapterNumber: null,
      inferredRole: "mood_reference",
      image: {
        fileName: `${path.basename(fileName, path.extname(fileName))}-reference-${seenTargets.size}${path.extname(entry.entryName)}`,
        mimeType,
        buffer: entry.getData(),
      },
    });
  }

  return { text, summary, figures: mappedFigures };
}
