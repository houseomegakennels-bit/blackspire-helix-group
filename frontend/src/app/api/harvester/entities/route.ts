import { NextRequest, NextResponse } from "next/server";

import { createOrUpdateMarketplaceEntity, getHarvesterWorkspaceSnapshot } from "@/lib/harvester-server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snapshot = await getHarvesterWorkspaceSnapshot();
    return NextResponse.json({ ok: true, entities: snapshot.entities });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Unable to load marketplace entities." },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { intakeId?: string };
    if (!body.intakeId?.trim()) {
      return NextResponse.json({ ok: false, error: "intakeId is required." }, { status: 400 });
    }

    const result = await createOrUpdateMarketplaceEntity({ intakeId: body.intakeId });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Marketplace entity update failed." },
      { status: 500 },
    );
  }
}
