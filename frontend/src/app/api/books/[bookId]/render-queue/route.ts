import { NextResponse } from "next/server";

import { guardSignedInApi } from "@/lib/operator-access";
import { hydrateBookForClient, renderQueue } from "@/lib/book-studio/service";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ bookId: string }> },
) {
  const denied = await guardSignedInApi();
  if (denied) return denied;

  try {
    const { bookId } = await params;
    const body = (await request.json()) as { mode?: "key_scenes" | "chapter" | "full_book" };
    const book = await renderQueue(bookId, body.mode || "key_scenes");
    return NextResponse.json({ ok: true, book: hydrateBookForClient(book) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to render queue." },
      { status: 400 },
    );
  }
}
