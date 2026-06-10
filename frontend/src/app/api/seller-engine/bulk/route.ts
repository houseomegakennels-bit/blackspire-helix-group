import { NextRequest, NextResponse } from "next/server";

import { bulkUpdateSellerLeads } from "@/lib/seller-engine-server";
import type { SellerLeadStatus } from "@/lib/seller-engine";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      ids?: string[];
      status?: SellerLeadStatus;
      note?: string;
      markDuplicate?: boolean;
    };

    if (!Array.isArray(body.ids) || !body.ids.length) {
      return NextResponse.json({ ok: false, error: "ids[] is required." }, { status: 400 });
    }
    if (!body.status && !body.note && !body.markDuplicate) {
      return NextResponse.json({ ok: false, error: "Provide a status, note, or markDuplicate." }, { status: 400 });
    }

    const result = await bulkUpdateSellerLeads(body.ids, {
      status: body.status,
      note: body.note,
      markDuplicate: body.markDuplicate,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 207 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Bulk seller update failed." },
      { status: 500 },
    );
  }
}
