import { NextResponse } from "next/server";

import { deleteBookWorkspace } from "@/lib/book-studio/service";
import { guardSignedInApi } from "@/lib/operator-access";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ bookId: string }> },
) {
  const denied = await guardSignedInApi();
  if (denied) return denied;

  try {
    const { bookId } = await params;
    const deleted = await deleteBookWorkspace(bookId);
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to delete book workspace." },
      { status: 400 },
    );
  }
}
