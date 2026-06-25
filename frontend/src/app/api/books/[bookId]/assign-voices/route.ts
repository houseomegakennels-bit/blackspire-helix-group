import { NextResponse } from "next/server";

import { guardSignedInApi } from "@/lib/operator-access";
import { assignVoices, hydrateBookForClient } from "@/lib/book-studio/service";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ bookId: string }> },
) {
  const denied = await guardSignedInApi();
  if (denied) return denied;

  try {
    const { bookId } = await params;
    const book = await assignVoices(bookId);
    return NextResponse.json({ ok: true, book: hydrateBookForClient(book) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to assign voices." },
      { status: 400 },
    );
  }
}
