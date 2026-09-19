import { productionCapabilityReadScope } from "@/lib/capability-read-client";
import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { authorizeInternalCapability } from "@/lib/internal-capability-auth";
import { readBoundedRequestBody } from "@/lib/bounded-request-body";
import { listBuyerProfilesForCapability, matchBuyersForProperty } from "@/lib/buyer-engine-server";

export const dynamic = "force-dynamic";

const allowedKeys = new Set([
  "workspaceId", "matchesOnly", "buyerName", "buyerGroup", "state", "county", "city",
  "postalCodes", "postalCode", "propertyType", "buyerProfileType", "minBeds", "maxPrice",
  "preferredRadius", "cashBuyer", "llcBuyer", "activeOnly", "opportunityId", "propertyAddress", "limit",
]);

type DealLookupRow = {
  property_address: string | null;
  county: string | null;
  city: string | null;
  property_type: string | null;
};


export async function POST(request: NextRequest) {
  try { return await handleRead(request); }
  catch { return NextResponse.json({ ok: false, error: "Capability unavailable" }, { status: 503 }); }
}

async function handleRead(request: NextRequest) {
  let body: unknown; let bodyBytes: string;
  try { bodyBytes = await readBoundedRequestBody(request); body = JSON.parse(bodyBytes); }
  catch { return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  const input = body as Record<string, unknown>;
  const capabilityId = input.matchesOnly === true ? "buyer.matches.search" : "buyer.profiles.search";
  const authority = await authorizeInternalCapability(request, bodyBytes, input.workspaceId, capabilityId);
  if (!authority) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (Object.keys(input).some((key) => !allowedKeys.has(key))) return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  const limit = Number(input.limit ?? 5);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10 || (input.matchesOnly !== undefined && typeof input.matchesOnly !== "boolean")) {
    return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  }

  let scope;
  try { scope = productionCapabilityReadScope(authority.bindingDigest); }
  catch { return NextResponse.json({ ok: false, error: "Capability unavailable" }, { status: 503 }); }
  const sourceSnapshotAt = new Date().toISOString();
  if (input.matchesOnly === true) {
    const opportunityId = typeof input.opportunityId === "string" ? input.opportunityId.trim() : "";
    if (opportunityId && !/^DE-\d{4}$/i.test(opportunityId)) return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
    if (!opportunityId) return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
    const supabase = scope.client;
    if (!supabase) return NextResponse.json({ ok: false, error: "Buyer capability unavailable" }, { status: 503 });
    const { data, error } = await supabase
      .from("deal_leads")
      .select("property_address,county,city,property_type")
      .eq("id", opportunityId.toUpperCase())
      .limit(1)
      .maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: "Buyer capability unavailable" }, { status: 503 });
    if (!data) return scope.respond({ matches: [], sourceSnapshotAt });
    let result;
    try {
      const deal = data as DealLookupRow;
      result = await matchBuyersForProperty({ county: deal.county, city: deal.city, propertyType: deal.property_type, limit }, { readOnly: true, readClient: scope.client });
    } catch {
      return NextResponse.json({ ok: false, error: "Buyer capability unavailable" }, { status: 503 });
    }
    const matches = result.matches.map((row) => ({
      opportunityId: opportunityId.toUpperCase(),
      buyerId: row.buyerId,
      displayName: row.buyerName,
      matchScore: row.matchScore,
      matchReasons: row.reasons,
      recommendedAction: row.recommendedAction,
      source: row.source,
    }));
    return scope.respond({ matches, sourceSnapshotAt });
  }

  let rows;
  try {
    rows = await listBuyerProfilesForCapability({
      buyerName: typeof input.buyerName === "string" ? input.buyerName.trim() || null : null,
      state: typeof input.state === "string" ? input.state.trim() || null : null,
      county: typeof input.county === "string" ? input.county.trim() || null : null,
      propertyType: typeof input.propertyType === "string" ? input.propertyType.trim() || null : null,
      cashBuyer: typeof input.cashBuyer === "boolean" ? input.cashBuyer : null,
      llcBuyer: typeof input.llcBuyer === "boolean" ? input.llcBuyer : null,
      limit,
    }, scope.client);
  } catch {
    return NextResponse.json({ ok: false, error: "Buyer capability unavailable" }, { status: 503 });
  }
  const profiles = rows.map((row) => ({
    id: row.id,
    displayName: row.buyer_name?.trim() || "Unnamed buyer",
    buyerType: row.is_cash_buyer ? "cash buyer" : row.is_llc ? "LLC buyer" : null,
    county: row.county, state: row.state, city: null, postalCode: null,
    propertyType: row.property_types?.[0] || null,
    minBeds: null, maxPrice: null, preferredRadius: null,
    cashBuyer: Boolean(row.is_cash_buyer), llcBuyer: Boolean(row.is_llc), active: true,
    buyBoxSummary: null,
    scoreSummary: row.score == null ? null : `Buyer score ${Math.max(0, Math.min(99, Math.round(row.score)))}/100`,
    source: "BuyerProfile",
  }));
  return scope.respond({ profiles, matches: [], sourceSnapshotAt });
}
