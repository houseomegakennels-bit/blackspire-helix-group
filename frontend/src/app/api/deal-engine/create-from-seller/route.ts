import { NextRequest, NextResponse } from "next/server";

import { createDealFromSellerLead } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { sellerLeadId?: string };
    if (!body.sellerLeadId?.trim()) {
      return NextResponse.json({ ok: false, error: "sellerLeadId is required." }, { status: 400 });
    }

    const result = await createDealFromSellerLead({ sellerLeadId: body.sellerLeadId });
    if (!result.ok) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      dealId: result.dealId,
      message: result.created
        ? `Deal ${result.dealId} created from Seller Engine handoff.`
        : `Deal ${result.dealId} already existed and seller lead was marked as sent to Deal Engine.`,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Deal creation failed." },
      { status: 500 },
    );
  }
}
