import { guardAdminApi } from "@/lib/operator-access";
import { NextRequest, NextResponse } from "next/server";

import { generateSellerLeadSummary } from "@/lib/seller-engine-server";
import type { SellerLeadView } from "@/lib/seller-engine-demo";
import { guardWorkspaceApi } from "@/lib/operator-access";

export async function POST(request: NextRequest) {
  const denied = await guardAdminApi();
  if (denied) return denied;
  try {
    const denied = await guardWorkspaceApi();
    if (denied) return denied;
    const lead = await request.json() as SellerLeadView;
    return NextResponse.json({ ok: true, summary: await generateSellerLeadSummary(lead) });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Summary generation failed." }, { status: 500 });
  }
}
