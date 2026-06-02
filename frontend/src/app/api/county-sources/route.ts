import { NextRequest, NextResponse } from "next/server";

import {
  getLiveCountyCapabilities,
  getBuyerEngineEnvStatus,
  listAdminCountySourceRows,
  toggleCountySourceActive,
} from "@/lib/buyer-engine-server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const admin = searchParams.get("admin") === "1";

  try {
    if (admin) {
      const rows = await listAdminCountySourceRows();
      return NextResponse.json({
        ok: true,
        rows,
        env: getBuyerEngineEnvStatus(),
      });
    }

    const counties = await getLiveCountyCapabilities(true);
    return NextResponse.json({
      ok: true,
      counties,
      env: getBuyerEngineEnvStatus(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "County source fetch failed.",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as { id?: string; active?: boolean };

    if (!body.id || typeof body.active !== "boolean") {
      return NextResponse.json(
        { ok: false, error: "id (string) and active (boolean) are required." },
        { status: 400 },
      );
    }

    await toggleCountySourceActive(body.id, body.active);
    return NextResponse.json({ ok: true, id: body.id, active: body.active });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "County source toggle failed." },
      { status: 500 },
    );
  }
}
