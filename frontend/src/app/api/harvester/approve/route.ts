import { NextRequest, NextResponse } from "next/server";

import { approveHarvesterExtraction } from "@/lib/harvester-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { intakeId?: string };
    if (!body.intakeId?.trim()) {
      return NextResponse.json({ ok: false, error: "intakeId is required." }, { status: 400 });
    }

    const result = await approveHarvesterExtraction({ intakeId: body.intakeId });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Approval failed." },
      { status: 500 },
    );
  }
}
