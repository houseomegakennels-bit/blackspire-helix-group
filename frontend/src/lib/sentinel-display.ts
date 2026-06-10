/**
 * Client-safe Sentinel display helpers.
 *
 * Wraps the pure sentinel-scoring functions with the engine-specific mapping so
 * Harvester cards, Seller leads, the Deal detail page, AND sentinel-server all
 * score the same inputs the same way. No server-only imports — safe in client
 * components.
 */
import {
  calculateDealReadinessScore,
  calculateOpportunityScore,
  getDealReadinessStatus,
  repairBurdenFromText,
  type DealReadinessCategory,
  type DealReadinessResult,
  type OpportunityScoreResult,
} from "@/lib/sentinel-scoring";

export type HarvesterOpportunityLike = {
  confidenceScore?: number | null;
  askingPrice?: number | null;
  phone?: string | null;
  email?: string | null;
  condition?: string | null;
  notes?: string | null;
  occupancyStatus?: string | null;
};

export function scoreHarvesterOpportunity(
  opportunity: HarvesterOpportunityLike | null | undefined,
  buyerMatchCount = 0,
): OpportunityScoreResult | null {
  if (!opportunity) return null;
  return calculateOpportunityScore({
    sellerMotivation: opportunity.confidenceScore ?? 40,
    contactConfidence: opportunity.phone || opportunity.email ? 70 : 20,
    estimatedArv: null,
    askingPrice: opportunity.askingPrice ?? null,
    repairBurden: repairBurdenFromText(opportunity.condition ?? opportunity.notes),
    buyerDemand: Math.min(100, buyerMatchCount * 25),
    marketStrength: 55,
    readinessIndicator: /vacant/i.test(opportunity.occupancyStatus ?? "") ? 0.8 : 0.4,
  });
}

export type SellerLeadLike = {
  score?: number;
  contactConfidenceScore?: number;
  ownerPhone?: string;
  assessedValue?: number;
  estimatedEquity?: number;
  signals?: { vacant?: boolean; codeViolation?: boolean };
};

export function scoreSellerLead(lead: SellerLeadLike): OpportunityScoreResult {
  const arv = lead.assessedValue && lead.estimatedEquity ? lead.assessedValue : null;
  const asking = arv && lead.estimatedEquity ? Math.max(0, (lead.assessedValue ?? 0) - (lead.estimatedEquity ?? 0)) : null;
  return calculateOpportunityScore({
    sellerMotivation: lead.score ?? 0,
    contactConfidence: lead.contactConfidenceScore ?? (lead.ownerPhone ? 60 : 15),
    estimatedArv: arv,
    askingPrice: asking,
    repairBurden: lead.signals?.codeViolation ? 0.7 : 0.4,
    buyerDemand: 50,
    marketStrength: 55,
    readinessIndicator: lead.signals?.vacant ? 0.8 : 0.4,
  });
}

export type DealCoordinationLike = {
  contractSigned?: boolean;
  contractSent?: boolean;
  buyerAssignmentStatus?: string;
  earnestMoneyStatus?: string;
  titleCompany?: string;
  closingDate?: string;
  payoutStatus?: string;
  closingChecklist?: Array<{ status?: string }>;
};

/** Compute Deal Readiness from a DealEngineDealDetail.coordination block. */
export function dealReadinessFromCoordination(
  coordination: DealCoordinationLike,
  options?: { hasDocuments?: boolean },
): DealReadinessResult {
  const checklist = coordination.closingChecklist ?? [];
  const done = checklist.filter((item) => /done|complete|verified|ready|sent|signed|received/i.test(item.status ?? "")).length;
  const titleProgress = checklist.length ? done / checklist.length : 0;
  const buyerAssigned = /assigned|matched|locked|under contract|disposition/i.test(coordination.buyerAssignmentStatus ?? "");
  const emdReceived = /received|collected|deposited|funded|cleared/i.test(coordination.earnestMoneyStatus ?? "");

  return calculateDealReadinessScore({
    contractSigned: Boolean(coordination.contractSigned),
    buyerAssigned,
    emdReceived,
    titleCompanyAssigned: Boolean((coordination.titleCompany ?? "").trim()),
    titleChecklistProgress: titleProgress,
    documentCompleteness: options?.hasDocuments ? 1 : checklist.length ? 0.5 : 0,
    closingDateSet: Boolean((coordination.closingDate ?? "").trim()),
    assignmentAgreementReady: buyerAssigned || Boolean((coordination.payoutStatus ?? "").trim()),
    signatureComplete: Boolean(coordination.contractSigned),
  });
}

export function readinessColor(category: DealReadinessCategory): string {
  if (category === "Ready To Close") return "#34d399";
  if (category === "On Track") return "#2dd4bf";
  if (category === "Needs Attention") return "#fbbf24";
  return "#f87171";
}

export function opportunityTierColor(tier: OpportunityScoreResult["tier"]): string {
  if (tier === "Prime") return "#34d399";
  if (tier === "Strong") return "#2dd4bf";
  if (tier === "Watch") return "#fbbf24";
  return "#94a3b8";
}

export { getDealReadinessStatus };
