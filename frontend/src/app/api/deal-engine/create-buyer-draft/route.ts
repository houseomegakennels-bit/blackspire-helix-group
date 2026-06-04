import { NextRequest, NextResponse } from "next/server";

import { createDealBuyerOutreachDraft } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { dealId?: string; buyerSignalId?: string };
    if (!body.dealId?.trim() || !body.buyerSignalId?.trim()) {
      return NextResponse.json(
        { ok: false, error: "dealId and buyerSignalId are required." },
        { status: 400 },
      );
    }

    const result = await createDealBuyerOutreachDraft({
      dealId: body.dealId,
      buyerSignalId: body.buyerSignalId,
    });
    if (!result.ok) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: `Buyer outreach draft created for ${result.draft.buyerName}.`,
      draft: result.draft,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Buyer draft creation failed." },
      { status: 500 },
    );
  }
}
