import { BookStudioIndex } from "@/components/book-studio/book-studio-index";
import { listBookSummaries } from "@/lib/book-studio/service";
import { requireSignedInPage } from "@/lib/operator-access";

export const dynamic = "force-dynamic";

export default async function BookStudioIndexPage() {
  await requireSignedInPage();
  const books = await listBookSummaries();
  return <BookStudioIndex books={books} />;
}
