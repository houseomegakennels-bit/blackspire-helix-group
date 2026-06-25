import { notFound } from "next/navigation";

import { BookStudioConsole } from "@/components/book-studio/book-studio-console";
import { getBookSnapshot, hydrateBookForClient } from "@/lib/book-studio/service";
import { requireSignedInPage } from "@/lib/operator-access";

export const dynamic = "force-dynamic";

export default async function BookStudioDetailPage({
  params,
}: {
  params: Promise<{ bookId: string }>;
}) {
  await requireSignedInPage();
  const { bookId } = await params;
  const book = await getBookSnapshot(bookId);
  if (!book) notFound();

  return <BookStudioConsole initialBook={hydrateBookForClient(book)} />;
}
