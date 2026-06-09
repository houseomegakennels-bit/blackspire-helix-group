import { NextRequest, NextResponse } from "next/server";

import { bootstrapDealClosingTimeline, createDealTimelineEvent, listDealClosingTimeline } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const dealId = request.nextUrl.searchParams.get("dealId")?.trim() || "";
    if (!dealId) return NextResponse.json({ ok: false, error: "dealId is required." }, { status: 400 });
    const events = await listDealClosingTimeline(dealId);
    return NextResponse.json({ ok: true, events });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Timeline load failed." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const dealId = String(body.dealId ?? "").trim();
    if (!dealId) return NextResponse.json({ ok: false, error: "dealId is required." }, { status: 400 });
    if (body.bootstrap) {
      const events = await bootstrapDealClosingTimeline(dealId);
      return NextResponse.json({ ok: true, events });
    }
    const result = await createDealTimelineEvent(dealId, body);
    if (!result.ok) return NextResponse.json(result, { status: 500 });
    const events = await listDealClosingTimeline(dealId);
    return NextResponse.json({ ok: true, events, eventId: result.eventId, message: "Timeline event created." });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Timeline save failed." }, { status: 500 });
  }
}
