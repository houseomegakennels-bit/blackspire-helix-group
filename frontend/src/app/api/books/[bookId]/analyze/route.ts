import { NextResponse } from "next/server";

import { analyzeBook, hydrateBookForClient } from "@/lib/book-studio/service";
import { guardSignedInApi } from "@/lib/operator-access";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ bookId: string }> },
) {
  const denied = await guardSignedInApi();
  if (denied) return denied;

  try {
    const { bookId } = await params;
    const book = await analyzeBook(bookId);
    return NextResponse.json({ ok: true, book: hydrateBookForClient(book) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to analyze book." },
      { status: 400 },
    );
  }
}
