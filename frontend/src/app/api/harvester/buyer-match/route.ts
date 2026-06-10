import { NextRequest, NextResponse } from "next/server";

import { runHarvesterBuyerMatch } from "@/lib/harvester-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { intakeId?: string };
    if (!body.intakeId?.trim()) {
      return NextResponse.json({ ok: false, error: "intakeId is required." }, { status: 400 });
    }

    const result = await runHarvesterBuyerMatch({ intakeId: body.intakeId });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Buyer Engine matching failed." },
      { status: 500 },
    );
  }
}
