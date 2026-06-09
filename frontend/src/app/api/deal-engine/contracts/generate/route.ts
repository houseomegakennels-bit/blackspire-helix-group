import { NextRequest, NextResponse } from "next/server";

import { generateContractDraftFromTemplate } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      dealId?: string;
      templateKey?: string;
      templateType?: string;
      requestedUse?: string;
      state?: string | null;
    };

    if (!body.dealId?.trim() || !body.templateType?.trim()) {
      return NextResponse.json({ ok: false, error: "dealId and templateType are required." }, { status: 400 });
    }

    const result = await generateContractDraftFromTemplate(body.dealId.trim(), body.templateType.trim(), {
      templateKey: body.templateKey?.trim() || undefined,
      requestedUse: body.requestedUse?.trim() || body.templateType.trim(),
      state: body.state?.trim() || undefined,
    });

    if (!result) {
      return NextResponse.json({ ok: false, error: "Deal not found." }, { status: 404 });
    }

    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error, validation: result.validation }, { status: 400 });
    }

    return NextResponse.json({ ok: true, draft: result.draft, validation: result.validation });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Contract generation failed." },
      { status: 500 },
    );
  }
}
