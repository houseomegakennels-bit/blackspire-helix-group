import { NextRequest, NextResponse } from "next/server";

import { saveDealAnalysis } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      dealId?: string;
      estimatedArv?: number;
      sellerAskingPrice?: number;
      repairEstimate?: number;
      closingCosts?: number;
      holdingCosts?: number;
      buyerProfitTarget?: number;
      assignmentFeeTarget?: number;
      rentalEstimate?: number;
      flipEstimate?: number;
    };

    if (!body.dealId?.trim()) {
      return NextResponse.json({ ok: false, error: "dealId is required." }, { status: 400 });
    }

    const result = await saveDealAnalysis({
      dealId: body.dealId.trim(),
      estimatedArv: Number(body.estimatedArv ?? 0),
      sellerAskingPrice: Number(body.sellerAskingPrice ?? 0),
      repairEstimate: Number(body.repairEstimate ?? 0),
      closingCosts: Number(body.closingCosts ?? 0),
      holdingCosts: Number(body.holdingCosts ?? 0),
      buyerProfitTarget: Number(body.buyerProfitTarget ?? 0),
      assignmentFeeTarget: Number(body.assignmentFeeTarget ?? 0),
      rentalEstimate: Number(body.rentalEstimate ?? 0),
      flipEstimate: Number(body.flipEstimate ?? 0),
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: `Underwriting saved for ${body.dealId}.`,
      underwriting: result.underwriting,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Underwriting save failed." },
      { status: 500 },
    );
  }
}
