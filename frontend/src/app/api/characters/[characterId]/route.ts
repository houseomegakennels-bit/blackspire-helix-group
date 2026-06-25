import { NextResponse } from "next/server";

import { guardSignedInApi } from "@/lib/operator-access";
import { hydrateBookForClient, updateCharacterBible } from "@/lib/book-studio/service";
import type { CharacterBible } from "@/lib/book-studio/types";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ characterId: string }> },
) {
  const denied = await guardSignedInApi();
  if (denied) return denied;

  try {
    const { characterId } = await params;
    const body = (await request.json()) as Partial<
      Pick<
        CharacterBible,
        | "name"
        | "aliases"
        | "coreDescription"
        | "ageRange"
        | "sex"
        | "facialTraits"
        | "bodyTraits"
        | "hair"
        | "vibe"
        | "continuityNotes"
        | "requiredForRender"
      >
    >;
    const book = await updateCharacterBible(characterId, body);
    return NextResponse.json({ ok: true, book: hydrateBookForClient(book) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to update character bible." },
      { status: 400 },
    );
  }
}
