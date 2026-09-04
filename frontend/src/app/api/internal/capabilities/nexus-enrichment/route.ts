import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { authorizeInternalCapability } from "@/lib/internal-capability-auth";

export const dynamic = "force-dynamic";

type NexusContactRow = {
  id: string;
  seller_lead_id: string | null;
  owner_name: string | null;
  property_address: string | null;
  primary_phone: string | null;
  contact_confidence_score: number | null;
  provider: string | null;
  status: string | null;
  updated_at: string;
};

type DealLookupRow = {
  seller_lead_id: string | null;
  owner_name: string | null;
  property_address: string | null;
};

function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function exactIlike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

async function findStoredContact(
  supabase: SupabaseClient,
  args: { sellerLeadId?: string | null; ownerName?: string | null; propertyAddress?: string | null },
): Promise<{ contact: NexusContactRow | null; failed: boolean }> {
  let query = supabase
    .from("nexus_contacts")
    .select("id,seller_lead_id,owner_name,property_address,primary_phone,contact_confidence_score,provider,status,updated_at")
    .order("updated_at", { ascending: false })
    .order("id", { ascending: false });

  if (args.sellerLeadId) {
    query = query.eq("seller_lead_id", args.sellerLeadId);
  } else {
    if (args.ownerName) query = query.ilike("owner_name", exactIlike(args.ownerName));
    if (args.propertyAddress) query = query.ilike("property_address", exactIlike(args.propertyAddress));
  }

  const { data, error } = await query.limit(1).maybeSingle();
  return { contact: error ? null : (data as NexusContactRow | null), failed: Boolean(error) };
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  }
  const input = body as { workspaceId?: unknown; ownerName?: unknown; propertyAddress?: unknown; sellerLeadId?: unknown; dealId?: unknown };
  if (!authorizeInternalCapability(request, input.workspaceId)) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  const allowedKeys = ["workspaceId", "ownerName", "propertyAddress", "sellerLeadId", "dealId"];
  if (Object.keys(input).some((key) => !allowedKeys.includes(key))) {
    return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  }
  const hasOwnerName = typeof input.ownerName === "string" && input.ownerName.trim().length > 0;
  const hasPropertyAddress = typeof input.propertyAddress === "string" && input.propertyAddress.trim().length > 0;
  const hasSellerLeadId = typeof input.sellerLeadId === "string" && input.sellerLeadId.trim().length > 0;
  const dealId = typeof input.dealId === "string" && /^DE-\d{4}$/i.test(input.dealId.trim()) ? input.dealId.trim().toUpperCase() : null;
  if (input.dealId !== undefined && !dealId) return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  if (!hasOwnerName && !hasPropertyAddress && !hasSellerLeadId && !dealId) {
    return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ ok: false, error: "Nexus capability unavailable" }, { status: 503 });

  let lookup = {
    sellerLeadId: hasSellerLeadId ? String(input.sellerLeadId).trim() : null,
    ownerName: hasOwnerName ? String(input.ownerName).trim() : null,
    propertyAddress: hasPropertyAddress ? String(input.propertyAddress).trim() : null,
  };
  if (dealId) {
    const { data, error } = await supabase
      .from("deal_leads")
      .select("seller_lead_id,owner_name,property_address")
      .eq("id", dealId)
      .limit(1)
      .maybeSingle();
    if (error) return NextResponse.json({ ok: false, error: "Nexus capability unavailable" }, { status: 503 });
    if (!data) return notFoundResult();
    const deal = data as DealLookupRow;
    lookup = {
      sellerLeadId: deal.seller_lead_id,
      ownerName: deal.owner_name?.trim() || null,
      propertyAddress: deal.property_address?.trim() || null,
    };
    if (!lookup.sellerLeadId && !lookup.ownerName && !lookup.propertyAddress) return notFoundResult();
  }
  const { contact, failed } = await findStoredContact(supabase, lookup);
  if (failed) return NextResponse.json({ ok: false, error: "Nexus capability unavailable" }, { status: 503 });

  const primaryPhone = contact?.primary_phone?.trim() || null;
  const phoneStatus = primaryPhone ? "Trace Complete" : contact ? "Partial Match" : null;

  if (!contact) return notFoundResult();
  return NextResponse.json({
    ownerName: contact.owner_name?.trim() || null,
    propertyAddress: contact.property_address?.trim() || null,
    skipTraceStatus: contact?.status?.trim() || null,
    phoneStatus,
    contactConfidenceScore: contact?.contact_confidence_score ?? null,
    provider: contact?.provider?.trim() || null,
    source: contact ? "nexus_contacts" : null,
    updatedAt: contact?.updated_at || null,
    sourceSnapshotAt: new Date().toISOString(),
  });
}

function notFoundResult() {
  return NextResponse.json({
    ownerName: null, propertyAddress: null, skipTraceStatus: null, phoneStatus: null,
    contactConfidenceScore: null, provider: null, source: null, updatedAt: null,
    sourceSnapshotAt: new Date().toISOString(),
  });
}
