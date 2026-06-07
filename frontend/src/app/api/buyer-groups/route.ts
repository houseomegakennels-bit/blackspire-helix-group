import { NextRequest, NextResponse } from "next/server";

import {
  getBuyerEngineEnvStatus,
  importBuyerGroupRegistryCsv,
  listBuyerGroupRegistry,
  toggleBuyerGroupActive,
} from "@/lib/buyer-engine-server";

export async function GET(request: NextRequest) {
  try {
    const admin = request.nextUrl.searchParams.get("admin") === "1";
    const rows = await listBuyerGroupRegistry(admin);
    return NextResponse.json({
      ok: true,
      rows,
      env: getBuyerEngineEnvStatus(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Buyer group fetch failed.",
        env: getBuyerEngineEnvStatus(),
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { csv?: string };
    const csv = typeof body.csv === "string" ? body.csv : "";
    if (!csv.trim()) {
      return NextResponse.json(
        { ok: false, error: "csv is required." },
        { status: 400 },
      );
    }

    const result = await importBuyerGroupRegistryCsv(csv);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Buyer group import failed.",
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

    await toggleBuyerGroupActive(body.id, body.active);
    return NextResponse.json({ ok: true, id: body.id, active: body.active });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Buyer group toggle failed.",
      },
      { status: 500 },
    );
  }
}
