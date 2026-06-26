import { NextResponse } from "next/server";

import { guardSignedInApi } from "@/lib/operator-access";
import { extractReferenceCharacterCandidates, hydrateBookForClient } from "@/lib/book-studio/service";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ referenceId: string }> },
) {
  const denied = await guardSignedInApi();
  if (denied) return denied;

  try {
    const { referenceId } = await params;
    const book = await extractReferenceCharacterCandidates(referenceId);
    return NextResponse.json({ ok: true, book: hydrateBookForClient(book) });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to extract storyboard character crops.",
      },
      { status: 400 },
    );
  }
}
