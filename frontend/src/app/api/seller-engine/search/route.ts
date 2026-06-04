import { NextRequest, NextResponse } from "next/server";

import { runSellerLiveSearch } from "@/lib/seller-engine-server";
import { SELLER_LIVE_SOURCES, type SellerLiveSourceKey } from "@/lib/seller-engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { sourceKey?: string; county?: string; city?: string; limit?: number };
    if (!body.county?.trim()) {
      return NextResponse.json({ ok: false, error: "County is required." }, { status: 400 });
    }
    const sourceKey = SELLER_LIVE_SOURCES.some((source) => source.key === body.sourceKey)
      ? body.sourceKey as SellerLiveSourceKey
      : undefined;

    const result = await runSellerLiveSearch({
      sourceKey,
      county: body.county,
      city: body.city,
      limit: body.limit,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Live seller search failed." },
      { status: 500 },
    );
  }
}
