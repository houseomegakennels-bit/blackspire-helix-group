import { NextRequest, NextResponse } from "next/server";

import { bootstrapDealTitleChecklist, listDealTitleChecklist } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const dealId = request.nextUrl.searchParams.get("dealId")?.trim() || "";
    if (!dealId) return NextResponse.json({ ok: false, error: "dealId is required." }, { status: 400 });
    const items = await listDealTitleChecklist(dealId);
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Checklist load failed." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { dealId?: string };
    if (!body.dealId?.trim()) return NextResponse.json({ ok: false, error: "dealId is required." }, { status: 400 });
    const items = await bootstrapDealTitleChecklist(body.dealId.trim());
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Checklist bootstrap failed." }, { status: 500 });
  }
}
