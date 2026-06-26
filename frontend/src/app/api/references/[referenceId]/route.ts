import { NextResponse } from "next/server";

import { guardSignedInApi } from "@/lib/operator-access";
import { hydrateBookForClient, updateReference } from "@/lib/book-studio/service";
import type { ReferenceRole } from "@/lib/book-studio/types";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ referenceId: string }> },
) {
  const denied = await guardSignedInApi();
  if (denied) return denied;

  try {
    const { referenceId } = await params;
    const body = (await request.json()) as {
      role?: ReferenceRole;
      approved?: boolean;
      characterIds?: string[];
      sceneIds?: string[];
      chapterIds?: string[];
      sourceReferenceId?: string | null;
      derivationKind?: "none" | "storyboard_crop_upscale";
      derivationStatus?: "provisional" | "approved" | "rejected";
      confidence?: number | null;
      label?: string | null;
      crop?: { x: number; y: number; width: number; height: number } | null;
      notes?: string;
    };
    const book = await updateReference(referenceId, body);
    return NextResponse.json({ ok: true, book: hydrateBookForClient(book) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to update reference." },
      { status: 400 },
    );
  }
}
