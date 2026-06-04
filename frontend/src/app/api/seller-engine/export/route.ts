import { NextResponse } from "next/server";

import { listSellerLeads } from "@/lib/seller-engine-server";

function csvCell(value: unknown) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET() {
  const leads = await listSellerLeads();
  const headers = ["owner_name", "owner_mailing_address", "property_address", "parcel_id", "county", "city", "zip_code", "property_type", "motivation_score", "motivation_reasons", "seller_dossier", "status", "source_data", "recommended_next_action"];
  const rows = leads.map((lead) => [lead.ownerName, lead.ownerMailingAddress, lead.propertyAddress, lead.parcelId, lead.county, lead.city, lead.zipCode, lead.propertyType, lead.score, lead.reasons, lead.summary, lead.status, lead.sourceName, lead.recommendedAction]);
  const csv = [headers.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\n");
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="qualified-seller-leads.csv"' } });
}

