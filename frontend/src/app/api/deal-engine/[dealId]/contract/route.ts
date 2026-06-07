import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { getDealEngineDealDetail, type DealEngineDealDetail } from "@/lib/deal-engine-server";

type RouteContext = {
  params: Promise<{ dealId: string }>;
};

function drawWrappedText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  size = 11,
  lineHeight = 15,
) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return y;

  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    const candidateWidth = font.widthOfTextAtSize(candidate, size);
    if (candidateWidth <= maxWidth || !currentLine) {
      currentLine = candidate;
      continue;
    }
    lines.push(currentLine);
    currentLine = word;
  }

  if (currentLine) lines.push(currentLine);

  lines.forEach((line, index) => {
    page.drawText(line, {
      x,
      y: y - index * lineHeight,
      size,
      font,
      color: rgb(0.93, 0.95, 0.98),
    });
  });

  return y - lines.length * lineHeight;
}

function drawField(
  page: PDFPage,
  labelFont: PDFFont,
  bodyFont: PDFFont,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
) {
  page.drawText(label, {
    x,
    y,
    size: 10,
    font: labelFont,
    color: rgb(0.22, 0.83, 0.92),
  });

  return drawWrappedText(page, bodyFont, value, x, y - 18, width, 11, 14);
}

function contractHeadline(detail: DealEngineDealDetail, dealId: string) {
  const offerWindow = detail.contractDraft?.offerWindow ?? `${detail.lead.mao} target`;
  const earnestMoney = detail.contractDraft?.earnestMoney ?? "To be confirmed";
  const closingDate = detail.coordination.closingDate || "To be set by operator";
  const inspectionPeriod = detail.coordination.inspectionEndsOn || "14 days or per agreed terms";
  const contractType =
    detail.contractDraft?.contractType
    ?? detail.coordination.buyerAssignmentStatus
    ?? "Assignable purchase agreement";

  return {
    contractType,
    offerWindow,
    earnestMoney,
    closingDate,
    inspectionPeriod,
    effectiveDate: new Date().toLocaleDateString("en-US"),
    sellerLegalName: detail.lead.ownerName || "Seller legal name to confirm",
    buyerLegalName: "Blackspire Helix Group, LLC or Assigns",
    propertyAddress: detail.lead.propertyAddress,
    county: detail.lead.county,
    draftNotice:
      "Draft generated from the live Deal Engine record. Verify legal names, vesting, dates, title requirements, state-specific clauses, and attorney-approved language before signature.",
    acquisitionSummary:
      detail.contractDraft?.outreachLead
      || detail.lead.nextAction
      || "Use the live underwriting and seller context to finalize acquisition terms.",
    dispositionSummary:
      detail.contractDraft?.buyerDispositionNote
      || "Prepare assignment and buyer packet after seller execution.",
    contractWarnings: detail.underwriting.compliance.contractWarnings,
    complianceChecklist: detail.underwriting.compliance.checklist,
    nextSteps: detail.contractDraft?.nextSteps?.length
      ? detail.contractDraft.nextSteps
      : [
          "Confirm seller legal vesting and all required signers.",
          "Confirm inspection, escrow, and closing dates.",
          "Finalize assignment or direct-close posture before signature.",
        ],
    dealId,
  };
}

export async function GET(_: Request, { params }: RouteContext) {
  const { dealId } = await params;
  const detail = await getDealEngineDealDetail(dealId);
  if (!detail) return new Response("Deal not found", { status: 404 });

  const model = contractHeadline(detail, dealId);

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const { height } = page.getSize();
  const titleFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await pdf.embedFont(StandardFonts.Helvetica);

  page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(0.03, 0.05, 0.08) });
  page.drawRectangle({ x: 42, y: 42, width: 528, height: 708, borderColor: rgb(0.24, 0.27, 0.3), borderWidth: 1 });

  page.drawText("BLACKSPIRE DEAL ENGINE", {
    x: 52,
    y: height - 68,
    size: 22,
    font: titleFont,
    color: rgb(0.22, 0.83, 0.92),
  });
  page.drawText("Wholesale Purchase Agreement Draft", {
    x: 52,
    y: height - 95,
    size: 15,
    font: titleFont,
    color: rgb(0.92, 0.86, 0.69),
  });
  page.drawText(`Deal ${model.dealId} | Generated ${model.effectiveDate}`, {
    x: 52,
    y: height - 118,
    size: 10,
    font: bodyFont,
    color: rgb(0.8, 0.83, 0.88),
  });

  let leftY = height - 156;
  let rightY = height - 156;

  leftY = drawField(page, titleFont, bodyFont, "Seller", model.sellerLegalName, 52, leftY, 220);
  leftY = drawField(page, titleFont, bodyFont, "Buyer", model.buyerLegalName, 52, leftY - 8, 220);
  leftY = drawField(page, titleFont, bodyFont, "Property", model.propertyAddress, 52, leftY - 8, 220);
  leftY = drawField(page, titleFont, bodyFont, "County", `${model.county} County, NC`, 52, leftY - 8, 220);

  rightY = drawField(page, titleFont, bodyFont, "Contract Type", model.contractType, 316, rightY, 244);
  rightY = drawField(page, titleFont, bodyFont, "Offer Window", model.offerWindow, 316, rightY - 8, 244);
  rightY = drawField(page, titleFont, bodyFont, "Earnest Money", model.earnestMoney, 316, rightY - 8, 244);
  rightY = drawField(page, titleFont, bodyFont, "Inspection / DD", model.inspectionPeriod, 316, rightY - 8, 244);
  rightY = drawField(page, titleFont, bodyFont, "Closing Target", model.closingDate, 316, rightY - 8, 244);

  let y = Math.min(leftY, rightY) - 16;
  page.drawLine({
    start: { x: 52, y },
    end: { x: 560, y },
    thickness: 1,
    color: rgb(0.24, 0.27, 0.3),
  });

  y -= 28;
  page.drawText("Draft Notice", {
    x: 52,
    y,
    size: 12,
    font: titleFont,
    color: rgb(0.92, 0.86, 0.69),
  });
  y = drawWrappedText(page, bodyFont, model.draftNotice, 52, y - 18, 508, 10, 13) - 14;

  page.drawText("Core Terms", {
    x: 52,
    y,
    size: 12,
    font: titleFont,
    color: rgb(0.92, 0.86, 0.69),
  });
  y = drawWrappedText(
    page,
    bodyFont,
    "Buyer agrees to purchase the property identified above on an as-is basis, subject to final approved contract terms, title review, access, and the inspection period noted in this draft. Replace this language with the approved Blackspire purchase agreement language before execution.",
    52,
    y - 18,
    508,
    11,
    14,
  ) - 12;

  page.drawText("Wholesale Compliance", {
    x: 52,
    y,
    size: 12,
    font: titleFont,
    color: rgb(0.92, 0.86, 0.69),
  });
  y -= 18;
  model.contractWarnings.slice(0, 3).forEach((warning) => {
    page.drawText("-", {
      x: 56,
      y,
      size: 12,
      font: titleFont,
      color: rgb(0.22, 0.83, 0.92),
    });
    y = drawWrappedText(page, bodyFont, warning, 70, y, 490, 10.5, 13) - 6;
  });
  y -= 6;

  page.drawText("Acquisition Notes", {
    x: 52,
    y,
    size: 12,
    font: titleFont,
    color: rgb(0.92, 0.86, 0.69),
  });
  y = drawWrappedText(page, bodyFont, model.acquisitionSummary, 52, y - 18, 508, 11, 14) - 12;

  page.drawText("Disposition Notes", {
    x: 52,
    y,
    size: 12,
    font: titleFont,
    color: rgb(0.92, 0.86, 0.69),
  });
  y = drawWrappedText(page, bodyFont, model.dispositionSummary, 52, y - 18, 508, 11, 14) - 12;

  page.drawText("Operator Next Steps", {
    x: 52,
    y,
    size: 12,
    font: titleFont,
    color: rgb(0.92, 0.86, 0.69),
  });
  y -= 18;
  model.nextSteps.slice(0, 4).forEach((step) => {
    page.drawText("-", {
      x: 56,
      y,
      size: 12,
      font: titleFont,
      color: rgb(0.22, 0.83, 0.92),
    });
    y = drawWrappedText(page, bodyFont, step, 70, y, 490, 10.5, 13) - 6;
  });

  if (y > 170) {
    y -= 2;
    page.drawText("Pre-Send Checklist", {
      x: 52,
      y,
      size: 12,
      font: titleFont,
      color: rgb(0.92, 0.86, 0.69),
    });
    y -= 18;
    model.complianceChecklist.slice(0, 4).forEach((item) => {
      page.drawText("-", {
        x: 56,
        y,
        size: 12,
        font: titleFont,
        color: rgb(0.22, 0.83, 0.92),
      });
      y = drawWrappedText(page, bodyFont, item, 70, y, 490, 10.5, 13) - 6;
    });
  }

  const signatureY = Math.max(y - 32, 122);
  page.drawLine({
    start: { x: 62, y: signatureY },
    end: { x: 252, y: signatureY },
    thickness: 1,
    color: rgb(0.7, 0.72, 0.76),
  });
  page.drawLine({
    start: { x: 336, y: signatureY },
    end: { x: 526, y: signatureY },
    thickness: 1,
    color: rgb(0.7, 0.72, 0.76),
  });
  page.drawText("Seller Signature / Date", {
    x: 62,
    y: signatureY - 18,
    size: 10,
    font: bodyFont,
    color: rgb(0.8, 0.83, 0.88),
  });
  page.drawText("Buyer Signature / Date", {
    x: 336,
    y: signatureY - 18,
    size: 10,
    font: bodyFont,
    color: rgb(0.8, 0.83, 0.88),
  });

  const bytes = await pdf.save();
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${dealId}-contract-draft.pdf"`,
    },
  });
}
