import { NextRequest, NextResponse } from "next/server";

import { submitBetaFeedback } from "@/lib/beta-server";
import { guardSignedInApi } from "@/lib/operator-access";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const denied = await guardSignedInApi();
    if (denied) return denied;

    const body = (await request.json()) as { category?: string; message?: string; pagePath?: string };
    if (!body.message?.trim()) {
      return NextResponse.json({ ok: false, error: "A message is required." }, { status: 400 });
    }
    const result = await submitBetaFeedback({
      category: body.category,
      message: body.message,
      pagePath: body.pagePath,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not submit feedback." },
      { status: 500 },
    );
  }
}
