import { NextResponse } from "next/server";

import { createBookAssetUploadTarget } from "@/lib/book-studio/service";
import { guardSignedInApi } from "@/lib/operator-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const denied = await guardSignedInApi();
  if (denied) return denied;

  try {
    const { fileName, mimeType, kind, bookId } = (await request.json()) as {
      fileName?: string;
      mimeType?: string;
      kind?: "manuscript" | "character_bible_document";
      bookId?: string;
    };
    const target = await createBookAssetUploadTarget(fileName ?? "", mimeType ?? "", kind ?? "manuscript", bookId);
    return NextResponse.json({ ok: true, ...target });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to start the upload." },
      { status: 400 },
    );
  }
}
