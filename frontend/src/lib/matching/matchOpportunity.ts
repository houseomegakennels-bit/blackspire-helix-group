/**
 * Recon Engine — Matching Engine.
 * Deterministic 0-100 fit score between a business profile and an analyzed
 * opportunity. Pure function (no AI, no I/O) so it is fast, free, and testable.
 */

export type MatchProfile = {
  industry?: string | null;
  serviceKeywords?: string[] | null;
  certifications?: string[] | null;
  countiesServed?: string[] | null;
  state?: string | null;
};

export type MatchOpportunity = {
  title?: string | null;
  category?: string | null;
  location?: string | null;
  opportunityType?: string | null;
  bestFitIndustries?: string[] | null;
  keywords?: string[] | null;
};

export type MatchResult = {
  score: number; // 0-100
  reasons: string[];
};

function norm(value: string): string {
  return value.trim().toLowerCase();
}

function uniqNorm(values?: string[] | null): string[] {
  return [...new Set((values ?? []).map(norm).filter(Boolean))];
}

/**
 * Weights (sum = 100):
 *  - Industry match ........ 35
 *  - Keyword/service overlap 30
 *  - Geography ............. 20
 *  - Opportunity type ...... 10
 *  - Certifications ........  5
 */
export function matchOpportunity(opp: MatchOpportunity, profile: MatchProfile): MatchResult {
  const reasons: string[] = [];
  let score = 0;

  const profileIndustry = norm(profile.industry ?? "");
  const oppIndustries = uniqNorm(opp.bestFitIndustries);
  const oppText = norm(`${opp.title ?? ""} ${opp.category ?? ""}`);

  // Industry (35)
  if (profileIndustry && oppIndustries.includes(profileIndustry)) {
    score += 35;
    reasons.push(`Direct industry match (${profile.industry}).`);
  } else if (profileIndustry && oppText.includes(profileIndustry)) {
    score += 22;
    reasons.push(`Opportunity text references ${profile.industry}.`);
  } else if (oppIndustries.length === 0) {
    score += 10;
    reasons.push("Opportunity is industry-agnostic.");
  }

  // Keyword / service overlap (30)
  const services = uniqNorm(profile.serviceKeywords);
  const oppKeywords = uniqNorm(opp.keywords);
  if (services.length && oppKeywords.length) {
    const overlap = services.filter((s) => oppKeywords.some((k) => k.includes(s) || s.includes(k)));
    if (overlap.length) {
      const pts = Math.min(30, overlap.length * 10);
      score += pts;
      reasons.push(`Service match on: ${overlap.slice(0, 4).join(", ")}.`);
    }
  } else if (services.length && oppText) {
    const overlap = services.filter((s) => oppText.includes(s));
    if (overlap.length) {
      score += Math.min(20, overlap.length * 8);
      reasons.push(`Services appear in the opportunity: ${overlap.slice(0, 4).join(", ")}.`);
    }
  }

  // Geography (20)
  const oppLocation = norm(opp.location ?? "");
  const state = norm(profile.state ?? "");
  const counties = uniqNorm(profile.countiesServed);
  if (oppLocation && counties.some((c) => oppLocation.includes(c))) {
    score += 20;
    reasons.push("Located in a county you serve.");
  } else if (oppLocation && state && oppLocation.includes(state)) {
    score += 12;
    reasons.push("In your state.");
  } else if (!oppLocation) {
    score += 6;
    reasons.push("No location restriction found.");
  }

  // Opportunity type (10)
  const oppType = norm(opp.opportunityType ?? opp.category ?? "");
  if (oppType.includes("contract") || oppType.includes("rfp") || oppType.includes("bid")) {
    score += 10;
    reasons.push("Recurring/contract-style opportunity.");
  } else if (oppType) {
    score += 5;
  }

  // Certifications (5)
  const certs = uniqNorm(profile.certifications);
  if (certs.length && (oppText.includes("set-aside") || oppText.includes("minority") || oppText.includes("veteran") || oppText.includes("small business"))) {
    score += 5;
    reasons.push("Your certifications may qualify for set-aside preference.");
  }

  const final = Math.max(0, Math.min(100, Math.round(score)));
  if (!reasons.length) reasons.push("Limited overlap with your profile.");
  return { score: final, reasons };
}
