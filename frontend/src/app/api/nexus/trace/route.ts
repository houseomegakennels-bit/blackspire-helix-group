import { NextRequest, NextResponse } from "next/server";

import { getNexusSnapshot, runNexusSkipTrace } from "@/lib/nexus-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
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
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Skip trace run failed." },
      { status: 500 },
    );
  }
}
