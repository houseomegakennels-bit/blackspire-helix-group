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
  for (let offset = -2; offset <= 2; offset += 1) {
    const paragraph = paragraphs[index + offset];
    if (!paragraph?.text) continue;
    context.push(paragraph.text);
  }
  return uniqueStrings(context).join("\n");
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
  let currentTitle = "Chapter 1";
  let currentLines: string[] = [];

  const flush = () => {
    const chapterText = cleanText(currentLines.join("\n"));
    if (chapterText) {
      chapters.push({ title: currentTitle, text: chapterText });
    }
    currentLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const isChapterBreak =
      /^chapter\s+[\divxlc]+/i.test(trimmed) ||
      /^#{1,2}\s+/.test(trimmed) ||
      /^part\s+[\divxlc]+/i.test(trimmed);

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
  const result = await mammoth.extractRawText({ buffer });
  const text = cleanText(result.value);
  const summary = summarizeText(text);
  const zip = new AdmZip(buffer);
  const documentXml = readZipText(zip, "word/document.xml");
  const relsXml = readZipText(zip, "word/_rels/document.xml.rels");

  if (!documentXml || !relsXml) {
    return { text, summary, images: [] };
  }

  const paragraphs = parseDocxParagraphs(documentXml);
  const relationshipMap = buildRelationshipMap(relsXml);
  const imageContexts = new Map<string, string[]>();

  paragraphs.forEach((paragraph, index) => {
    const context = findParagraphContext(paragraphs, index);
    for (const relId of paragraph.relIds) {
      const target = relationshipMap.get(relId);
      if (!target) continue;
      const entryPath = resolveDocxTargetPath(target);
      const mimeType = mimeTypeFromFileName(entryPath);
      if (!mimeType) continue;
      const contexts = imageContexts.get(entryPath) ?? [];
      if (context) contexts.push(context);
      imageContexts.set(entryPath, contexts);
    }
  });

  const images = Array.from(imageContexts.entries())
    .map(([entryPath, contexts], index) => {
      const entry = zip.getEntry(entryPath);
      if (!entry) return null;
      const description = uniqueStrings(contexts).join("\n\n") || summary || `Imported from ${fileName}.`;
      return {
        fileName: `${path.basename(fileName, path.extname(fileName))}-reference-${index + 1}${path.extname(entryPath)}`,
        mimeType: mimeTypeFromFileName(entryPath),
        buffer: entry.getData(),
        description,
        sourceDocument: fileName,
      };
    })
    .filter((image): image is ParsedReferenceDoc["images"][number] => Boolean(image));

  return { text, summary, images };
}
