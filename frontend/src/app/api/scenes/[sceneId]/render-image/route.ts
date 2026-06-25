import { NextResponse } from "next/server";

import { guardSignedInApi } from "@/lib/operator-access";
import { hydrateBookForClient, renderSceneImage } from "@/lib/book-studio/service";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sceneId: string }> },
) {
  const denied = await guardSignedInApi();
  if (denied) return denied;

  try {
    const { sceneId } = await params;
    const book = await renderSceneImage(sceneId);
    return NextResponse.json({ ok: true, book: hydrateBookForClient(book) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to render scene image." },
      { status: 400 },
    );
  }
}
