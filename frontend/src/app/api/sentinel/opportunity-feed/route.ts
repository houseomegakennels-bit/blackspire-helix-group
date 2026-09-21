import { guardWorkspaceApi as requireProductionWorkspaceApi } from "@/lib/operator-access";
import { NextResponse } from "next/server";

import { getSentinelOpportunityFeed } from "@/lib/sentinel-server";
import { guardWorkspaceApi } from "@/lib/operator-access";

export const dynamic = "force-dynamic";

export async function GET() {
  const accessDenied = await requireProductionWorkspaceApi();
  if (accessDenied) return accessDenied;

  try {
    const denied = await guardWorkspaceApi();
    if (denied) return denied;
    const feed = await getSentinelOpportunityFeed();
    return NextResponse.json({ ok: true, feed });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to build the Sentinel opportunity feed." },
      { status: 500 },
    );
  }
}
