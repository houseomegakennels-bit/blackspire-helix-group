import { guardWorkspaceApi as requireProductionWorkspaceApi } from "@/lib/operator-access";
import { NextRequest, NextResponse } from "next/server";

import { extractHarvesterOpportunity } from "@/lib/harvester-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const accessDenied = await requireProductionWorkspaceApi();
  if (accessDenied) return accessDenied;

  try {
    const body = (await request.json()) as {
      intakeId?: string;
      originalText?: string;
      imageDataUrl?: string;
      metadata?: Record<string, unknown>;
    };

    const result = await extractHarvesterOpportunity(body);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Harvester extraction failed." },
      { status: 500 },
    );
  }
}
