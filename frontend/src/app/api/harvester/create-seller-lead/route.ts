import { NextRequest, NextResponse } from "next/server";

import { createSellerLeadFromHarvester, runHarvesterNexusEnrichment } from "@/lib/harvester-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { intakeId?: string; runNexus?: boolean };
    if (!body.intakeId?.trim()) {
      return NextResponse.json({ ok: false, error: "intakeId is required." }, { status: 400 });
    }

    const result = await createSellerLeadFromHarvester({ intakeId: body.intakeId });
    const nexus = body.runNexus ? await runHarvesterNexusEnrichment({ intakeId: body.intakeId }) : null;
    return NextResponse.json({ ...result, nexus });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Seller Engine handoff failed." },
      { status: 500 },
    );
  }
}
