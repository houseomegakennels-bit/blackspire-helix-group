import { NextRequest, NextResponse } from "next/server";

import { saveInvestorInterest, uploadDealDocument } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const slug = String(form.get("slug") ?? "").trim();
    const investorName = String(form.get("investorName") ?? "").trim();
    const investorEmail = String(form.get("investorEmail") ?? "").trim();
    const interestType = String(form.get("interestType") ?? "").trim() || "Interested";
    const notes = String(form.get("notes") ?? "").trim();
    const preferredWalkthroughAt = String(form.get("preferredWalkthroughAt") ?? "").trim();
    const attendeeCount = String(form.get("attendeeCount") ?? "").trim();
    const proofOfFundsStatus = String(form.get("proofOfFundsStatus") ?? "").trim();
    const dealId = String(form.get("dealId") ?? "").trim();
    const proofFile = form.get("proofFile");

    if (!slug || !investorName || !investorEmail) {
      return NextResponse.json(
        { ok: false, error: "slug, investorName, and investorEmail are required." },
        { status: 400 },
      );
    }

    const result = await saveInvestorInterest({
      slug,
      investorName,
      investorEmail,
      interestType,
      notes,
      preferredWalkthroughAt,
      attendeeCount,
      proofOfFundsStatus,
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 500 });
    }

    if (dealId && proofFile instanceof File && proofFile.size > 0) {
      const uploadResult = await uploadDealDocument({
        dealId,
        category: "Proof Of Funds",
        fileName: proofFile.name || "proof-of-funds",
        contentType: proofFile.type || "application/octet-stream",
        bytes: new Uint8Array(await proofFile.arrayBuffer()),
        owner: investorName,
        status: proofOfFundsStatus || "Received",
        notes: `Uploaded from the public deal room by ${investorEmail}. ${notes}`.trim(),
        source: "public-investor",
      });
      if (!uploadResult.ok) {
        return NextResponse.json(uploadResult, { status: 500 });
      }
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
