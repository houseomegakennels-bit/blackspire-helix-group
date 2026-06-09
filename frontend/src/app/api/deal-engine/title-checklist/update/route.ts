import { NextRequest, NextResponse } from "next/server";

import { updateDealTitleChecklistItem } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      itemId?: string;
      status?: string;
      notes?: string;
      dueDate?: string;
      assignedOwner?: string;
    };
    if (!body.itemId?.trim()) return NextResponse.json({ ok: false, error: "itemId is required." }, { status: 400 });
    const result = await updateDealTitleChecklistItem(body.itemId.trim(), body);
    if (!result.ok) return NextResponse.json(result, { status: 500 });
    return NextResponse.json({ ok: true, message: "Checklist item updated." });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Checklist update failed." }, { status: 500 });
  }
}
