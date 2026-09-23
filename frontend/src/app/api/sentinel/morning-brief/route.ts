import { guardWorkspaceApi as requireProductionWorkspaceApi } from "@/lib/operator-access";
import { NextResponse } from "next/server";

import { getSentinelMorningBrief } from "@/lib/sentinel-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const accessDenied = await requireProductionWorkspaceApi();
  if (accessDenied) return accessDenied;

  try {
    const brief = await getSentinelMorningBrief();
    return NextResponse.json({ ok: true, brief });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to build the Sentinel morning brief." },
      { status: 500 },
    );
  }
}
