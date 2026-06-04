import { NextRequest, NextResponse } from "next/server";

import { saveInvestorFollowUp } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      dealId?: string;
      investorEmail?: string;
      followUpStatus?: string;
      followUpOwner?: string;
      nextStep?: string;
      notes?: string;
    };

    if (!body.dealId?.trim() || !body.investorEmail?.trim()) {
      return NextResponse.json(
        { ok: false, error: "dealId and investorEmail are required." },
        { status: 400 },
      );
    }

    const result = await saveInvestorFollowUp({
      dealId: body.dealId,
      investorEmail: body.investorEmail.trim(),
      followUpStatus: body.followUpStatus?.trim() || "Response received",
      followUpOwner: body.followUpOwner?.trim() || "Blackspire operator",
      nextStep: body.nextStep?.trim() || "Reach out and confirm walkthrough or packet follow-up.",
      notes: body.notes?.trim() || "",
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: `Investor follow-up saved for ${body.investorEmail}.`,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Investor follow-up failed." },
      { status: 500 },
    );
  }
}
