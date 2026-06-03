import { NextRequest, NextResponse } from "next/server";

import { createLeadScan } from "@/lib/recon-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const result = await createLeadScan(body);

    return NextResponse.json({
      ok: true,
      id: result.id,
      snapshot: result.snapshot,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to generate opportunity scan.";
    const status = /required/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
