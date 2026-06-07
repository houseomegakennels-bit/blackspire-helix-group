import { NextRequest, NextResponse } from "next/server";

import { saveDealCloseout } from "@/lib/deal-engine-server";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    dealId?: string;
    outcome?: string;
    closedAt?: string;
    assignmentFeeCollected?: number;
    buyerName?: string;
    notes?: string;
  };

  if (!body.dealId || !body.outcome) {
    return NextResponse.json(
      { ok: false, error: "dealId and outcome are required." },
      { status: 400 },
    );
  }

  const result = await saveDealCloseout({
    dealId: body.dealId,
    outcome: body.outcome,
    closedAt: body.closedAt ?? "",
    assignmentFeeCollected: Number(body.assignmentFeeCollected ?? 0),
    buyerName: body.buyerName ?? "",
    notes: body.notes ?? "",
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message: "Deal closeout recorded." });
}
