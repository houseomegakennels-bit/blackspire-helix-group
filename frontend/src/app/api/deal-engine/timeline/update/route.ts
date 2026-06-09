import { NextRequest, NextResponse } from "next/server";

import { updateDealTimelineEvent } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const eventId = String(body.eventId ?? "").trim();
    if (!eventId) return NextResponse.json({ ok: false, error: "eventId is required." }, { status: 400 });
    const result = await updateDealTimelineEvent(eventId, {
      label: body.label,
      status: body.status,
      dueDate: body.dueDate,
      completedAt: body.completedAt,
      notes: body.notes,
    });
    if (!result.ok) return NextResponse.json(result, { status: 500 });
    return NextResponse.json({ ok: true, message: "Timeline event updated." });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Timeline update failed." }, { status: 500 });
  }
}
