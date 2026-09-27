import type { RealEstateExpansionState } from "@/lib/real-estate-jurisdiction";

export type RealEstateReadiness = "blocked" | "research" | "pilot" | "ready";
export type JurisdictionType = "county" | "independent_city";

export type RealEstateMarketProfile = {
  key: string;
  name: string;
  state: RealEstateExpansionState;
  jurisdictionType: JurisdictionType;
  researchCoverage: RealEstateReadiness;
  dataReadiness: RealEstateReadiness;
  buyerReadiness: RealEstateReadiness;
  transactionReadiness: RealEstateReadiness;
  notes: string;
};

export const REAL_ESTATE_PILOT_MARKETS: RealEstateMarketProfile[] = [
  {
    key: "TN:Sullivan",
    name: "Sullivan",
    state: "TN",
    jurisdictionType: "county",
    researchCoverage: "research",
    dataReadiness: "research",
    buyerReadiness: "research",
    transactionReadiness: "blocked",
    notes: "First Tennessee data pilot; promotion requires verified source freshness and buyer activity.",
  },
  {
    key: "TN:Washington",
    name: "Washington",
    state: "TN",
    jurisdictionType: "county",
    researchCoverage: "research",
    dataReadiness: "research",
    buyerReadiness: "research",
    transactionReadiness: "blocked",
    notes: "Second Tennessee pilot after Sullivan passes data and buyer acceptance gates.",
  },
  {
    key: "VA:Pittsylvania",
    name: "Pittsylvania",
    state: "VA",
    jurisdictionType: "county",
    researchCoverage: "research",
    dataReadiness: "research",
    buyerReadiness: "research",
    transactionReadiness: "blocked",
    notes: "Virginia county pilot; transaction actions stay blocked pending state operating-model clearance.",
  },
  {
    key: "VA:Danville",
    name: "Danville",
    state: "VA",
    jurisdictionType: "independent_city",
    researchCoverage: "research",
    dataReadiness: "research",
    buyerReadiness: "research",
    transactionReadiness: "blocked",
    notes: "Independent-city profile; never coerce Danville into Pittsylvania County.",
  },
  {
    key: "SC:York",
    name: "York",
    state: "SC",
    jurisdictionType: "county",
    researchCoverage: "research",
    dataReadiness: "research",
    buyerReadiness: "research",
    transactionReadiness: "blocked",
    notes: "South Carolina research pilot; unowned-property promotion remains blocked by default.",
  },
  {
    key: "SC:Spartanburg",
    name: "Spartanburg",
    state: "SC",
    jurisdictionType: "county",
    researchCoverage: "research",
    dataReadiness: "research",
    buyerReadiness: "research",
    transactionReadiness: "blocked",
    notes: "Second South Carolina research pilot after York source qualification.",
  },
];

export function getRealEstateMarketProfile(state: string, name: string) {
  const key = `${state.trim().toUpperCase()}:${name.trim()}`.toLowerCase();
  return REAL_ESTATE_PILOT_MARKETS.find((market) => market.key.toLowerCase() === key) ?? null;
}

export function canRunRealEstateTransactionActions(profile: RealEstateMarketProfile | null | undefined) {
  return profile?.transactionReadiness === "ready";
}
