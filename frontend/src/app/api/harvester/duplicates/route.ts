import { NextRequest, NextResponse } from "next/server";

import { detectDuplicateHarvesterDeal } from "@/lib/harvester-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { intakeId?: string; persist?: boolean };
    if (!body.intakeId?.trim()) {
      return NextResponse.json({ ok: false, error: "intakeId is required." }, { status: 400 });
    }

    const result = await detectDuplicateHarvesterDeal({
      intakeId: body.intakeId,
      persist: body.persist ?? true,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Duplicate check failed." },
      { status: 500 },
    );
  }
}
