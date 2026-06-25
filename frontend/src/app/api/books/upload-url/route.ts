import { NextResponse } from "next/server";

import { createManuscriptUploadTarget } from "@/lib/book-studio/service";
import { guardSignedInApi } from "@/lib/operator-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const denied = await guardSignedInApi();
  if (denied) return denied;

  try {
    const { fileName, mimeType } = (await request.json()) as { fileName?: string; mimeType?: string };
    const target = await createManuscriptUploadTarget(fileName ?? "", mimeType ?? "");
    return NextResponse.json({ ok: true, ...target });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to start the upload." },
      { status: 400 },
    );
  }
}
