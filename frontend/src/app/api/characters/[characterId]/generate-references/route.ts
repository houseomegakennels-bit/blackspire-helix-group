import { NextResponse } from "next/server";

import { guardSignedInApi } from "@/lib/operator-access";
import { generateCharacterReferences, hydrateBookForClient } from "@/lib/book-studio/service";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ characterId: string }> },
) {
  const denied = await guardSignedInApi();
  if (denied) return denied;

  try {
    const { characterId } = await params;
    const body = (await request.json().catch(() => ({}))) as { bookId?: string };
    if (!body.bookId) throw new Error("bookId is required.");
    const book = await generateCharacterReferences(body.bookId, characterId);
    return NextResponse.json({ ok: true, book: hydrateBookForClient(book) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to generate references." },
      { status: 400 },
    );
  }
}
