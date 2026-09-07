import { NextRequest, NextResponse } from "next/server";

import { getNexusSnapshot, runNexusSkipTrace } from "@/lib/nexus-server";
import { guardAdminApi } from "@/lib/operator-access";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const denied = await guardAdminApi();
  if (denied) return denied;
  try {
    const body = (await request.json()) as { leadId?: string };
    if (!body.leadId?.trim()) {
      return NextResponse.json({ ok: false, error: "leadId is required." }, { status: 400 });
    }

    const snapshot = await getNexusSnapshot();
    const lead = snapshot.leads.find((item) => item.id === body.leadId);
    if (!lead) {
      return NextResponse.json({ ok: false, error: "Lead not found in Nexus queue." }, { status: 404 });
    }

    const result = await runNexusSkipTrace(lead);
    const safeResult = { ...result } as Record<string, unknown>;
    delete safeResult.raw_skiptrace_response;
    return NextResponse.json({ ok: true, result: safeResult });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Skip trace run failed." },
      { status: 500 },
    );
  }
}
