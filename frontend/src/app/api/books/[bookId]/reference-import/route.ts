import { NextResponse } from "next/server";

import { guardSignedInApi } from "@/lib/operator-access";
import { hydrateBookForClient, importReferenceFiles } from "@/lib/book-studio/service";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ bookId: string }> },
) {
  const denied = await guardSignedInApi();
  if (denied) return denied;

  try {
    const { bookId } = await params;
    const formData = await request.formData();
    const book = await importReferenceFiles(bookId, formData);
    return NextResponse.json({ ok: true, book: hydrateBookForClient(book) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to import references." },
      { status: 400 },
    );
  }
}
