import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { matchBuyersForProperty, type BuyerForPropertyResult } from "@/lib/buyer-engine-server";
import { getSentinelDeals, type SentinelDeal } from "@/lib/sentinel-server";
import { scoreSellerLead } from "@/lib/sentinel-display";
import {
  calculateExpectedRevenue,
  calculatePropertyHealthScore,
  type OpportunityScoreResult,
  type PropertyHealthResult,
} from "@/lib/sentinel-scoring";

/**
 * The unified Property record view — one aggregator that composes every system
 * around a single property (the master `properties` record). It READS from each
 * engine and reuses the shared scorers; it never duplicates property data or
 * re-implements engine logic.
 */

function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type PropertyTimelineEvent = {
  at: string;
  label: string;
  source: "seller" | "deal" | "note" | "alert";
};

export type PropertyCommandView = {
  property: {
    id: string;
    address: string;
    city: string | null;
    county: string | null;
    state: string | null;
    zip: string | null;
    propertyType: string | null;
    assessedValue: number | null;
    estimatedEquity: number | null;
    vacant: boolean;
    taxDelinquent: boolean;
    foreclosure: boolean;
    probate: boolean;
    codeViolation: boolean;
  };
  owner: { name: string | null; mailingAddress: string | null } | null;
  seller: { id: string; status: string; motivationScore: number; recommendedAction: string | null } | null;
  deal: SentinelDeal | null;
  buyers: BuyerForPropertyResult;
  scores: {
    opportunity: OpportunityScoreResult;
    dealReadiness: number | null;
    dealReadinessCategory: string | null;
    propertyHealth: PropertyHealthResult;
  };
  expectedRevenue: number | null;
  potentialAssignmentValue: number | null;
  nextBestAction: { label: string; href: string; reason: string };
  timeline: PropertyTimelineEvent[];
  related: {
    sellerLeadId: string | null;
    dealId: string | null;
    buyerCount: number;
    hasContract: boolean;
    hasTransaction: boolean;
  };
};

function fraction(parts: boolean[]): number {
  if (!parts.length) return 0;
  return parts.filter(Boolean).length / parts.length;
}

function deriveNextBestAction(view: {
  sellerExists: boolean;
  sellerEngaged: boolean;
  deal: SentinelDeal | null;
  buyerDemand: number;
  propertyId: string;
}): { label: string; href: string; reason: string } {
  const { deal, propertyId } = view;
  if (!view.sellerExists) {
    return { label: "Promote to Seller Engine", href: "/workspace/harvester", reason: "No seller lead exists for this property yet." };
  }
  if (!view.sellerEngaged) {
    return { label: "Run Skip Trace", href: "/workspace/nexus", reason: "Seller identified but contact is not yet resolved." };
  }
  if (!deal) {
    return { label: "Create Deal", href: "/workspace/deal-engine", reason: "Motivated seller is ready — open a deal lane." };
  }
  if (view.buyerDemand < 40) {
    return { label: "Find Buyers", href: `/workspace/property/${propertyId}`, reason: "Validate buyer demand before further acquisition effort." };
  }
  if (!deal.contractSigned) {
    return { label: "Send Offer / Get Signature", href: `/workspace/deal-engine/${deal.dealId}`, reason: "Buyers exist — lock the contract." };
  }
  if (!deal.emdReceived) {
    return { label: "Collect EMD", href: `/workspace/deal-engine/${deal.dealId}`, reason: "Contract signed — secure earnest money." };
  }
  if (!deal.titleCompanyAssigned) {
    return { label: "Open Title", href: `/workspace/deal-engine/${deal.dealId}`, reason: "Move the signed deal into title." };
  }
  return { label: "Coordinate Closing", href: `/workspace/deal-engine/${deal.dealId}`, reason: "Drive the remaining closing checklist to done." };
}

export async function getPropertyCommandView(propertyId: string): Promise<PropertyCommandView | null> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return null;

  const { data: property } = await supabase.from("properties").select("*").eq("id", propertyId).maybeSingle();
  if (!property) return null;

  const [{ data: owner }, { data: sellerLead }, deals] = await Promise.all([
    property.owner_id
      ? supabase.from("owners").select("name, mailing_address").eq("id", property.owner_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("seller_leads")
      .select("id, status, motivation_score, recommended_action")
      .eq("property_id", propertyId)
      .order("created_at", { ascending: false })
      .maybeSingle(),
    getSentinelDeals().catch(() => [] as SentinelDeal[]),
  ]);

  const deal =
    deals.find((d) => d.propertyId === propertyId) ??
    deals.find((d) => d.propertyAddress?.toLowerCase() === (property.property_address ?? "").toLowerCase()) ??
    null;

  const buyers = await matchBuyersForProperty({
    county: property.county,
    state: property.state ?? "NC",
    city: property.city,
    zip: property.zip_code,
    propertyType: property.property_type,
    askingPrice: property.assessed_value,
    limit: 8,
  }).catch(() => ({ matches: [], buyerCount: 0, demandScore: 0, assignmentPotential: "low" as const, county: property.county }));

  // Timeline from existing event sources (no new timeline table).
  const [{ data: statusHistory }, { data: notes }, { data: closingEvents }, { data: alerts }] = await Promise.all([
    sellerLead?.id
      ? supabase.from("lead_status_history").select("to_status, created_at").eq("seller_lead_id", sellerLead.id)
      : Promise.resolve({ data: [] }),
    sellerLead?.id
      ? supabase.from("lead_notes").select("note, created_at").eq("seller_lead_id", sellerLead.id)
      : Promise.resolve({ data: [] }),
    deal?.dealId
      ? supabase.from("deal_closing_timeline_events").select("label, status, completed_at, created_at").eq("deal_id", deal.dealId).order("created_at", { ascending: false }).limit(20)
      : Promise.resolve({ data: [] }),
    sellerLead?.id
      ? supabase.from("seller_alerts").select("title, created_at").eq("seller_lead_id", sellerLead.id)
      : Promise.resolve({ data: [] }),
  ]);

  const timeline: PropertyTimelineEvent[] = [
    { at: property.imported_at as string, label: "Property imported", source: "deal" as const },
    ...((statusHistory ?? []) as Array<Record<string, unknown>>).map((row) => ({
      at: String(row.created_at),
      label: `Status → ${row.to_status}`,
      source: "seller" as const,
    })),
    ...((notes ?? []) as Array<Record<string, unknown>>).map((row) => ({
      at: String(row.created_at),
      label: String(row.note).slice(0, 120),
      source: "note" as const,
    })),
    ...((closingEvents ?? []) as Array<Record<string, unknown>>).map((row) => ({
      at: String(row.completed_at ?? row.created_at),
      label: `${row.label}${row.status ? ` (${row.status})` : ""}`,
      source: "deal" as const,
    })),
    ...((alerts ?? []) as Array<Record<string, unknown>>).map((row) => ({
      at: String(row.created_at),
      label: String(row.title),
      source: "alert" as const,
    })),
  ]
    .filter((event) => event.at && !Number.isNaN(Date.parse(event.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  // Scores (all via the shared single-source helpers).
  const opportunity = scoreSellerLead({
    score: sellerLead?.motivation_score ?? undefined,
    assessedValue: property.assessed_value ?? undefined,
    estimatedEquity: property.estimated_equity ?? undefined,
    signals: { vacant: property.vacant ?? false, codeViolation: property.code_violation ?? false },
  });

  const sellerEngaged = Boolean(sellerLead && sellerLead.status && sellerLead.status !== "New");
  const propertyHealth = calculatePropertyHealthScore({
    dataCompleteness: fraction([
      Boolean(property.property_address),
      Boolean(property.owner_id),
      Boolean(property.county),
      Boolean(property.city),
      Boolean(property.zip_code),
      Boolean(property.property_type),
      property.assessed_value != null,
    ]),
    sellerEngagement: sellerLead ? (sellerEngaged ? 1 : 0.5) : 0,
    contractReadiness: deal ? (deal.contractSigned ? 1 : 0.4) : 0,
    buyerReadiness: (buyers.demandScore ?? 0) / 100,
    titleReadiness: deal ? (deal.titleCompanyAssigned ? 1 : 0.3) : 0,
    closingReadiness: deal ? (deal.closingDateSet ? 1 : deal.emdReceived ? 0.5 : 0.2) : 0,
  });

  const potentialAssignmentValue = deal?.potentialValue ?? opportunity.potentialAssignmentValue ?? null;
  const expectedRevenue = calculateExpectedRevenue(potentialAssignmentValue, deal?.readiness.score ?? opportunity.score);

  return {
    property: {
      id: property.id as string,
      address: (property.property_address as string) ?? "Unresolved address",
      city: property.city ?? null,
      county: property.county ?? null,
      state: property.state ?? null,
      zip: property.zip_code ?? null,
      propertyType: property.property_type ?? null,
      assessedValue: property.assessed_value ?? null,
      estimatedEquity: property.estimated_equity ?? null,
      vacant: Boolean(property.vacant),
      taxDelinquent: Boolean(property.tax_delinquent),
      foreclosure: Boolean(property.foreclosure),
      probate: Boolean(property.probate),
      codeViolation: Boolean(property.code_violation),
    },
    owner: owner ? { name: owner.name ?? null, mailingAddress: owner.mailing_address ?? null } : null,
    seller: sellerLead
      ? {
          id: sellerLead.id as string,
          status: (sellerLead.status as string) ?? "New",
          motivationScore: sellerLead.motivation_score ?? 0,
          recommendedAction: (sellerLead.recommended_action as string) ?? null,
        }
      : null,
    deal,
    buyers,
    scores: {
      opportunity,
      dealReadiness: deal?.readiness.score ?? null,
      dealReadinessCategory: deal?.readiness.category ?? null,
      propertyHealth,
    },
    expectedRevenue,
    potentialAssignmentValue,
    nextBestAction: deriveNextBestAction({
      sellerExists: Boolean(sellerLead),
      sellerEngaged,
      deal,
      buyerDemand: buyers.demandScore ?? 0,
      propertyId,
    }),
    timeline: timeline.slice(0, 30),
    related: {
      sellerLeadId: sellerLead?.id ?? null,
      dealId: deal?.dealId ?? null,
      buyerCount: buyers.buyerCount,
      hasContract: Boolean(deal?.contractSigned),
      hasTransaction: Boolean(deal?.emdReceived || deal?.titleCompanyAssigned),
    },
  };
}

/** Lightweight list for choosing a property when no id is supplied. */
export async function listPropertiesForCommand(limit = 50) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];
  const { data } = await supabase
    .from("properties")
    .select("id, property_address, city, county, state, estimated_equity")
    .order("imported_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((row) => ({
    id: row.id as string,
    address: (row.property_address as string) ?? "Unresolved address",
    city: row.city ?? null,
    county: row.county ?? null,
    state: row.state ?? null,
    estimatedEquity: row.estimated_equity ?? null,
  }));
}
