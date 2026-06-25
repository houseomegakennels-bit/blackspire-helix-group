import { NextResponse } from "next/server";

import { guardSignedInApi } from "@/lib/operator-access";
import {
  hydrateBookForClient,
  importBookFromStorageRef,
  importBookFromUpload,
} from "@/lib/book-studio/service";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const denied = await guardSignedInApi();
  if (denied) return denied;

  try {
    const contentType = request.headers.get("content-type") || "";
    // JSON body = large-file flow: manuscript already uploaded directly to
    // storage, we only receive its reference. formData = legacy/small-file path.
    const book = contentType.includes("application/json")
      ? await importBookFromStorageRef(await request.json())
      : await importBookFromUpload(await request.formData());
    if (!book) throw new Error("Book import failed.");
    return NextResponse.json({ ok: true, book: hydrateBookForClient(book) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to import manuscript." },
      { status: 400 },
    );
  }
}
