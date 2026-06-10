import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  calculateDealReadinessScore,
  type DealReadinessResult,
  type OpportunityScoreResult,
} from "@/lib/sentinel-scoring";
import { scoreHarvesterOpportunity, scoreSellerLead } from "@/lib/sentinel-display";
import { getHarvesterWorkspaceSnapshot } from "@/lib/harvester-server";
import { listSellerLeads, listSellerAlerts } from "@/lib/seller-engine-server";

/**
 * Sentinel server: the read / summarize / monitor / coordinate / recommend layer
 * above the Blackspire ecosystem. It NEVER writes to deal/seller/harvester data —
 * it reads each engine's existing snapshot once, scores it with the shared
 * sentinel-scoring helpers, and (for the Inbox only) persists attention status to
 * its own sentinel_inbox_items table.
 */

function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

type HarvesterSnapshot = Awaited<ReturnType<typeof getHarvesterWorkspaceSnapshot>>;
type SellerLead = Awaited<ReturnType<typeof listSellerLeads>>[number];

// ---------------------------------------------------------------------------
// Deal readiness board (batched — no per-deal N+1)
// ---------------------------------------------------------------------------

export type SentinelDeal = {
  dealId: string;
  ownerName: string;
  propertyAddress: string;
  county: string;
  status: string;
  motivationScore: number;
  estimatedEquity: number;
  assignmentFee: number | null;
  potentialValue: number | null;
  readiness: DealReadinessResult;
  emdDueDate: string | null;
  emdReceived: boolean;
  buyerAssigned: boolean;
  contractSigned: boolean;
  titleCompanyAssigned: boolean;
  closingDateSet: boolean;
  nextAction: string;
  recommendedNextAction: string | null;
  updatedAt: string | null;
};

const RECEIVED_EMD = new Set(["received", "collected", "deposited", "funded", "cleared"]);
const DONE_STATUSES = new Set(["done", "complete", "completed", "verified", "received", "ready", "cleared", "signed"]);

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function daysUntil(date: string | null | undefined): number | null {
  if (!date) return null;
  const t = Date.parse(date);
  if (Number.isNaN(t)) return null;
  return Math.round((t - Date.now()) / (1000 * 60 * 60 * 24));
}

async function buildDealBoard(supabase: SupabaseClient): Promise<SentinelDeal[]> {
  const { data: dealRows } = await supabase
    .from("deal_leads")
    .select("id, owner_name, property_address, county, status, motivation_score, estimated_equity, recommended_next_action, updated_at")
    .order("updated_at", { ascending: false })
    .limit(200);

  const deals = dealRows ?? [];
  if (!deals.length) return [];
  const ids = deals.map((d) => d.id as string);

  const [emd, assignment, signature, titleItems, closing, contracts, packets] = await Promise.all([
    supabase.from("deal_emd_trackers").select("deal_id, emd_status, emd_due_date, emd_amount").in("deal_id", ids),
    supabase
      .from("deal_assignment_fee_trackers")
      .select("deal_id, buyer_assignment_price, assignment_fee, expected_net_fee, payout_status, payout_due_date, title_company_fee")
      .in("deal_id", ids),
    supabase
      .from("deal_signature_packets")
      .select("deal_id, signature_status, signed_by_seller_at, signed_by_buyer_at, sent_for_signature_at")
      .in("deal_id", ids),
    supabase.from("deal_title_checklist_items").select("deal_id, status, due_date, item_key").in("deal_id", ids),
    supabase.from("deal_closing_timeline_events").select("deal_id, event_type, label, status, due_date").in("deal_id", ids),
    supabase.from("contracts").select("deal_id").in("deal_id", ids),
    supabase.from("deal_packets").select("deal_id").in("deal_id", ids),
  ]);

  const byDeal = <T extends { deal_id?: string | null }>(rows: T[] | null | undefined) => {
    const map = new Map<string, T[]>();
    for (const row of rows ?? []) {
      const key = (row.deal_id as string) ?? "";
      if (!key) continue;
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return map;
  };

  const emdMap = byDeal(emd.data);
  const assignMap = byDeal(assignment.data);
  const sigMap = byDeal(signature.data);
  const titleMap = byDeal(titleItems.data);
  const closingMap = byDeal(closing.data);
  const contractMap = byDeal(contracts.data);
  const packetMap = byDeal(packets.data);

  return deals.map((deal) => {
    const id = deal.id as string;
    const emdRow = emdMap.get(id)?.[0];
    const assignRow = assignMap.get(id)?.[0];
    const sigRow = sigMap.get(id)?.[0];
    const titleRows = titleMap.get(id) ?? [];
    const closingRows = closingMap.get(id) ?? [];
    const hasContract = (contractMap.get(id)?.length ?? 0) > 0;
    const hasPacket = (packetMap.get(id)?.length ?? 0) > 0;

    const emdReceived = RECEIVED_EMD.has((emdRow?.emd_status ?? "").toLowerCase());
    const buyerAssignmentPrice = num(assignRow?.buyer_assignment_price);
    const buyerAssigned =
      (buyerAssignmentPrice ?? 0) > 0 || /assign|buyer|disposition|closing/i.test((deal.status as string) ?? "");
    const sigStatus = (sigRow?.signature_status ?? "").toLowerCase();
    const contractSigned = Boolean(sigRow?.signed_by_seller_at) || /signed|complete/.test(sigStatus) || hasContract;
    const signatureComplete =
      /complete/.test(sigStatus) || Boolean(sigRow?.signed_by_seller_at && sigRow?.signed_by_buyer_at);
    const titleCompanyAssigned = num(assignRow?.title_company_fee) !== null || titleRows.length > 0;
    const titleDone = titleRows.filter((t) => DONE_STATUSES.has((t.status ?? "").toLowerCase())).length;
    const titleProgress = titleRows.length ? titleDone / titleRows.length : 0;
    const closingDateSet =
      closingRows.some((e) => e.due_date && /clos/i.test(`${e.event_type ?? ""} ${e.label ?? ""}`)) ||
      Boolean(assignRow?.payout_due_date);
    const docFraction = [hasContract, hasPacket, Boolean(sigRow)].filter(Boolean).length / 3;
    const assignmentAgreementReady =
      (num(assignRow?.assignment_fee) ?? 0) > 0 || Boolean(assignRow?.payout_status);

    const readiness = calculateDealReadinessScore({
      contractSigned,
      buyerAssigned,
      emdReceived,
      titleCompanyAssigned,
      titleChecklistProgress: titleProgress,
      documentCompleteness: docFraction,
      closingDateSet,
      assignmentAgreementReady,
      signatureComplete,
    });

    const assignmentFee = num(assignRow?.assignment_fee) ?? num(assignRow?.expected_net_fee);
    const estimatedEquity = num(deal.estimated_equity) ?? 0;
    const potentialValue = assignmentFee ?? (estimatedEquity > 0 ? Math.round(estimatedEquity * 0.12) : null);

    return {
      dealId: id,
      ownerName: (deal.owner_name as string) ?? "Unknown owner",
      propertyAddress: (deal.property_address as string) ?? "Unresolved address",
      county: (deal.county as string) ?? "",
      status: (deal.status as string) ?? "active",
      motivationScore: num(deal.motivation_score) ?? 0,
      estimatedEquity,
      assignmentFee,
      potentialValue,
      readiness,
      emdDueDate: (emdRow?.emd_due_date as string) ?? null,
      emdReceived,
      buyerAssigned,
      contractSigned,
      titleCompanyAssigned,
      closingDateSet,
      nextAction: readiness.summary,
      recommendedNextAction: (deal.recommended_next_action as string) ?? null,
      updatedAt: (deal.updated_at as string) ?? null,
    };
  });
}

// ---------------------------------------------------------------------------
// Opportunity feed items (Harvester + Seller + Deal + Buyer)
// ---------------------------------------------------------------------------

export type SentinelOpportunity = {
  id: string;
  source: "harvester" | "seller" | "deal" | "buyer";
  kind: string;
  title: string;
  subtitle: string;
  opportunityScore: number;
  tier: OpportunityScoreResult["tier"];
  potentialAssignmentValue: number | null;
  recommendedAction: string;
  href: string;
  createdAt: string | null;
};

function harvesterOpportunityScore(intake: HarvesterSnapshot["intakes"][number]): OpportunityScoreResult {
  // Always returns a result for an intake with an opportunity; fall back to an
  // empty score otherwise so callers don't have to null-check.
  return (
    scoreHarvesterOpportunity(intake.opportunity, intake.buyerMatches?.length ?? 0) ??
    scoreHarvesterOpportunity({}, 0)!
  );
}

function sellerOpportunityScore(lead: SellerLead): OpportunityScoreResult {
  return scoreSellerLead(lead);
}

// ---------------------------------------------------------------------------
// Unified ecosystem snapshot (fetched ONCE, derived many ways)
// ---------------------------------------------------------------------------

export type SentinelEcosystemSnapshot = {
  deals: SentinelDeal[];
  harvester: HarvesterSnapshot | null;
  sellerLeads: SellerLead[];
  sellerAlerts: Awaited<ReturnType<typeof listSellerAlerts>>;
  generatedAt: string;
  storageMode: "supabase" | "demo";
};

export async function getSentinelEcosystemSnapshot(): Promise<SentinelEcosystemSnapshot> {
  const supabase = getSupabaseAdmin();
  const [harvester, sellerLeads, sellerAlerts] = await Promise.all([
    getHarvesterWorkspaceSnapshot().catch(() => null),
    listSellerLeads().catch(() => [] as SellerLead[]),
    listSellerAlerts().catch(() => [] as Awaited<ReturnType<typeof listSellerAlerts>>),
  ]);
  const deals = supabase ? await buildDealBoard(supabase).catch(() => []) : [];

  return {
    deals,
    harvester,
    sellerLeads,
    sellerAlerts,
    generatedAt: new Date().toISOString(),
    storageMode: supabase ? "supabase" : "demo",
  };
}

// ---------------------------------------------------------------------------
// 1. Morning Brief
// ---------------------------------------------------------------------------

export type SentinelCriticalItem = {
  type: "emd" | "buyer_missing" | "contract_missing" | "title_missing" | "stale";
  label: string;
  address: string;
  dealId: string;
  dueLabel: string | null;
  severity: "critical" | "warning";
};

export type SentinelMorningBrief = {
  greeting: string;
  generatedAt: string;
  criticalCount: number;
  criticalItems: SentinelCriticalItem[];
  topPriorityDeals: Array<{ rank: number; dealId: string; address: string; readinessScore: number; category: string; reason: string }>;
  newHarvesterOpportunities: number;
  highValueOpportunities: Array<{ title: string; opportunityScore: number; potentialAssignmentValue: number | null }>;
  recommendedPriorities: string[];
  projectedOpportunityValue: number;
  narrative: string;
  narrativeMode: "rules" | "ai";
};

function deriveCriticalItems(deals: SentinelDeal[]): SentinelCriticalItem[] {
  const items: SentinelCriticalItem[] = [];
  for (const deal of deals) {
    const emdDays = daysUntil(deal.emdDueDate);
    if (deal.emdDueDate && !deal.emdReceived && emdDays !== null && emdDays <= 2) {
      items.push({
        type: "emd",
        label: emdDays < 0 ? "EMD overdue" : emdDays === 0 ? "EMD due today" : `EMD due in ${emdDays} day${emdDays === 1 ? "" : "s"}`,
        address: deal.propertyAddress,
        dealId: deal.dealId,
        dueLabel: deal.emdDueDate,
        severity: emdDays <= 0 ? "critical" : "warning",
      });
    }
    if (!deal.buyerAssigned && deal.readiness.score >= 40) {
      items.push({ type: "buyer_missing", label: "Buyer missing", address: deal.propertyAddress, dealId: deal.dealId, dueLabel: null, severity: "warning" });
    }
    if (!deal.contractSigned && /contract|negotiat|offer|active/i.test(deal.status)) {
      items.push({ type: "contract_missing", label: "Contract signature missing", address: deal.propertyAddress, dealId: deal.dealId, dueLabel: null, severity: "warning" });
    }
    if (!deal.titleCompanyAssigned && deal.readiness.score >= 50) {
      items.push({ type: "title_missing", label: "Title info missing", address: deal.propertyAddress, dealId: deal.dealId, dueLabel: null, severity: "warning" });
    }
  }
  const rank = { critical: 0, warning: 1 } as const;
  return items.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 12);
}

async function buildBriefNarrative(brief: Omit<SentinelMorningBrief, "narrative" | "narrativeMode">): Promise<{ narrative: string; mode: "rules" | "ai" }> {
  const rules = [
    `${brief.criticalCount} item${brief.criticalCount === 1 ? "" : "s"} need attention.`,
    brief.topPriorityDeals[0] ? `Lead with ${brief.topPriorityDeals[0].address}.` : "",
    brief.newHarvesterOpportunities ? `${brief.newHarvesterOpportunities} new Harvester opportunit${brief.newHarvesterOpportunities === 1 ? "y" : "ies"} to review.` : "",
    brief.projectedOpportunityValue > 0 ? `Projected assignment revenue in motion: $${brief.projectedOpportunityValue.toLocaleString()}.` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return { narrative: rules, mode: "rules" };
  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        input: [
          {
            role: "system",
            content:
              "You are Sentinel, the command intelligence layer for a real-estate wholesaling operation. Write a tight, energizing 2-3 sentence morning briefing for the operator. Be specific and action-oriented. No greeting, no preamble, no markdown.",
          },
          { role: "user", content: JSON.stringify(brief) },
        ],
        max_output_tokens: 220,
      }),
    });
    if (!response.ok) return { narrative: rules, mode: "rules" };
    const payload = (await response.json()) as { output_text?: string };
    const text = (payload.output_text ?? "").trim();
    return text ? { narrative: text, mode: "ai" } : { narrative: rules, mode: "rules" };
  } catch {
    return { narrative: rules, mode: "rules" };
  }
}

export async function getSentinelMorningBrief(snapshot?: SentinelEcosystemSnapshot): Promise<SentinelMorningBrief> {
  const snap = snapshot ?? (await getSentinelEcosystemSnapshot());
  const criticalItems = deriveCriticalItems(snap.deals);

  const topPriorityDeals = [...snap.deals]
    .sort((a, b) => b.readiness.score - a.readiness.score || (b.potentialValue ?? 0) - (a.potentialValue ?? 0))
    .slice(0, 5)
    .map((deal, index) => ({
      rank: index + 1,
      dealId: deal.dealId,
      address: deal.propertyAddress,
      readinessScore: deal.readiness.score,
      category: deal.readiness.category,
      reason: deal.readiness.summary,
    }));

  const harvesterOpps = (snap.harvester?.intakes ?? [])
    .filter((intake) => intake.opportunity)
    .map((intake) => ({ intake, score: harvesterOpportunityScore(intake) }));
  const highValueOpportunities = harvesterOpps
    .sort((a, b) => b.score.score - a.score.score)
    .slice(0, 3)
    .map(({ intake, score }) => ({
      title: intake.opportunity?.address ?? intake.sourceName ?? "Harvester opportunity",
      opportunityScore: score.score,
      potentialAssignmentValue: score.potentialAssignmentValue,
    }));

  const newHarvesterOpportunities = (snap.harvester?.intakes ?? []).filter(
    (i) => i.extractionStatus === "extracted" && !i.createdSellerLeadId,
  ).length;

  const projectedOpportunityValue =
    snap.deals.reduce((sum, deal) => sum + (deal.potentialValue ?? 0), 0) +
    highValueOpportunities.reduce((sum, opp) => sum + (opp.potentialAssignmentValue ?? 0), 0);

  const recommendedPriorities = [
    ...criticalItems.slice(0, 3).map((item) => `${item.label} — ${item.address}`),
    ...topPriorityDeals.slice(0, 2).map((deal) => `Advance ${deal.address} (${deal.category})`),
  ].slice(0, 5);

  const base = {
    greeting: "Good Morning",
    generatedAt: snap.generatedAt,
    criticalCount: criticalItems.length,
    criticalItems,
    topPriorityDeals,
    newHarvesterOpportunities,
    highValueOpportunities,
    recommendedPriorities,
    projectedOpportunityValue,
  };
  const { narrative, mode } = await buildBriefNarrative(base);
  return { ...base, narrative, narrativeMode: mode };
}

// ---------------------------------------------------------------------------
// 2. Follow-Up Queue
// ---------------------------------------------------------------------------

export type SentinelFollowUp = {
  id: string;
  target: "seller" | "buyer" | "title_company" | "escrow_officer" | "stale_lead" | "marketplace_poster" | "harvester_intake";
  who: string;
  why: string;
  recommendedMessage: string;
  priority: number;
  deadline: string | null;
  href: string;
};

export async function getSentinelFollowUpQueue(snapshot?: SentinelEcosystemSnapshot): Promise<SentinelFollowUp[]> {
  const snap = snapshot ?? (await getSentinelEcosystemSnapshot());
  const queue: SentinelFollowUp[] = [];

  for (const deal of snap.deals) {
    const emdDays = daysUntil(deal.emdDueDate);
    if (deal.emdDueDate && !deal.emdReceived) {
      queue.push({
        id: `escrow-${deal.dealId}`,
        target: "escrow_officer",
        who: `Escrow / EMD on ${deal.propertyAddress}`,
        why: emdDays !== null && emdDays <= 0 ? "EMD is overdue" : `EMD due ${deal.emdDueDate}`,
        recommendedMessage: `Confirm earnest money status for ${deal.propertyAddress} and send the receipt.`,
        priority: emdDays !== null ? Math.max(60, 100 - emdDays * 5) : 70,
        deadline: deal.emdDueDate,
        href: `/workspace/deal-engine/${deal.dealId}`,
      });
    }
    if (!deal.buyerAssigned && deal.readiness.score >= 40) {
      queue.push({
        id: `buyer-${deal.dealId}`,
        target: "buyer",
        who: `Buyer for ${deal.propertyAddress}`,
        why: "No buyer assigned on an otherwise advancing deal",
        recommendedMessage: `Blast ${deal.propertyAddress} to your matched buyer list and lock an assignment.`,
        priority: 55 + Math.round(deal.readiness.score / 10),
        deadline: null,
        href: `/workspace/deal-engine/${deal.dealId}`,
      });
    }
    if (!deal.titleCompanyAssigned && deal.readiness.score >= 50) {
      queue.push({
        id: `title-${deal.dealId}`,
        target: "title_company",
        who: `Title company for ${deal.propertyAddress}`,
        why: "Title/escrow not yet engaged on a near-ready deal",
        recommendedMessage: `Open title on ${deal.propertyAddress} and start the title checklist.`,
        priority: 50,
        deadline: null,
        href: `/workspace/deal-engine/${deal.dealId}`,
      });
    }
  }

  for (const lead of snap.sellerLeads) {
    const isStale =
      lead.status !== "Sent to Deal Engine" &&
      lead.status !== "Dead Lead" &&
      (lead.score ?? 0) >= 60 &&
      !lead.relatedDealId;
    if (isStale) {
      queue.push({
        id: `seller-${lead.id}`,
        target: lead.score >= 75 ? "seller" : "stale_lead",
        who: `${lead.ownerName} — ${lead.propertyAddress}`,
        why: `Motivated seller (score ${lead.score}) with no active deal yet`,
        recommendedMessage: lead.recommendedAction || `Follow up with ${lead.ownerName} about ${lead.propertyAddress}.`,
        priority: 40 + Math.round((lead.score ?? 0) / 5),
        deadline: null,
        href: `/workspace/seller-engine`,
      });
    }
  }

  for (const intake of snap.harvester?.intakes ?? []) {
    if (intake.extractionStatus === "extracted" && !intake.createdSellerLeadId) {
      queue.push({
        id: `harvester-${intake.id}`,
        target: "harvester_intake",
        who: intake.opportunity?.address ?? intake.sourceName ?? "Harvester intake",
        why: "Extracted opportunity awaiting review / promotion",
        recommendedMessage: `Review and approve ${intake.opportunity?.address ?? "this intake"}, then push to Seller Engine.`,
        priority: 45 + Math.round((intake.opportunity?.confidenceScore ?? 0) / 5),
        deadline: null,
        href: `/workspace/harvester`,
      });
    }
  }

  return queue.sort((a, b) => b.priority - a.priority).slice(0, 25);
}

// ---------------------------------------------------------------------------
// 3. Opportunity Feed
// ---------------------------------------------------------------------------

export async function getSentinelOpportunityFeed(snapshot?: SentinelEcosystemSnapshot): Promise<SentinelOpportunity[]> {
  const snap = snapshot ?? (await getSentinelEcosystemSnapshot());
  const feed: SentinelOpportunity[] = [];

  for (const intake of snap.harvester?.intakes ?? []) {
    if (!intake.opportunity) continue;
    const score = harvesterOpportunityScore(intake);
    feed.push({
      id: `hv-${intake.id}`,
      source: "harvester",
      kind: intake.createdSellerLeadId ? "enriched_lead" : "new_opportunity",
      title: intake.opportunity.address ?? intake.sourceName ?? "Harvester opportunity",
      subtitle: `${intake.opportunity.city ?? ""} ${intake.opportunity.state ?? ""} · ${intake.opportunity.askingPrice ? `$${intake.opportunity.askingPrice.toLocaleString()}` : "price n/a"}`.trim(),
      opportunityScore: score.score,
      tier: score.tier,
      potentialAssignmentValue: score.potentialAssignmentValue,
      recommendedAction: intake.createdSellerLeadId ? "Run Nexus + match buyers" : "Review and approve",
      href: "/workspace/harvester",
      createdAt: intake.createdAt ?? null,
    });
  }

  for (const lead of snap.sellerLeads.slice(0, 40)) {
    const score = sellerOpportunityScore(lead);
    if (score.score < 35) continue;
    feed.push({
      id: `sl-${lead.id}`,
      source: "seller",
      kind: lead.relatedDealId ? "active_lead" : "new_lead",
      title: lead.propertyAddress,
      subtitle: `${lead.ownerName} · ${lead.county} · motivation ${lead.score}`,
      opportunityScore: score.score,
      tier: score.tier,
      potentialAssignmentValue: score.potentialAssignmentValue,
      recommendedAction: lead.recommendedAction || "Advance to Deal Engine",
      href: "/workspace/seller-engine",
      createdAt: lead.importedAt ?? null,
    });
  }

  for (const deal of snap.deals) {
    feed.push({
      id: `dl-${deal.dealId}`,
      source: "deal",
      kind: "active_deal",
      title: deal.propertyAddress,
      subtitle: `Readiness ${deal.readiness.score} · ${deal.readiness.category}`,
      opportunityScore: deal.readiness.score,
      tier: deal.readiness.score >= 80 ? "Prime" : deal.readiness.score >= 60 ? "Strong" : deal.readiness.score >= 40 ? "Watch" : "Cold",
      potentialAssignmentValue: deal.potentialValue,
      recommendedAction: deal.recommendedNextAction || deal.readiness.summary,
      href: `/workspace/deal-engine/${deal.dealId}`,
      createdAt: deal.updatedAt,
    });
  }

  return feed.sort((a, b) => b.opportunityScore - a.opportunityScore).slice(0, 50);
}

// ---------------------------------------------------------------------------
// 5. Sentinel Inbox (the one place Sentinel persists state)
// ---------------------------------------------------------------------------

export type SentinelInboxItem = {
  id: string;
  category: string;
  sourceType: string;
  sourceId: string;
  title: string;
  body: string | null;
  severity: "info" | "warning" | "critical";
  priority: number;
  dealId: string | null;
  sellerLeadId: string | null;
  intakeId: string | null;
  linkHref: string | null;
  recommendedAction: string | null;
  status: "unread" | "read" | "resolved" | "archived";
  createdAt: string;
  updatedAt: string;
};

type InboxProjection = {
  category: string;
  source_type: string;
  source_id: string;
  title: string;
  body?: string | null;
  severity?: string;
  priority?: number;
  deal_id?: string | null;
  seller_lead_id?: string | null;
  intake_id?: string | null;
  link_href?: string | null;
  recommended_action?: string | null;
};

/** Project current ecosystem state into inbox rows (idempotent upsert). */
function projectInboxItems(snap: SentinelEcosystemSnapshot): InboxProjection[] {
  const items: InboxProjection[] = [];

  for (const item of deriveCriticalItems(snap.deals)) {
    items.push({
      category: item.type === "emd" ? "alert" : item.type === "title_missing" ? "title_issue" : item.type === "contract_missing" ? "contract_issue" : "alert",
      source_type: `deal_${item.type}`,
      source_id: item.dealId,
      title: `${item.label} — ${item.address}`,
      body: item.dueLabel ? `Due ${item.dueLabel}` : null,
      severity: item.severity,
      priority: item.severity === "critical" ? 95 : 75,
      deal_id: item.dealId,
      link_href: `/workspace/deal-engine/${item.dealId}`,
      recommended_action: item.label,
    });
  }

  for (const alert of snap.sellerAlerts as Array<Record<string, unknown>>) {
    if (alert.read === true) continue;
    items.push({
      category: "alert",
      source_type: "seller_alert",
      source_id: String(alert.id),
      title: String(alert.title ?? "Seller alert"),
      body: typeof alert.message === "string" ? alert.message : null,
      severity: "info",
      priority: 60,
      seller_lead_id: alert.seller_lead_id ? String(alert.seller_lead_id) : null,
      link_href: "/workspace/seller-engine",
      recommended_action: "Review seller alert",
    });
  }

  for (const intake of snap.harvester?.intakes ?? []) {
    if (intake.extractionStatus === "extracted" && !intake.createdSellerLeadId) {
      items.push({
        category: "harvester_review",
        source_type: "harvester_intake",
        source_id: intake.id,
        title: `Review opportunity — ${intake.opportunity?.address ?? intake.sourceName ?? "Harvester intake"}`,
        body: intake.opportunity?.notes ?? null,
        severity: "info",
        priority: 50 + Math.round((intake.opportunity?.confidenceScore ?? 0) / 5),
        intake_id: intake.id,
        link_href: "/workspace/harvester",
        recommended_action: "Approve and promote to Seller Engine",
      });
    }
    for (const dup of intake.duplicates ?? []) {
      items.push({
        category: "watchlist",
        source_type: "harvester_duplicate",
        source_id: String(dup.id ?? `${intake.id}-dup`),
        title: `Possible duplicate — ${intake.opportunity?.address ?? intake.sourceName ?? "intake"}`,
        body: Array.isArray(dup.reasons) ? dup.reasons.join(" ") : null,
        severity: "warning",
        priority: 65,
        intake_id: intake.id,
        link_href: "/workspace/harvester",
        recommended_action: "Confirm or dismiss duplicate",
      });
    }
  }

  return items;
}

export async function syncSentinelInbox(snapshot?: SentinelEcosystemSnapshot): Promise<number> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return 0;
  const snap = snapshot ?? (await getSentinelEcosystemSnapshot());
  const projections = projectInboxItems(snap);
  if (!projections.length) return 0;

  const now = new Date().toISOString();
  // Upsert on (source_type, source_id): refresh open items, never resurrect
  // ones the operator already resolved or archived.
  const { data: existing } = await supabase
    .from("sentinel_inbox_items")
    .select("source_type, source_id, status")
    .in(
      "source_type",
      Array.from(new Set(projections.map((p) => p.source_type))),
    );
  const closed = new Set(
    (existing ?? [])
      .filter((row) => row.status === "resolved" || row.status === "archived")
      .map((row) => `${row.source_type}::${row.source_id}`),
  );

  const rows = projections
    .filter((p) => !closed.has(`${p.source_type}::${p.source_id}`))
    .map((p) => ({
      category: p.category,
      source_type: p.source_type,
      source_id: p.source_id,
      title: p.title,
      body: p.body ?? null,
      severity: p.severity ?? "info",
      priority: p.priority ?? 50,
      deal_id: p.deal_id ?? null,
      seller_lead_id: p.seller_lead_id ?? null,
      intake_id: p.intake_id ?? null,
      link_href: p.link_href ?? null,
      recommended_action: p.recommended_action ?? null,
      updated_at: now,
    }));
  if (!rows.length) return 0;

  const { error } = await supabase.from("sentinel_inbox_items").upsert(rows, { onConflict: "source_type,source_id" });
  if (error) throw new Error(error.message);
  return rows.length;
}

function mapInboxRow(row: Record<string, unknown>): SentinelInboxItem {
  return {
    id: String(row.id),
    category: String(row.category),
    sourceType: String(row.source_type),
    sourceId: String(row.source_id),
    title: String(row.title),
    body: (row.body as string) ?? null,
    severity: (row.severity as SentinelInboxItem["severity"]) ?? "info",
    priority: Number(row.priority ?? 50),
    dealId: (row.deal_id as string) ?? null,
    sellerLeadId: (row.seller_lead_id as string) ?? null,
    intakeId: (row.intake_id as string) ?? null,
    linkHref: (row.link_href as string) ?? null,
    recommendedAction: (row.recommended_action as string) ?? null,
    status: (row.status as SentinelInboxItem["status"]) ?? "unread",
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}

export async function listSentinelInboxItems(options?: {
  statuses?: Array<SentinelInboxItem["status"]>;
  sync?: boolean;
}): Promise<SentinelInboxItem[]> {
  const supabase = getSupabaseAdmin();
  if (!supabase) return [];
  if (options?.sync !== false) {
    await syncSentinelInbox().catch(() => 0);
  }
  const statuses = options?.statuses ?? ["unread", "read"];
  const { data } = await supabase
    .from("sentinel_inbox_items")
    .select("*")
    .in("status", statuses)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(100);
  return (data ?? []).map(mapInboxRow);
}

async function setInboxStatus(id: string, status: SentinelInboxItem["status"]) {
  const supabase = getSupabaseAdmin();
  if (!supabase) return { ok: false as const, error: "Sentinel storage is not configured." };
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "resolved" || status === "archived") patch.resolved_at = new Date().toISOString();
  const { error } = await supabase.from("sentinel_inbox_items").update(patch).eq("id", id);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const, id, status };
}

export const markInboxItemRead = (id: string) => setInboxStatus(id, "read");
export const resolveInboxItem = (id: string) => setInboxStatus(id, "resolved");
export const archiveInboxItem = (id: string) => setInboxStatus(id, "archived");

// ---------------------------------------------------------------------------
// Workspace snapshot (one call powers the whole Sentinel page)
// ---------------------------------------------------------------------------

export type SentinelWorkspaceSnapshot = {
  brief: SentinelMorningBrief;
  followUps: SentinelFollowUp[];
  feed: SentinelOpportunity[];
  inbox: SentinelInboxItem[];
  deals: SentinelDeal[];
  metrics: Array<{ label: string; value: string; detail: string }>;
  generatedAt: string;
  storageMode: "supabase" | "demo";
};

export async function getSentinelWorkspaceSnapshot(): Promise<SentinelWorkspaceSnapshot> {
  const snap = await getSentinelEcosystemSnapshot();
  await syncSentinelInbox(snap).catch(() => 0);
  const [brief, followUps, feed, inbox] = await Promise.all([
    getSentinelMorningBrief(snap),
    getSentinelFollowUpQueue(snap),
    getSentinelOpportunityFeed(snap),
    listSentinelInboxItems({ sync: false }),
  ]);

  const readyToClose = snap.deals.filter((d) => d.readiness.category === "Ready To Close").length;
  const atRisk = snap.deals.filter((d) => d.readiness.category === "At Risk").length;

  const metrics = [
    { label: "Critical Items", value: String(brief.criticalCount).padStart(2, "0"), detail: "Items needing attention today across the ecosystem." },
    { label: "Active Deals", value: String(snap.deals.length).padStart(2, "0"), detail: "Deals currently tracked in the Deal Engine." },
    { label: "Ready To Close", value: String(readyToClose).padStart(2, "0"), detail: "Deals scoring 90+ on readiness." },
    { label: "At Risk", value: String(atRisk).padStart(2, "0"), detail: "Deals scoring under 50 on readiness." },
    { label: "Follow-Ups", value: String(followUps.length).padStart(2, "0"), detail: "Ranked contacts in the follow-up queue." },
    { label: "Inbox", value: String(inbox.filter((i) => i.status === "unread").length).padStart(2, "0"), detail: "Unread Sentinel inbox items." },
    { label: "Opportunities", value: String(feed.length).padStart(2, "0"), detail: "Scored opportunities in the feed." },
    { label: "Projected Revenue", value: `$${Math.round(brief.projectedOpportunityValue / 1000)}k`, detail: "Projected assignment revenue in motion." },
  ];

  return {
    brief,
    followUps,
    feed,
    inbox,
    deals: snap.deals,
    metrics,
    generatedAt: snap.generatedAt,
    storageMode: snap.storageMode,
  };
}
