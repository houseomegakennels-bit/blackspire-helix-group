export const SELLER_LEAD_STATUSES = [
  "New",
  "Reviewing",
  "Skip Trace Needed",
  "Contact Ready",
  "Sent to Deal Engine",
  "Dead Lead",
  "Watchlist",
] as const;

export const SELLER_SOURCE_TYPES = [
  "county_tax_records",
  "gis_property_data",
  "foreclosure",
  "probate",
  "tax_delinquent",
  "absentee_owner",
  "code_violation",
  "vacancy",
  "public_auction",
] as const;

export const SELLER_LIVE_SOURCE_KEY = "nc_onemap_absentee_search";
export const SELLER_LIVE_SOURCE_KEYS = [
  SELLER_LIVE_SOURCE_KEY,
  "nc_onemap_legacy_absentee_search",
  "nc_onemap_high_value_absentee_search",
  "nc_onemap_portfolio_absentee_search",
  "nc_onemap_corporate_absentee_search",
  "nc_onemap_legacy_portfolio_absentee_search",
  "nc_onemap_motivated_seller_sweep",
  "nc_onemap_full_recon_sweep",
  "cumberland_county_foreclosure_sales",
  "cumberland_county_delinquent_taxes",
  "forsyth_county_foreclosure_sales",
  "guilford_county_foreclosure_research",
  "mecklenburg_county_foreclosure_properties",
  "mecklenburg_county_delinquent_taxpayers",
  "wake_county_absentee_owners",
  "beaufort_county_absentee_owners",
  "granville_county_absentee_owners",
  "sampson_county_absentee_owners",
  "stokes_county_absentee_owners",
  "stanly_county_absentee_owners",
  "wilkes_county_absentee_owners",
  "warren_county_absentee_owners",
  "robeson_county_absentee_owners",
  "rockingham_county_absentee_owners",
  "orange_county_absentee_owners",
  "nash_county_absentee_owners",
  "edgecombe_county_absentee_owners",
  "ashe_county_absentee_owners",
  "avery_county_absentee_owners",
  "burke_county_absentee_owners",
] as const;

export type SellerLeadStatus = (typeof SELLER_LEAD_STATUSES)[number];
export type SellerSourceType = (typeof SELLER_SOURCE_TYPES)[number];
export type SellerLiveSourceKey = (typeof SELLER_LIVE_SOURCE_KEYS)[number];

export const SELLER_LIVE_SOURCES: Array<{
  key: SellerLiveSourceKey;
  label: string;
  description: string;
  sourceType: SellerSourceType;
}> = [
  {
    key: SELLER_LIVE_SOURCE_KEY,
    label: "NC OneMap Absentee Owners",
    description: "Statewide NC parcel search for residential absentee-owner leads.",
    sourceType: "absentee_owner",
  },
  {
    key: "nc_onemap_legacy_absentee_search",
    label: "NC OneMap Legacy Absentee Owners",
    description: "Statewide NC residential absentee owners with older recorded ownership history.",
    sourceType: "absentee_owner",
  },
  {
    key: "nc_onemap_high_value_absentee_search",
    label: "NC OneMap High-Value Absentee Owners",
    description: "Statewide NC residential absentee owners with higher assessed parcel values.",
    sourceType: "absentee_owner",
  },
  {
    key: "nc_onemap_portfolio_absentee_search",
    label: "NC OneMap Portfolio Absentee Owners",
    description: "Statewide NC residential absentee owners appearing multiple times in the live county result set.",
    sourceType: "absentee_owner",
  },
  {
    key: "nc_onemap_corporate_absentee_search",
    label: "NC OneMap Corporate Absentee Owners",
    description: "Statewide NC residential absentee owners with company or trust-style ownership names.",
    sourceType: "absentee_owner",
  },
  {
    key: "nc_onemap_legacy_portfolio_absentee_search",
    label: "NC OneMap Legacy Portfolio Absentee Owners",
    description: "Statewide NC residential absentee owners with older ownership history and repeat-owner presence in the live result set.",
    sourceType: "absentee_owner",
  },
  {
    key: "nc_onemap_motivated_seller_sweep",
    label: "NC OneMap Motivated Seller Sweep",
    description: "Statewide NC residential absentee owners ranked by overlapping parcel-based motivation patterns such as legacy ownership, portfolio ownership, corporate ownership, and higher assessed value.",
    sourceType: "absentee_owner",
  },
  {
    key: "nc_onemap_full_recon_sweep",
    label: "NC OneMap Full Recon Sweep",
    description: "Runs the strongest NC-wide parcel-based absentee-owner profiles together, de-duplicates the results, and ranks them by overlapping motivation patterns.",
    sourceType: "absentee_owner",
  },
  {
    key: "cumberland_county_foreclosure_sales",
    label: "Cumberland County Foreclosure Sales",
    description: "Official Cumberland County tax foreclosure sale listings from the county tax office.",
    sourceType: "foreclosure",
  },
  {
    key: "cumberland_county_delinquent_taxes",
    label: "Cumberland County Delinquent Taxes",
    description: "Official Cumberland County delinquent real estate tax advertisement records.",
    sourceType: "tax_delinquent",
  },
  {
    key: "forsyth_county_foreclosure_sales",
    label: "Forsyth County Foreclosure Sales",
    description: "Official Forsyth County property tax foreclosure sale listings from the county tax office.",
    sourceType: "foreclosure",
  },
  {
    key: "guilford_county_foreclosure_research",
    label: "Guilford County Foreclosure Research",
    description: "Official Guilford County foreclosure research feed from the county public ArcGIS service.",
    sourceType: "foreclosure",
  },
  {
    key: "mecklenburg_county_foreclosure_properties",
    label: "Mecklenburg County Foreclosure Properties",
    description: "Mecklenburg County-linked foreclosure property listings exposed through the county's published auction-list provider feed.",
    sourceType: "foreclosure",
  },
  {
    key: "mecklenburg_county_delinquent_taxpayers",
    label: "Mecklenburg County Delinquent Taxpayers",
    description: "Official Mecklenburg County delinquent taxpayer advertisement files for individual and business tax bills.",
    sourceType: "tax_delinquent",
  },
  {
    key: "wake_county_absentee_owners",
    label: "Wake County Absentee Owners",
    description: "Official Wake County parcel records filtered into live absentee-owner seller leads from the county property layer.",
    sourceType: "absentee_owner",
  },
  {
    key: "beaufort_county_absentee_owners",
    label: "Beaufort County Absentee Owners",
    description: "Official Beaufort County parcel records filtered into live absentee-owner seller leads from the county parcel service.",
    sourceType: "absentee_owner",
  },
  {
    key: "granville_county_absentee_owners",
    label: "Granville County Absentee Owners",
    description: "Official Granville County parcel records filtered into live absentee-owner seller leads from the county parcel service.",
    sourceType: "absentee_owner",
  },
  {
    key: "sampson_county_absentee_owners",
    label: "Sampson County Absentee Owners",
    description: "Official Sampson County parcel records filtered into live absentee-owner seller leads from the county parcel service.",
    sourceType: "absentee_owner",
  },
  {
    key: "stokes_county_absentee_owners",
    label: "Stokes County Absentee Owners",
    description: "Official Stokes County parcel records filtered into live absentee-owner seller leads from the county parcel service.",
    sourceType: "absentee_owner",
  },
  {
    key: "stanly_county_absentee_owners",
    label: "Stanly County Absentee Owners",
    description: "Official Stanly County parcel records filtered into live absentee-owner seller leads from the county parcel service.",
    sourceType: "absentee_owner",
  },
  {
    key: "wilkes_county_absentee_owners",
    label: "Wilkes County Absentee Owners",
    description: "Official Wilkes County parcel records filtered into live absentee-owner seller leads from the county parcel service.",
    sourceType: "absentee_owner",
  },
  {
    key: "warren_county_absentee_owners",
    label: "Warren County Absentee Owners",
    description: "Official Warren County parcel records filtered into live absentee-owner seller leads from the county parcel service.",
    sourceType: "absentee_owner",
  },
  {
    key: "robeson_county_absentee_owners",
    label: "Robeson County Absentee Owners",
    description: "Official Robeson County parcel records filtered into live absentee-owner seller leads from the county parcel service.",
    sourceType: "absentee_owner",
  },
  {
    key: "rockingham_county_absentee_owners",
    label: "Rockingham County Absentee Owners",
    description: "Official Rockingham County parcel records filtered into live absentee-owner seller leads from the county parcel service.",
    sourceType: "absentee_owner",
  },
  {
    key: "orange_county_absentee_owners",
    label: "Orange County Absentee Owners",
    description: "Official Orange County parcel records filtered into live absentee-owner seller leads from the county parcel service.",
    sourceType: "absentee_owner",
  },
  {
    key: "nash_county_absentee_owners",
    label: "Nash County Absentee Owners",
    description: "Official Nash County parcel records filtered into live absentee-owner seller leads from the county parcel service.",
    sourceType: "absentee_owner",
  },
  {
    key: "edgecombe_county_absentee_owners",
    label: "Edgecombe County Absentee Owners",
    description: "Official Edgecombe County parcel records filtered into live absentee-owner seller leads from the county parcel service.",
    sourceType: "absentee_owner",
  },
  {
    key: "ashe_county_absentee_owners",
    label: "Ashe County Absentee Owners",
    description: "Official Ashe County parcel records filtered into live absentee-owner seller leads from the county parcel service.",
    sourceType: "absentee_owner",
  },
  {
    key: "avery_county_absentee_owners",
    label: "Avery County Absentee Owners",
    description: "Official Avery County parcel records filtered into live absentee-owner seller leads from the county parcel service.",
    sourceType: "absentee_owner",
  },
  {
    key: "burke_county_absentee_owners",
    label: "Burke County Absentee Owners",
    description: "Official Burke County parcel records filtered into live absentee-owner seller leads from the county parcel service.",
    sourceType: "absentee_owner",
  },
];

export type SellerScoringWeights = {
  absenteeOwner: number;
  ownedTenPlusYears: number;
  taxDelinquent: number;
  foreclosure: number;
  probate: number;
  vacant: number;
  codeViolation: number;
  highEquity: number;
  multipleProperties: number;
  outOfStateOwner: number;
};

export const DEFAULT_SELLER_SCORING_WEIGHTS: SellerScoringWeights = {
  absenteeOwner: 20,
  ownedTenPlusYears: 15,
  taxDelinquent: 25,
  foreclosure: 30,
  probate: 25,
  vacant: 20,
  codeViolation: 15,
  highEquity: 20,
  multipleProperties: 10,
  outOfStateOwner: 15,
};

export type SellerScoreInput = {
  absenteeOwner?: boolean;
  yearsOwned?: number | null;
  taxDelinquent?: boolean;
  foreclosure?: boolean;
  probate?: boolean;
  vacant?: boolean;
  codeViolation?: boolean;
  estimatedEquity?: number | null;
  assessedValue?: number | null;
  multipleProperties?: boolean;
  outOfStateOwner?: boolean;
};

export type SellerScoreResult = {
  score: number;
  category: "Hot Lead" | "Warm Lead" | "Watchlist" | "Low Priority";
  reasons: string[];
};

export function getSellerLeadCategory(score: number): SellerScoreResult["category"] {
  if (score >= 80) return "Hot Lead";
  if (score >= 60) return "Warm Lead";
  if (score >= 40) return "Watchlist";
  return "Low Priority";
}

export function calculateSellerLeadScore(
  input: SellerScoreInput,
  weights: SellerScoringWeights = DEFAULT_SELLER_SCORING_WEIGHTS,
): SellerScoreResult {
  const factors: Array<[boolean, number, string]> = [
    [Boolean(input.absenteeOwner), weights.absenteeOwner, "Absentee owner"],
    [(input.yearsOwned ?? 0) >= 10, weights.ownedTenPlusYears, "Owned for 10+ years"],
    [Boolean(input.taxDelinquent), weights.taxDelinquent, "Tax delinquency detected"],
    [Boolean(input.foreclosure), weights.foreclosure, "Foreclosure indicator"],
    [Boolean(input.probate), weights.probate, "Probate indicator"],
    [Boolean(input.vacant), weights.vacant, "Vacancy indicator"],
    [Boolean(input.codeViolation), weights.codeViolation, "Code violation detected"],
    [
      Boolean(
        input.estimatedEquity &&
          input.assessedValue &&
          input.assessedValue > 0 &&
          input.estimatedEquity / input.assessedValue >= 0.5,
      ),
      weights.highEquity,
      "High estimated equity",
    ],
    [Boolean(input.multipleProperties), weights.multipleProperties, "Repeat owner / multiple properties"],
    [Boolean(input.outOfStateOwner), weights.outOfStateOwner, "Out-of-state owner"],
  ];

  const reasons = factors.filter(([active]) => active).map(([, points, reason]) => `${reason} (+${points})`);
  const score = Math.min(100, factors.reduce((total, [active, points]) => total + (active ? points : 0), 0));

  return { score, category: getSellerLeadCategory(score), reasons };
}

export function recommendedSellerAction(score: number, reasons: string[]) {
  if (score >= 80) return "Prioritize skip trace and direct owner outreach within 24 hours.";
  if (reasons.some((reason) => /foreclosure|probate|tax delinquency/i.test(reason))) {
    return "Review source documents, confirm distress signal, then prepare a sensitive contact sequence.";
  }
  if (score >= 60) return "Validate ownership and equity, then move to Contact Ready.";
  if (score >= 40) return "Add to watchlist and monitor for new distress signals.";
  return "Keep archived as low priority until a stronger motivation signal appears.";
}

export function parseSellerCsv(csv: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  const [headers = [], ...dataRows] = rows;

  return dataRows.map((values) =>
    Object.fromEntries(headers.map((header, index) => [header.trim().toLowerCase(), values[index] ?? ""])),
  );
}

export function sellerCsvTemplate() {
  return [
    "property_address,parcel_id,county,city,zip_code,property_type,assessed_value,last_sale_date,last_sale_price,owner_name,owner_mailing_address,owner_occupancy_status,tax_delinquent,foreclosure,probate,vacant,code_violation,years_owned,estimated_equity,source_name",
    "421 Example Ave,123-456,Forsyth,Winston-Salem,27101,Single Family,185000,2011-05-12,82000,Jordan Example,PO Box 77 Charlotte NC 28201,Absentee,true,false,false,true,false,15,118000,County Tax Records",
  ].join("\n");
}
