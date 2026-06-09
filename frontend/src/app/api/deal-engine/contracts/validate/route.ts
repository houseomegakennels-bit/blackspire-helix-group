import { NextRequest, NextResponse } from "next/server";

import { validateDealFieldsForTemplate } from "@/lib/deal-engine-server";

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

    const validation = await validateDealFieldsForTemplate(body.dealId.trim(), body.templateType.trim(), {
      templateKey: body.templateKey?.trim() || undefined,
      requestedUse: body.requestedUse?.trim() || body.templateType.trim(),
      state: body.state?.trim() || undefined,
    });

    if (!validation) {
      return NextResponse.json({ ok: false, error: "Deal not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, validation });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Contract validation failed." },
      { status: 500 },
    );
  }
}
