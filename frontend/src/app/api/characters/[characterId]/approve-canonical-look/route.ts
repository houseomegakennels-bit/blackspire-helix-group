import { NextResponse } from "next/server";

import { guardSignedInApi } from "@/lib/operator-access";
import { approveCanonicalLook, hydrateBookForClient } from "@/lib/book-studio/service";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ characterId: string }> },
) {
  const denied = await guardSignedInApi();
  if (denied) return denied;

  try {
    const { characterId } = await params;
    const body = (await request.json()) as { referenceId?: string };
    if (!body.referenceId) throw new Error("referenceId is required.");
    const book = await approveCanonicalLook(characterId, body.referenceId);
    return NextResponse.json({ ok: true, book: hydrateBookForClient(book) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to approve canonical look." },
      { status: 400 },
    );
  }
}
