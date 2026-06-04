import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { getDealEngineDealDetail } from "@/lib/deal-engine-server";

type RouteContext = {
  params: Promise<{ dealId: string }>;
};

export async function GET(_: Request, { params }: RouteContext) {
  const { dealId } = await params;
  const detail = await getDealEngineDealDetail(dealId);
  if (!detail) return new Response("Deal not found", { status: 404 });

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const { height } = page.getSize();
  const titleFont = await pdf.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await pdf.embedFont(StandardFonts.Helvetica);

  page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(0.03, 0.05, 0.08) });
  page.drawText("BLACKSPIRE DEAL ENGINE", {
    x: 48,
    y: height - 70,
    size: 24,
    font: titleFont,
    color: rgb(0.22, 0.83, 0.92),
  });
  page.drawText("Blackspire Helix Group | Investor Deal Packet", {
    x: 48,
    y: height - 95,
    size: 11,
    font: bodyFont,
    color: rgb(0.9, 0.86, 0.7),
  });

  const lines = [
    `Deal: ${dealId}`,
    `Property: ${detail.lead.propertyAddress}`,
    `Owner: ${detail.lead.ownerName}`,
    `County: ${detail.lead.county}`,
    `Status: ${detail.lead.status}`,
    `MAO: ${detail.lead.mao}`,
    `Assignment Fee: ${detail.lead.assignmentFee}`,
    `Exit Strategy: ${detail.lead.exitStrategy}`,
    `Offer Deadline: ${detail.packet.deadlineToSubmitOffer}`,
    `Contact Instructions: ${detail.packet.contactInstructions}`,
    `Investor Summary: ${detail.packet.investorSummary}`,
    `Property Notes: ${detail.packet.propertyNotes}`,
    `Email Blast: ${detail.packet.buyerEmailBlast}`,
    `SMS Alert: ${detail.packet.buyerSmsAlert}`,
    `Comps: ${detail.packet.comps.join(" | ")}`,
  ];

  lines.forEach((line, index) => {
    page.drawText(line, {
      x: 48,
      y: height - 150 - index * 28,
      size: 11,
      font: bodyFont,
      color: rgb(0.93, 0.95, 0.98),
      maxWidth: 520,
      lineHeight: 13,
    });
  });

  const bytes = await pdf.save();
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${dealId}-packet.pdf"`,
    },
  });
}
