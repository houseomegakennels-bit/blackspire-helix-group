import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

import { getDealEngineDealDetail, type DealEngineDealDetail } from "@/lib/deal-engine-server";

type RouteContext = {
  params: Promise<{ dealId: string }>;
};

type ContractHeadline = ReturnType<typeof contractHeadline>;

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

function drawSection(
  page: PDFPage,
  titleFont: PDFFont,
  bodyFont: PDFFont,
  title: string,
  body: string,
  y: number,
) {
  page.drawText(title, {
    x: 52,
    y,
    size: 12,
    font: titleFont,
    color: rgb(0.92, 0.86, 0.69),
  });

  return drawWrappedText(page, bodyFont, body, 52, y - 18, 508, 11, 14) - 12;
}

function drawBulletList(
  page: PDFPage,
  titleFont: PDFFont,
  bodyFont: PDFFont,
  title: string,
  items: string[],
  y: number,
) {
  page.drawText(title, {
    x: 52,
    y,
    size: 12,
    font: titleFont,
    color: rgb(0.92, 0.86, 0.69),
  });
  y -= 18;

  items.forEach((item) => {
    page.drawText("-", {
      x: 56,
      y,
      size: 12,
      font: titleFont,
      color: rgb(0.22, 0.83, 0.92),
    });
    y = drawWrappedText(page, bodyFont, item, 70, y, 490, 10.5, 13) - 6;
  });

  return y - 6;
}

function drawPageFrame(page: PDFPage) {
  page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(0.03, 0.05, 0.08) });
  page.drawRectangle({ x: 42, y: 42, width: 528, height: 708, borderColor: rgb(0.24, 0.27, 0.3), borderWidth: 1 });
}

function drawPageHeader(
  page: PDFPage,
  titleFont: PDFFont,
  bodyFont: PDFFont,
  title: string,
  subtitle: string,
  meta: string,
) {
  const { height } = page.getSize();
  page.drawText(title, {
    x: 52,
    y: height - 68,
    size: 22,
    font: titleFont,
    color: rgb(0.22, 0.83, 0.92),
  });
  page.drawText(subtitle, {
    x: 52,
    y: height - 95,
    size: 15,
    font: titleFont,
    color: rgb(0.92, 0.86, 0.69),
  });
  page.drawText(meta, {
    x: 52,
    y: height - 118,
    size: 10,
    font: bodyFont,
    color: rgb(0.8, 0.83, 0.88),
  });
}

function deriveOfferWindow(detail: DealEngineDealDetail) {
  const explicit = detail.contractDraft?.offerWindow?.trim();
  if (explicit && !/\$0\s*-\s*\$0/.test(explicit)) return explicit;

  const high = detail.underwriting.maximumAllowableOffer;
  if (high > 0) {
    const low = Math.max(
      high - Math.max(detail.underwriting.assignmentFeeTarget / 2, 5000),
      0,
    );
    return `$${low.toLocaleString()} - $${high.toLocaleString()}`;
  }

  return detail.lead.mao !== "$0" ? `${detail.lead.mao} target` : "Set underwriting before sending";
}

function contractHeadline(detail: DealEngineDealDetail, dealId: string) {
  const earnestMoney =
    detail.contractDraft?.earnestMoney && detail.contractDraft.earnestMoney !== "$0"
      ? detail.contractDraft.earnestMoney
      : detail.coordination.earnestMoneyStatus || "To be confirmed";
  const closingDate = detail.coordination.closingDate || "To be set by operator";
  const inspectionPeriod = detail.coordination.inspectionEndsOn || "14 days or per agreed terms";
  const contractType =
    detail.contractDraft?.contractType
    ?? detail.coordination.buyerAssignmentStatus
    ?? "Assignable purchase agreement";

  return {
    contractType,
    offerWindow: deriveOfferWindow(detail),
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

function renderSummaryPage(page: PDFPage, titleFont: PDFFont, bodyFont: PDFFont, model: ContractHeadline) {
  const { height } = page.getSize();
  drawPageFrame(page);
  drawPageHeader(
    page,
    titleFont,
    bodyFont,
    "BLACKSPIRE DEAL ENGINE",
    "Wholesale Purchase Agreement Draft",
    `Deal ${model.dealId} | Generated ${model.effectiveDate}`,
  );

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

  y = drawSection(page, titleFont, bodyFont, "Draft Notice", model.draftNotice, y - 28);
  y = drawSection(
    page,
    titleFont,
    bodyFont,
    "Core Terms",
    "Buyer agrees to purchase the property identified above on an as-is basis, subject to final approved contract terms, title review, access, and the inspection period noted in this draft. Replace this language with the approved Blackspire purchase agreement language before execution.",
    y,
  );
  drawBulletList(page, titleFont, bodyFont, "Wholesale Compliance", model.contractWarnings.slice(0, 3), y);
}

function renderNotesPage(page: PDFPage, titleFont: PDFFont, bodyFont: PDFFont, model: ContractHeadline) {
  drawPageFrame(page);
  drawPageHeader(
    page,
    titleFont,
    bodyFont,
    "BLACKSPIRE DEAL ENGINE",
    "Contract Notes and Execution",
    `Deal ${model.dealId}`,
  );

  let y = 620;
  y = drawSection(page, titleFont, bodyFont, "Acquisition Notes", model.acquisitionSummary, y);
  y = drawSection(page, titleFont, bodyFont, "Disposition Notes", model.dispositionSummary, y);
  y = drawBulletList(page, titleFont, bodyFont, "Operator Next Steps", model.nextSteps.slice(0, 4), y);
  y = drawBulletList(page, titleFont, bodyFont, "Pre-Send Checklist", model.complianceChecklist.slice(0, 4), y);

  const signatureY = Math.max(y - 24, 122);
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
}

export async function GET(_: Request, { params }: RouteContext) {
  const { dealId } = await params;
  const detail = await getDealEngineDealDetail(dealId);
  if (!detail) return new Response("Deal not found", { status: 404 });

  const model = contractHeadline(detail, dealId);

  const pdf = await PDFDocument.create();
  const titleFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await pdf.embedFont(StandardFonts.Helvetica);

  const summaryPage = pdf.addPage([612, 792]);
  renderSummaryPage(summaryPage, titleFont, bodyFont, model);

  const notesPage = pdf.addPage([612, 792]);
  renderNotesPage(notesPage, titleFont, bodyFont, model);

  const bytes = await pdf.save();
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${dealId}-contract-draft.pdf"`,
    },
  });
}
