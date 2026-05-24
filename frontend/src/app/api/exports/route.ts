import { NextRequest, NextResponse } from "next/server";

import {
  createExportRecord,
  getBuyerEngineEnvStatus,
  listExports,
} from "@/lib/buyer-engine-server";

export async function GET(request: NextRequest) {
  try {
    const searchJobId = request.nextUrl.searchParams.get("searchJobId")?.trim() || undefined;
    const exports = await listExports({ searchJobId });

    return NextResponse.json({
      ok: true,
      exports,
      env: getBuyerEngineEnvStatus(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown export fetch failure.",
        env: getBuyerEngineEnvStatus(),
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      searchJobId?: string;
      fileName?: string;
      rowCount?: number;
      storagePath?: string;
    };

    const fileName = body.fileName?.trim();
    const rowCount = Number(body.rowCount ?? 0);

    if (!fileName) {
      return NextResponse.json(
        {
          ok: false,
          error: "fileName is required.",
          env: getBuyerEngineEnvStatus(),
        },
        { status: 400 },
      );
    }

    if (!Number.isFinite(rowCount) || rowCount < 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "rowCount must be a non-negative number.",
          env: getBuyerEngineEnvStatus(),
        },
        { status: 400 },
      );
    }

    const record = await createExportRecord({
      searchJobId: body.searchJobId?.trim() || null,
      fileName,
      rowCount,
      storagePath: body.storagePath?.trim() || undefined,
    });

    return NextResponse.json({
      ok: true,
      export: record,
      env: getBuyerEngineEnvStatus(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown export persistence failure.",
        env: getBuyerEngineEnvStatus(),
      },
      { status: 500 },
    );
  }
}
