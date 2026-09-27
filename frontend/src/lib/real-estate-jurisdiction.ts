export const REAL_ESTATE_EXPANSION_STATES = ["NC", "VA", "SC", "TN"] as const;

export type RealEstateExpansionState = (typeof REAL_ESTATE_EXPANSION_STATES)[number];

const CITY_TO_COUNTY_BY_STATE: Record<string, Record<string, string>> = {
  NC: {
    charlotte: "Mecklenburg",
    greensboro: "Guilford",
    winstonsalem: "Forsyth",
    raleigh: "Wake",
    durham: "Durham",
    fayetteville: "Cumberland",
    cary: "Wake",
    wilmington: "New Hanover",
    highpoint: "Guilford",
    concord: "Cabarrus",
    gastonia: "Gaston",
    asheville: "Buncombe",
    greenville: "Pitt",
    jacksonville: "Onslow",
    chapelhill: "Orange",
    burlington: "Alamance",
    huntersville: "Mecklenburg",
    rockymount: "Nash",
    kannapolis: "Cabarrus",
    statesville: "Iredell",
    monroe: "Union",
    apex: "Wake",
    wakeforest: "Wake",
    hickory: "Catawba",
    goldsboro: "Wayne",
    mooresville: "Iredell",
    newbern: "Craven",
    salisbury: "Rowan",
    sanford: "Lee",
    garner: "Wake",
    thomasville: "Davidson",
    lexington: "Davidson",
    kernersville: "Forsyth",
  },
};

export function normalizeUsStateCode(state?: string | null): string {
  const normalized = (state ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : "";
}

function normalizeCityKey(city?: string | null): string {
  return (city ?? "").toLowerCase().replace(/[^a-z]/g, "");
}

export function inferCountyFromCity(state?: string | null, city?: string | null): string | null {
  const stateCode = normalizeUsStateCode(state);
  const cityKey = normalizeCityKey(city);
  if (!stateCode || !cityKey) return null;
  return CITY_TO_COUNTY_BY_STATE[stateCode]?.[cityKey] ?? null;
}

export function inferNcCountyFromCity(city?: string | null): string | null {
  return inferCountyFromCity("NC", city);
}
