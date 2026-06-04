import { NextRequest, NextResponse } from "next/server";

import { saveDealPacket } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      dealId?: string;
      propertyNotes?: string;
      investorSummary?: string;
      buyerEmailBlast?: string;
      buyerSmsAlert?: string;
      contactInstructions?: string;
      deadlineToSubmitOffer?: string;
      comps?: string[];
    };

    if (!body.dealId?.trim()) {
      return NextResponse.json({ ok: false, error: "dealId is required." }, { status: 400 });
    }

    const result = await saveDealPacket({
      dealId: body.dealId,
      propertyNotes: body.propertyNotes?.trim() || "",
      investorSummary: body.investorSummary?.trim() || "",
      buyerEmailBlast: body.buyerEmailBlast?.trim() || "",
      buyerSmsAlert: body.buyerSmsAlert?.trim() || "",
      contactInstructions: body.contactInstructions?.trim() || "",
      deadlineToSubmitOffer: body.deadlineToSubmitOffer?.trim() || "",
      comps: Array.isArray(body.comps) ? body.comps.map((item) => String(item).trim()).filter(Boolean) : [],
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: `Deal packet saved for ${body.dealId}.`,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Packet save failed." },
      { status: 500 },
    );
  }
}
