import { NextRequest, NextResponse } from "next/server";

import { calculateDealAssignmentFee, updateDealAssignmentTracker } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const dealId = request.nextUrl.searchParams.get("dealId")?.trim() || "";
    if (!dealId) return NextResponse.json({ ok: false, error: "dealId is required." }, { status: 400 });
    const tracker = await calculateDealAssignmentFee(dealId);
    return NextResponse.json({ ok: true, tracker });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Assignment tracker load failed." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const dealId = String(body.dealId ?? "").trim();
    if (!dealId) return NextResponse.json({ ok: false, error: "dealId is required." }, { status: 400 });
    const result = await updateDealAssignmentTracker(dealId, body);
    if (!result.ok) return NextResponse.json(result, { status: 500 });
    const tracker = await calculateDealAssignmentFee(dealId);
    return NextResponse.json({ ok: true, tracker, message: "Assignment tracker updated." });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Assignment update failed." }, { status: 500 });
  }
}
