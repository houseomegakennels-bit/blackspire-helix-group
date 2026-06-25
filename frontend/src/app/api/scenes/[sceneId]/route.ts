import { NextResponse } from "next/server";

import { guardSignedInApi } from "@/lib/operator-access";
import { hydrateBookForClient, updateScene } from "@/lib/book-studio/service";
import type { SceneCharacterModifier, ScenePriority } from "@/lib/book-studio/types";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ sceneId: string }> },
) {
  const denied = await guardSignedInApi();
  if (denied) return denied;

  try {
    const { sceneId } = await params;
    const body = (await request.json()) as {
      title?: string;
      summary?: string;
      mood?: string;
      location?: string;
      timeOfDay?: string;
      reviewStatus?: "pending" | "approved";
      priority?: ScenePriority;
      imagePrompt?: string;
      modifiers?: SceneCharacterModifier[];
    };
    const book = await updateScene(sceneId, body);
    return NextResponse.json({ ok: true, book: hydrateBookForClient(book) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to update scene." },
      { status: 400 },
    );
  }
}
