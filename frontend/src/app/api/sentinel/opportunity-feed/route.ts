import { NextResponse } from "next/server";

import { getSentinelOpportunityFeed } from "@/lib/sentinel-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const feed = await getSentinelOpportunityFeed();
    return NextResponse.json({ ok: true, feed });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to build the Sentinel opportunity feed." },
      { status: 500 },
    );
  }
}
