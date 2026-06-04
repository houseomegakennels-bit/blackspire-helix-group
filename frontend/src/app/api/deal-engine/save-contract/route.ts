import { NextRequest, NextResponse } from "next/server";

import { saveDealContractTerms } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      dealId?: string;
      contractType?: string;
      offerLow?: number;
      offerHigh?: number;
      earnestMoney?: number;
    };

    if (!body.dealId?.trim()) {
      return NextResponse.json({ ok: false, error: "dealId is required." }, { status: 400 });
    }

    const result = await saveDealContractTerms({
      dealId: body.dealId,
      contractType: body.contractType?.trim() || "Assignable purchase agreement",
      offerLow: Number(body.offerLow ?? 0),
      offerHigh: Number(body.offerHigh ?? 0),
      earnestMoney: Number(body.earnestMoney ?? 0),
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: `Contract posture saved for ${body.dealId}.`,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Contract save failed." },
      { status: 500 },
    );
  }
}
