import { readFile } from "node:fs/promises";
import { appendChaptersFromText } from "@/lib/book-studio/service";

const [bookId, filePath, startLineArg, endLineArg] = process.argv.slice(2);
if (!bookId || !filePath || !startLineArg || !endLineArg) {
  throw new Error("usage: runner-append-chapters.mts <bookId> <filePath> <startLine1indexed> <endLine1indexedInclusive>");
}

const startLine = Number(startLineArg);
const endLine = Number(endLineArg);
const fullText = await readFile(filePath, "utf8");
const lines = fullText.split("\n");
const slice = lines.slice(startLine - 1, endLine).join("\n");

console.log(`Slicing lines ${startLine}-${endLine} (${slice.length} chars)`);
const book = await appendChaptersFromText(bookId, slice);
console.log(`Book now has ${book.chapters.length} chapters, ${book.scenes.length} scenes, ${book.characters.length} characters.`);
for (const chapter of book.chapters) {
  console.log(`  order=${chapter.order} title="${chapter.title}" scenes=${chapter.sceneIds.length}`);
}
