import { NextRequest, NextResponse } from "next/server";

import { generateDealCommanderInsight } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      dealId?: string;
    };

    if (!body.dealId?.trim()) {
      return NextResponse.json({ ok: false, error: "dealId is required." }, { status: 400 });
    }

    const insight = await generateDealCommanderInsight(body.dealId.trim());
    if (!insight) {
      return NextResponse.json({ ok: false, error: "Deal not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, insight });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Deal Commander generation failed.",
      },
      { status: 500 },
    );
  }
}
