import { NextRequest, NextResponse } from "next/server";

import { saveDealCoordination } from "@/lib/deal-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      dealId?: string;
      titleCompany?: string;
      titleOfficer?: string;
      walkthroughAt?: string;
      inspectionEndsOn?: string;
      closingDate?: string;
      buyerAssignmentStatus?: string;
      earnestMoneyStatus?: string;
      payoutStatus?: string;
      contractSent?: boolean;
      contractSigned?: boolean;
      coordinationNotes?: string;
      closingChecklist?: Array<{
        id?: string;
        title?: string;
        status?: string;
        owner?: string;
        dueDate?: string;
      }>;
      closingDocuments?: Array<{
        id?: string;
        name?: string;
        status?: string;
        owner?: string;
        notes?: string;
      }>;
    };

    if (!body.dealId?.trim()) {
      return NextResponse.json({ ok: false, error: "dealId is required." }, { status: 400 });
    }

    const result = await saveDealCoordination({
      dealId: body.dealId,
      titleCompany: body.titleCompany?.trim() || "",
      titleOfficer: body.titleOfficer?.trim() || "",
      walkthroughAt: body.walkthroughAt?.trim() || "",
      inspectionEndsOn: body.inspectionEndsOn?.trim() || "",
      closingDate: body.closingDate?.trim() || "",
      buyerAssignmentStatus: body.buyerAssignmentStatus?.trim() || "",
      earnestMoneyStatus: body.earnestMoneyStatus?.trim() || "",
      payoutStatus: body.payoutStatus?.trim() || "",
      contractSent: Boolean(body.contractSent),
      contractSigned: Boolean(body.contractSigned),
      coordinationNotes: body.coordinationNotes?.trim() || "",
      closingChecklist: Array.isArray(body.closingChecklist)
        ? body.closingChecklist
          .map((item, index) => ({
            id: item.id?.trim() || `checklist-${index + 1}`,
            title: item.title?.trim() || "",
            status: item.status?.trim() || "Open",
            owner: item.owner?.trim() || "Unassigned",
            dueDate: item.dueDate?.trim() || "",
          }))
          .filter((item) => item.title)
        : [],
      closingDocuments: Array.isArray(body.closingDocuments)
        ? body.closingDocuments
          .map((item, index) => ({
            id: item.id?.trim() || `document-${index + 1}`,
            name: item.name?.trim() || "",
            status: item.status?.trim() || "Requested",
            owner: item.owner?.trim() || "Unassigned",
            notes: item.notes?.trim() || "",
          }))
          .filter((item) => item.name)
        : [],
    });

    if (!result.ok) {
      return NextResponse.json(result, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: `Closing coordination saved for ${body.dealId}.`,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Coordination save failed." },
      { status: 500 },
    );
  }
}
