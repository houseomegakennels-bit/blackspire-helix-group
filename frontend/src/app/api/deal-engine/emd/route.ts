import { NextRequest, NextResponse } from "next/server";

import { getDealEmdStatus, updateDealEmdTracker } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const dealId = request.nextUrl.searchParams.get("dealId")?.trim() || "";
    if (!dealId) return NextResponse.json({ ok: false, error: "dealId is required." }, { status: 400 });
    const tracker = await getDealEmdStatus(dealId);
    return NextResponse.json({ ok: true, tracker });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "EMD load failed." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const dealId = String(body.dealId ?? "").trim();
    if (!dealId) return NextResponse.json({ ok: false, error: "dealId is required." }, { status: 400 });
    const result = await updateDealEmdTracker(dealId, body);
    if (!result.ok) return NextResponse.json(result, { status: 500 });
    const tracker = await getDealEmdStatus(dealId);
    return NextResponse.json({ ok: true, tracker, message: "EMD tracker updated." });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "EMD update failed." }, { status: 500 });
  }
}
