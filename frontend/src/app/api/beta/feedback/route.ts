import { NextRequest, NextResponse } from "next/server";

import { submitBetaFeedback } from "@/lib/beta-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { category?: string; message?: string; pagePath?: string };
    if (!body.message?.trim()) {
      return NextResponse.json({ ok: false, error: "A message is required." }, { status: 400 });
    }
    const result = await submitBetaFeedback({
      category: body.category,
      message: body.message,
      pagePath: body.pagePath,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not submit feedback." },
      { status: 500 },
    );
  }
}
