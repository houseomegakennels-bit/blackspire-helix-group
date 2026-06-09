import { NextRequest, NextResponse } from "next/server";

import { attachContractDraftToDocumentVault } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { dealId?: string; draftId?: string };
    if (!body.dealId?.trim() || !body.draftId?.trim()) {
      return NextResponse.json({ ok: false, error: "dealId and draftId are required." }, { status: 400 });
    }

    const result = await attachContractDraftToDocumentVault(body.dealId.trim(), body.draftId.trim());
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    }

    return NextResponse.json({ ok: true, documentId: result.documentId, documentUrl: result.documentUrl });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Vault attachment failed." },
      { status: 500 },
    );
  }
}
