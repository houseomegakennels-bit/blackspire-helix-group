import { NextRequest, NextResponse } from "next/server";

import { updateSellerWeights } from "@/lib/seller-engine-server";
import type { SellerScoringWeights } from "@/lib/seller-engine";

export async function PUT(request: NextRequest) {
  try {
    const weights = await request.json() as SellerScoringWeights;
    await updateSellerWeights(weights);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Settings update failed." }, { status: 500 });
  }
}

