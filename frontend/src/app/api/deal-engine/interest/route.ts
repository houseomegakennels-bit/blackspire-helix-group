import { NextRequest, NextResponse } from "next/server";

import { saveInvestorInterest } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      slug?: string;
      investorName?: string;
      investorEmail?: string;
      interestType?: string;
      notes?: string;
      preferredWalkthroughAt?: string;
      attendeeCount?: string;
      proofOfFundsStatus?: string;
    };

    if (!body.slug?.trim() || !body.investorName?.trim() || !body.investorEmail?.trim()) {
      return NextResponse.json(
        { ok: false, error: "slug, investorName, and investorEmail are required." },
        { status: 400 },
      );
    }

    const result = await saveInvestorInterest({
      slug: body.slug,
      investorName: body.investorName,
      investorEmail: body.investorEmail,
      interestType: body.interestType?.trim() || "Interested",
      notes: body.notes?.trim() || "",
      preferredWalkthroughAt: body.preferredWalkthroughAt?.trim() || "",
      attendeeCount: body.attendeeCount?.trim() || "",
      proofOfFundsStatus: body.proofOfFundsStatus?.trim() || "",
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: "Investor interest received. Blackspire will follow up with next steps.",
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Interest submission failed." },
      { status: 500 },
    );
  }
}
