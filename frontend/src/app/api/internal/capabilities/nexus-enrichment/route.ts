import "server-only";

import { NextRequest, NextResponse } from "next/server";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { authorizeInternalCapability } from "@/lib/internal-capability-auth";

export const dynamic = "force-dynamic";

type NexusContactRow = {
  seller_lead_id: string | null;
  owner_name: string;
  property_address: string;
  mailing_address: string | null;
  primary_phone: string | null;
  primary_email: string | null;
  contact_confidence_score: number | null;
  provider: string | null;
  status: string | null;
  updated_at: string;
};

function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function normalizeMatch(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function findStoredContact(
  contacts: NexusContactRow[],
  args: { sellerLeadId?: string | null; ownerName?: string | null; propertyAddress?: string | null },
): NexusContactRow | null {
  if (args.sellerLeadId) {
    const found = contacts.find((c) => c.seller_lead_id === args.sellerLeadId);
    if (found) return found;
  }
  if (args.ownerName && args.propertyAddress) {
    return (
      contacts.find(
        (c) =>
          normalizeMatch(c.owner_name) === normalizeMatch(args.ownerName!) &&
          normalizeMatch(c.property_address) === normalizeMatch(args.propertyAddress!),
      ) ?? null
    );
  }
  return null;
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
  const input = body as { workspaceId?: unknown; ownerName?: unknown; propertyAddress?: unknown; sellerLeadId?: unknown };
  if (!authorizeInternalCapability(request, input.workspaceId)) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }
  const allowedKeys = ["workspaceId", "ownerName", "propertyAddress", "sellerLeadId"];
  if (Object.keys(input).some((key) => !allowedKeys.includes(key))) {
    return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  }
  const hasOwnerName = typeof input.ownerName === "string" && input.ownerName.trim().length > 0;
  const hasPropertyAddress = typeof input.propertyAddress === "string" && input.propertyAddress.trim().length > 0;
  const hasSellerLeadId = typeof input.sellerLeadId === "string" && input.sellerLeadId.trim().length > 0;
  if (!hasOwnerName && !hasPropertyAddress && !hasSellerLeadId) {
    return NextResponse.json({ ok: false, error: "invalid request" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return NextResponse.json({ ok: false, error: "Nexus capability unavailable" }, { status: 503 });

  const { data: contacts, error } = await supabase
    .from("nexus_contacts")
    .select("seller_lead_id,owner_name,property_address,mailing_address,contact_confidence_score,provider,status,updated_at")
    .order("updated_at", { ascending: false })
    .limit(500);

  if (error || !contacts?.length) {
    return NextResponse.json(
      {
        ownerName: hasOwnerName ? String(input.ownerName).trim() : null,
        propertyAddress: hasPropertyAddress ? String(input.propertyAddress).trim() : null,
        skipTraceStatus: null,
        phoneStatus: null,
        contactConfidenceScore: null,
        provider: null,
        source: null,
        updatedAt: null,
        sourceSnapshotAt: new Date().toISOString(),
      },
    );
  }

  const contact = findStoredContact(contacts as NexusContactRow[], {
    sellerLeadId: hasSellerLeadId ? String(input.sellerLeadId).trim() : null,
    ownerName: hasOwnerName ? String(input.ownerName).trim() : null,
    propertyAddress: hasPropertyAddress ? String(input.propertyAddress).trim() : null,
  });

  const primaryPhone = contact?.primary_phone?.trim() || null;
  const phoneStatus = primaryPhone ? "Trace Complete" : contact ? "Partial Match" : null;

  return NextResponse.json({
    ownerName: contact?.owner_name?.trim() || (hasOwnerName ? String(input.ownerName).trim() : null),
    propertyAddress: contact?.property_address?.trim() || (hasPropertyAddress ? String(input.propertyAddress).trim() : null),
    skipTraceStatus: contact?.status?.trim() || null,
    phoneStatus,
    contactConfidenceScore: contact?.contact_confidence_score ?? null,
    provider: contact?.provider?.trim() || null,
    source: contact ? "nexus_contacts" : null,
    updatedAt: contact?.updated_at || null,
    sourceSnapshotAt: new Date().toISOString(),
  });
}
