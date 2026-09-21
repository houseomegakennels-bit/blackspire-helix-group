import { guardWorkspaceApi as requireProductionWorkspaceApi } from "@/lib/operator-access";
import { NextRequest, NextResponse } from "next/server";

import { runHarvesterBuyerTrace } from "@/lib/harvester-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const accessDenied = await requireProductionWorkspaceApi();
  if (accessDenied) return accessDenied;

  try {
    const body = (await request.json()) as { buyerMatchId?: string };
    if (!body.buyerMatchId?.trim()) {
      return NextResponse.json({ ok: false, error: "buyerMatchId is required." }, { status: 400 });
    }

    const result = await runHarvesterBuyerTrace({ buyerMatchId: body.buyerMatchId });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Buyer skip trace failed." },
      { status: 500 },
    );
  }
}
