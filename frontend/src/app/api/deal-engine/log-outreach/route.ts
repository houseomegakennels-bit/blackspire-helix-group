import { NextRequest, NextResponse } from "next/server";

import { saveDealOutreachExecution } from "@/lib/deal-engine-server";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    dealId?: string;
    audience?: string;
    channel?: string;
    recipient?: string;
    status?: string;
    outcome?: string;
    nextStep?: string;
    notes?: string;
  };

  if (!body.dealId || !body.audience || !body.channel || !body.recipient || !body.status) {
    return NextResponse.json(
      { ok: false, error: "dealId, audience, channel, recipient, and status are required." },
      { status: 400 },
    );
  }

  const result = await saveDealOutreachExecution({
    dealId: body.dealId,
    audience: body.audience,
    channel: body.channel,
    recipient: body.recipient,
    status: body.status,
    outcome: body.outcome ?? "",
    nextStep: body.nextStep ?? "",
    notes: body.notes ?? "",
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message: "Outreach execution logged." });
}
