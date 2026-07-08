import { readFile } from "node:fs/promises";
import { repairSceneNarrationCoverage } from "@/lib/book-studio/service";

const [bookId, filePath] = process.argv.slice(2);
if (!bookId || !filePath) {
  throw new Error("usage: runner-repair-coverage.mts <bookId> <filePath>");
}

// 1-indexed, inclusive line ranges per chapter, taken from the master manuscript.
const chapterLineRanges: Record<number, [number, number]> = {
  11: [3490, 3628],
  12: [3629, 3802],
  13: [3803, 3918],
  14: [3919, 4004],
  15: [4005, 4140],
  16: [4141, 4228],
  17: [4229, 4318],
  18: [4319, 4420],
  19: [4423, 4520],
  20: [4525, 4623],
};

const fullText = await readFile(filePath, "utf8");
const lines = fullText.split("\n");

const chapterFullTexts: Record<number, string> = {};
for (const [orderStr, [start, end]] of Object.entries(chapterLineRanges)) {
  chapterFullTexts[Number(orderStr)] = lines.slice(start - 1, end).join("\n");
}

const { book, results } = await repairSceneNarrationCoverage(bookId, chapterFullTexts);
for (const result of results) {
  console.log(`Chapter ${result.order}: ${result.status}${result.reason ? ` (${result.reason})` : ""}`);
}
console.log(`Book now has ${book.chapters.length} chapters, ${book.scenes.length} scenes.`);
