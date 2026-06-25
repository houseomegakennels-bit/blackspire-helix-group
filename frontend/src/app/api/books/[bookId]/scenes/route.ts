import { NextResponse } from "next/server";

import { getBookSnapshot } from "@/lib/book-studio/service";
import { getAssetUrl } from "@/lib/book-studio/store";
import { guardSignedInApi } from "@/lib/operator-access";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ bookId: string }> },
) {
  const denied = await guardSignedInApi();
  if (denied) return denied;

  try {
    const { bookId } = await params;
    const book = await getBookSnapshot(bookId);
    if (!book) {
      return NextResponse.json({ ok: false, error: "Book not found." }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      scenes: book.scenes.map((scene) => ({
        ...scene,
        imageUrl: scene.imageAssetId
          ? getAssetUrl(book.assets.find((asset) => asset.id === scene.imageAssetId)!)
          : null,
        audioUrl: scene.audioAssetId
          ? getAssetUrl(book.assets.find((asset) => asset.id === scene.audioAssetId)!)
          : null,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to load scenes." },
      { status: 400 },
    );
  }
}
