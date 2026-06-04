import { NextRequest, NextResponse } from "next/server";

import { saveDealStageUpdate } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      dealId?: string;
      status?: string;
      nextAction?: string;
      note?: string;
    };

    if (!body.dealId?.trim() || !body.status?.trim() || !body.nextAction?.trim()) {
      return NextResponse.json(
        { ok: false, error: "dealId, status, and nextAction are required." },
        { status: 400 },
      );
    }

    const result = await saveDealStageUpdate({
      dealId: body.dealId,
      status: body.status.trim(),
      nextAction: body.nextAction.trim(),
      note: body.note?.trim() || "",
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: `Deal stage updated to ${body.status}.`,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Stage update failed." },
      { status: 500 },
    );
  }
}
