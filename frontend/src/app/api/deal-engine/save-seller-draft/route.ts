import { NextRequest, NextResponse } from "next/server";

import { saveSellerOutreachDraft } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      dealId?: string;
      kind?: string;
      title?: string;
      body?: string;
    };

    if (!body.dealId?.trim() || !body.kind?.trim() || !body.title?.trim() || !body.body?.trim()) {
      return NextResponse.json(
        { ok: false, error: "dealId, kind, title, and body are required." },
        { status: 400 },
      );
    }

    const result = await saveSellerOutreachDraft({
      dealId: body.dealId.trim(),
      kind: body.kind.trim(),
      title: body.title.trim(),
      body: body.body.trim(),
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: `Seller draft saved for ${body.dealId}.`,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Seller draft save failed." },
      { status: 500 },
    );
  }
}
