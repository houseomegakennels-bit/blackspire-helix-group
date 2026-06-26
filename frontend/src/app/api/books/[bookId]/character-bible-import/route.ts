import { NextResponse } from "next/server";

import { guardSignedInApi } from "@/lib/operator-access";
import {
  hydrateBookForClient,
  importCharacterBibleFromStorageRef,
  importCharacterBibleUpload,
} from "@/lib/book-studio/service";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ bookId: string }> },
) {
  const denied = await guardSignedInApi();
  if (denied) return denied;

  try {
    const { bookId } = await params;
    const contentType = request.headers.get("content-type") || "";
    const book = contentType.includes("application/json")
      ? await importCharacterBibleFromStorageRef(bookId, await request.json())
      : await importCharacterBibleUpload(bookId, await request.formData());
    return NextResponse.json({ ok: true, book: hydrateBookForClient(book) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to import character bible." },
      { status: 400 },
    );
  }
}
