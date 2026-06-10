import { NextResponse } from "next/server";

import { getSentinelFollowUpQueue } from "@/lib/sentinel-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const queue = await getSentinelFollowUpQueue();
    return NextResponse.json({ ok: true, queue });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to build the Sentinel follow-up queue." },
      { status: 500 },
    );
  }
}
