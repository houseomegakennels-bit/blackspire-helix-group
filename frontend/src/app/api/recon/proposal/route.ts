import { NextRequest, NextResponse } from "next/server";

import { getReconCustomer } from "@/lib/recon-auth";
import { generateProposalForBid } from "@/lib/recon-engine-server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const account = await getReconCustomer().catch(() => null);
  if (!account) {
    return NextResponse.json(
      { ok: false, error: "Sign in to generate proposals." },
      { status: 401 },
    );
  }

  try {
    const body = (await request.json()) as { bidId?: string };
    if (!body.bidId) {
      return NextResponse.json({ ok: false, error: "bidId is required." }, { status: 400 });
    }

    const draft = await generateProposalForBid(
      {
        id: account.id,
        companyName: account.companyName,
        industry: account.industry,
        serviceKeywords: account.serviceKeywords,
      },
      body.bidId,
    );

    return NextResponse.json({ ok: true, draft });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Proposal generation failed." },
      { status: 500 },
    );
  }
}
