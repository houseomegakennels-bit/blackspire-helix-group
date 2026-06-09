import { NextRequest, NextResponse } from "next/server";

import { runBuyerReverseSearch, type BuyerReverseSearchCriteria } from "@/lib/buyer-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as BuyerReverseSearchCriteria;
    const result = await runBuyerReverseSearch(body);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Reverse search failed.",
      },
      { status: 500 },
    );
  }
}
