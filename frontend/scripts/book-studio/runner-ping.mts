import { readStore } from "@/lib/book-studio/store";

const store = await readStore();
for (const book of store.books) {
  console.log(
    JSON.stringify({
      id: book.id,
      slug: book.slug,
      status: book.status,
      chapters: book.chapters.length,
      scenes: book.scenes.length,
      characters: book.characters.length,
      assets: book.assets.length,
    }),
  );
}
