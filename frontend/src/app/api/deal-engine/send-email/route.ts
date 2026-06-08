import { NextRequest, NextResponse } from "next/server";

import { sendDealEmail } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      dealId?: string;
      to?: string;
      subject?: string;
      body?: string;
      audience?: string;
    };

    if (!body.dealId?.trim() || !body.to?.trim() || !body.subject?.trim() || !body.body?.trim()) {
      return NextResponse.json(
        { ok: false, error: "dealId, to, subject, and body are required." },
        { status: 400 },
      );
    }

    const result = await sendDealEmail({
      dealId: body.dealId.trim(),
      to: body.to.trim(),
      subject: body.subject.trim(),
      body: body.body.trim(),
      audience: body.audience?.trim() || "deal-email",
    });

    if (!result.ok) {
      const status = /RESEND_API_KEY is not configured/i.test(result.error) ? 422 : 500;
      return NextResponse.json(result, { status });
    }

    return NextResponse.json({ ok: true, message: "Email sent." });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Email send failed." },
      { status: 500 },
    );
  }
}
