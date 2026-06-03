import { NextRequest, NextResponse } from "next/server";

import { getReconCustomer, updateReconProfile } from "@/lib/recon-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const account = await getReconCustomer();
  return NextResponse.json({ ok: true, account });
}

export async function PATCH(request: NextRequest) {
  const account = await getReconCustomer();
  if (!account) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const updated = await updateReconProfile(account.id, {
      companyName: typeof body.companyName === "string" ? body.companyName : undefined,
      industry: typeof body.industry === "string" ? body.industry : undefined,
      serviceKeywords:
        typeof body.services === "string"
          ? body.services.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined,
      countiesServed: typeof body.county === "string" && body.county.trim() ? [body.county.trim()] : undefined,
    });
    return NextResponse.json({ ok: true, account: updated });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Update failed." },
      { status: 500 },
    );
  }
}
