import { NextRequest, NextResponse } from "next/server";

import { exportContractDraftToPdf } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { draftId?: string };
    if (!body.draftId?.trim()) {
      return NextResponse.json({ ok: false, error: "draftId is required." }, { status: 400 });
    }

    const result = await exportContractDraftToPdf(body.draftId.trim());
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 404 });
    }

    return new NextResponse(result.bytes, {
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "PDF export failed." },
      { status: 500 },
    );
  }
}
