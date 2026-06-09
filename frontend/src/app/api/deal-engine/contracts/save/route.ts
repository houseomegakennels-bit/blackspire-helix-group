import { NextRequest, NextResponse } from "next/server";

import { saveDealContractDraft } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      dealId?: string;
      templateId?: string | null;
      templateKey?: string | null;
      draftType?: string;
      title?: string;
      body?: string;
      specialTerms?: string;
      status?: string;
      editablePayload?: Record<string, unknown>;
      legalDisclaimerAcknowledged?: boolean;
      generatedPdfUrl?: string;
    };

    if (!body.dealId?.trim() || !body.draftType?.trim() || !body.title?.trim()) {
      return NextResponse.json({ ok: false, error: "dealId, draftType, and title are required." }, { status: 400 });
    }

    const result = await saveDealContractDraft({
      dealId: body.dealId.trim(),
      templateId: body.templateId?.trim() || null,
      templateKey: body.templateKey?.trim() || null,
      draftType: body.draftType.trim(),
      title: body.title.trim(),
      body: body.body?.trim() || "",
      specialTerms: body.specialTerms?.trim() || "",
      status: body.status?.trim() || "draft",
      editablePayload: body.editablePayload ?? {},
      legalDisclaimerAcknowledged: Boolean(body.legalDisclaimerAcknowledged),
      generatedPdfUrl: body.generatedPdfUrl?.trim() || "",
    });

    if (!result.ok) return NextResponse.json(result, { status: 500 });
    return NextResponse.json({ ok: true, message: "Contract draft saved." });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Contract draft save failed." },
      { status: 500 },
    );
  }
}
