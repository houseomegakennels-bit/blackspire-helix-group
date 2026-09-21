import { NextRequest, NextResponse } from "next/server";

import { getSellerLeadDetail, listSellerLeads, updateSellerLead } from "@/lib/seller-engine-server";
import type { SellerLeadStatus } from "@/lib/seller-engine";
import { guardWorkspaceApi } from "@/lib/operator-access";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const denied = await guardWorkspaceApi();
    if (denied) return denied;
    const id = request.nextUrl.searchParams.get("id")?.trim();
    if (id) {
      return NextResponse.json({ ok: true, lead: await getSellerLeadDetail(id) });
    }
    return NextResponse.json({ ok: true, leads: await listSellerLeads() });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Lead fetch failed." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const denied = await guardWorkspaceApi();
    if (denied) return denied;
    const body = await request.json() as { id?: string; status?: SellerLeadStatus; note?: string; markDuplicate?: boolean };
    if (!body.id) return NextResponse.json({ ok: false, error: "Lead id is required." }, { status: 400 });
    await updateSellerLead(body.id, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Lead update failed." }, { status: 500 });
  }
}
