import { NextResponse } from "next/server";

import { guardSignedInApi } from "@/lib/operator-access";
import { hydrateBookForClient, importBookFromUpload } from "@/lib/book-studio/service";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const denied = await guardSignedInApi();
  if (denied) return denied;

  try {
    const formData = await request.formData();
    const book = await importBookFromUpload(formData);
    if (!book) throw new Error("Book import failed.");
    return NextResponse.json({ ok: true, book: hydrateBookForClient(book) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to import manuscript." },
      { status: 400 },
    );
  }
}
