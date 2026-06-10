/**
 * Sentinel scoring primitives.
 *
 * Pure, dependency-free functions: input data in, a number/breakdown out. They
 * make NO database calls so they can run on the server or the client and can be
 * imported by Deal Engine, Harvester, Seller Engine, and the Sentinel surfaces
 * without any of them computing scores differently. This is the single source of
 * truth for Deal Readiness Score and Opportunity Score™.
 */

export type DealReadinessCategory = "Ready To Close" | "On Track" | "Needs Attention" | "At Risk";

export type ReadinessFactor = {
  key: string;
  label: string;
  earned: number;
  max: number;
  met: boolean;
  detail?: string;
};

export type DealReadinessInput = {
  contractSigned?: boolean;
  buyerAssigned?: boolean;
  emdReceived?: boolean;
  titleCompanyAssigned?: boolean;
  /** 0..1 fraction of title checklist items completed. */
  titleChecklistProgress?: number;
  /** 0..1 fraction of required documents present. */
  documentCompleteness?: number;
  closingDateSet?: boolean;
  assignmentAgreementReady?: boolean;
  signatureComplete?: boolean;
};

export type DealReadinessResult = {
  score: number;
  category: DealReadinessCategory;
  factors: ReadinessFactor[];
  summary: string;
};

const READINESS_WEIGHTS = {
  contractSigned: 20,
  buyerAssigned: 15,
  emdReceived: 15,
  titleCompanyAssigned: 10,
  titleChecklistProgress: 10,
  documentCompleteness: 10,
  closingDateSet: 10,
  assignmentAgreementReady: 5,
  signatureComplete: 5,
} as const;

function clamp01(value: number | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function getDealReadinessStatus(score: number): DealReadinessCategory {
  if (score >= 90) return "Ready To Close";
  if (score >= 70) return "On Track";
  if (score >= 50) return "Needs Attention";
  return "At Risk";
}

export function calculateDealReadinessScore(input: DealReadinessInput): DealReadinessResult {
  const factors: ReadinessFactor[] = [];
  const boolFactor = (key: keyof typeof READINESS_WEIGHTS, label: string, met: boolean | undefined) => {
    const max = READINESS_WEIGHTS[key];
    const earned = met ? max : 0;
    factors.push({ key, label, earned, max, met: Boolean(met) });
    return earned;
  };
  const fractionFactor = (key: keyof typeof READINESS_WEIGHTS, label: string, fraction: number | undefined) => {
    const max = READINESS_WEIGHTS[key];
    const ratio = clamp01(fraction);
    const earned = Math.round(max * ratio);
    factors.push({
      key,
      label,
      earned,
      max,
      met: ratio >= 0.999,
      detail: `${Math.round(ratio * 100)}% complete`,
    });
    return earned;
  };

  let total = 0;
  total += boolFactor("contractSigned", "Contract signed", input.contractSigned);
  total += boolFactor("buyerAssigned", "Buyer assigned", input.buyerAssigned);
  total += boolFactor("emdReceived", "EMD received", input.emdReceived);
  total += boolFactor("titleCompanyAssigned", "Title company assigned", input.titleCompanyAssigned);
  total += fractionFactor("titleChecklistProgress", "Title checklist progress", input.titleChecklistProgress);
  total += fractionFactor("documentCompleteness", "Document completeness", input.documentCompleteness);
  total += boolFactor("closingDateSet", "Closing date set", input.closingDateSet);
  total += boolFactor("assignmentAgreementReady", "Assignment agreement ready", input.assignmentAgreementReady);
  total += boolFactor("signatureComplete", "Signatures complete", input.signatureComplete);

  const score = Math.max(0, Math.min(100, Math.round(total)));
  const category = getDealReadinessStatus(score);
  const blockers = factors.filter((factor) => !factor.met).map((factor) => factor.label);
  const summary =
    category === "Ready To Close"
      ? "All closing prerequisites are in place."
      : `Top gaps: ${blockers.slice(0, 3).join(", ") || "none"}.`;

  return { score, category, factors, summary };
}

export type OpportunityTier = "Prime" | "Strong" | "Watch" | "Cold";

export type OpportunityScoreInput = {
  /** 0..100 seller motivation. */
  sellerMotivation?: number;
  /** 0..100 contact confidence (Nexus skip trace). */
  contactConfidence?: number;
  /** Estimated ARV and the asking/contract price, used to derive equity spread. */
  estimatedArv?: number | null;
  askingPrice?: number | null;
  /** Repair burden as 0..1 where 1 = heavy rehab. */
  repairBurden?: number;
  /** 0..100 buyer demand signal (buyer_score or match count proxy). */
  buyerDemand?: number;
  /** 0..100 market strength. */
  marketStrength?: number;
  /** 0..1 readiness indicator (e.g. deal readiness / vacant + access). */
  readinessIndicator?: number;
};

export type OpportunityScoreResult = {
  score: number;
  tier: OpportunityTier;
  factors: ReadinessFactor[];
  /** Best estimate of the assignable spread, when ARV + asking are known. */
  potentialAssignmentValue: number | null;
};

const OPPORTUNITY_WEIGHTS = {
  sellerMotivation: 25,
  contactConfidence: 15,
  arvSpread: 20,
  repairBurden: 10,
  buyerDemand: 15,
  marketStrength: 5,
  readinessIndicator: 10,
} as const;

export function getOpportunityTier(score: number): OpportunityTier {
  if (score >= 80) return "Prime";
  if (score >= 60) return "Strong";
  if (score >= 40) return "Watch";
  return "Cold";
}

/**
 * Estimated assignable spread: equity left after a conservative rehab + closing
 * load. Returns null when we lack the ARV or asking price to compute it.
 */
export function estimatePotentialAssignmentValue(
  estimatedArv?: number | null,
  askingPrice?: number | null,
): number | null {
  if (!estimatedArv || !askingPrice || estimatedArv <= 0 || askingPrice <= 0) return null;
  const spread = estimatedArv - askingPrice;
  if (spread <= 0) return 0;
  // Leave room for buyer profit + closing; assume ~40% of gross spread is
  // realistically assignable wholesale margin.
  return Math.round(spread * 0.4);
}

export function calculateOpportunityScore(input: OpportunityScoreInput): OpportunityScoreResult {
  const factors: ReadinessFactor[] = [];
  const scaled = (value: number | undefined, divisor = 100) => clamp01((value ?? 0) / divisor);

  const arvSpreadRatio = (() => {
    if (!input.estimatedArv || !input.askingPrice || input.estimatedArv <= 0) return 0;
    const spread = (input.estimatedArv - input.askingPrice) / input.estimatedArv;
    return clamp01(spread / 0.45); // 45%+ equity spread maxes the factor
  })();

  const push = (key: keyof typeof OPPORTUNITY_WEIGHTS, label: string, ratio: number) => {
    const max = OPPORTUNITY_WEIGHTS[key];
    const earned = Math.round(max * clamp01(ratio));
    factors.push({ key, label, earned, max, met: clamp01(ratio) >= 0.6, detail: `${Math.round(clamp01(ratio) * 100)}%` });
    return earned;
  };

  let total = 0;
  total += push("sellerMotivation", "Seller motivation", scaled(input.sellerMotivation));
  total += push("contactConfidence", "Contact confidence", scaled(input.contactConfidence));
  total += push("arvSpread", "ARV equity spread", arvSpreadRatio);
  total += push("repairBurden", "Repair burden (lighter is better)", 1 - clamp01(input.repairBurden));
  total += push("buyerDemand", "Buyer demand", scaled(input.buyerDemand));
  total += push("marketStrength", "Market strength", scaled(input.marketStrength));
  total += push("readinessIndicator", "Readiness indicators", clamp01(input.readinessIndicator));

  const score = Math.max(0, Math.min(100, Math.round(total)));
  return {
    score,
    tier: getOpportunityTier(score),
    factors,
    potentialAssignmentValue: estimatePotentialAssignmentValue(input.estimatedArv, input.askingPrice),
  };
}

// ---------------------------------------------------------------------------
// Property Health Score — a DISTINCT axis from Deal Readiness.
// Deal Readiness = how close a deal is to closing (only once a deal exists).
// Property Health = whole-lifecycle DATA completeness across every system, so it
// is meaningful even before a deal exists. They never measure the same gap.
// ---------------------------------------------------------------------------

export type PropertyHealthCategory = "Healthy" | "Stable" | "Developing" | "Sparse";

export type PropertyHealthInput = {
  /** 0..1 — core property facts present (address, owner, beds/baths/price, etc). */
  dataCompleteness?: number;
  /** 0..1 — seller identified, contacted, skip-traced. */
  sellerEngagement?: number;
  /** 0..1 — contract drafted/sent/signed. */
  contractReadiness?: number;
  /** 0..1 — buyer demand validated / matches found. */
  buyerReadiness?: number;
  /** 0..1 — title company + checklist progress. */
  titleReadiness?: number;
  /** 0..1 — closing date, EMD, signatures. */
  closingReadiness?: number;
};

export type PropertyHealthResult = {
  score: number;
  category: PropertyHealthCategory;
  factors: ReadinessFactor[];
};

const PROPERTY_HEALTH_WEIGHTS = {
  dataCompleteness: 20,
  sellerEngagement: 20,
  contractReadiness: 15,
  buyerReadiness: 15,
  titleReadiness: 15,
  closingReadiness: 15,
} as const;

export function getPropertyHealthCategory(score: number): PropertyHealthCategory {
  if (score >= 80) return "Healthy";
  if (score >= 60) return "Stable";
  if (score >= 40) return "Developing";
  return "Sparse";
}

export function calculatePropertyHealthScore(input: PropertyHealthInput): PropertyHealthResult {
  const factors: ReadinessFactor[] = [];
  const add = (key: keyof typeof PROPERTY_HEALTH_WEIGHTS, label: string, fraction: number | undefined) => {
    const max = PROPERTY_HEALTH_WEIGHTS[key];
    const ratio = clamp01(fraction);
    const earned = Math.round(max * ratio);
    factors.push({ key, label, earned, max, met: ratio >= 0.999, detail: `${Math.round(ratio * 100)}%` });
    return earned;
  };

  let total = 0;
  total += add("dataCompleteness", "Data completeness", input.dataCompleteness);
  total += add("sellerEngagement", "Seller engagement", input.sellerEngagement);
  total += add("contractReadiness", "Contract readiness", input.contractReadiness);
  total += add("buyerReadiness", "Buyer readiness", input.buyerReadiness);
  total += add("titleReadiness", "Title readiness", input.titleReadiness);
  total += add("closingReadiness", "Closing readiness", input.closingReadiness);

  const score = Math.max(0, Math.min(100, Math.round(total)));
  return { score, category: getPropertyHealthCategory(score), factors };
}

/**
 * Expected Revenue = Potential Assignment Value × Probability of Closing.
 * Probability is derived from a 0..100 readiness score. Returns null when the
 * potential value is unknown.
 */
export function calculateExpectedRevenue(
  potentialAssignmentValue: number | null | undefined,
  readinessScore: number | null | undefined,
): number | null {
  if (!potentialAssignmentValue || potentialAssignmentValue <= 0) return null;
  const probability = clamp01((readinessScore ?? 0) / 100);
  return Math.round(potentialAssignmentValue * probability);
}

/** Map a free-text repair / condition descriptor to a 0..1 burden. */
export function repairBurdenFromText(text?: string | null): number {
  if (!text) return 0.4;
  const value = text.toLowerCase();
  if (/full gut|heavy rehab|tear down|fire damage|condemned|major/.test(value)) return 1;
  if (/needs work|rehab|repairs|tlc|roof|hvac|foundation/.test(value)) return 0.6;
  if (/cosmetic|light|minor|paint|finishing/.test(value)) return 0.3;
  if (/turnkey|move[- ]in ready|renovated|updated/.test(value)) return 0.1;
  return 0.4;
}
