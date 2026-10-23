/** Geography is evidence: never infer a state or use arbitrary city text as a county. */
const STATE_NAMES: Record<string, string> = {
  alabama:"AL",alaska:"AK",arizona:"AZ",arkansas:"AR",california:"CA",colorado:"CO",connecticut:"CT",
  delaware:"DE","district of columbia":"DC",florida:"FL",georgia:"GA",hawaii:"HI",idaho:"ID",illinois:"IL",
  indiana:"IN",iowa:"IA",kansas:"KS",kentucky:"KY",louisiana:"LA",maine:"ME",maryland:"MD",massachusetts:"MA",
  michigan:"MI",minnesota:"MN",mississippi:"MS",missouri:"MO",montana:"MT",nebraska:"NE",nevada:"NV",
  "new hampshire":"NH","new jersey":"NJ","new mexico":"NM","new york":"NY","north carolina":"NC",
  "north dakota":"ND",ohio:"OH",oklahoma:"OK",oregon:"OR",pennsylvania:"PA","rhode island":"RI",
  "south carolina":"SC","south dakota":"SD",tennessee:"TN",texas:"TX",utah:"UT",vermont:"VT",virginia:"VA",
  washington:"WA","west virginia":"WV",wisconsin:"WI",wyoming:"WY"
};
const CODES = new Set(Object.values(STATE_NAMES));
export function normalizeBuyerState(value?: string | null): string | null {
  const text = (value ?? "").trim().replace(/\s+/g," ");
  return STATE_NAMES[text.toLowerCase()] ?? (CODES.has(text.toUpperCase()) ? text.toUpperCase() : null);
}
export function buyerStateAliases(value?: string | null): string[] {
  const code=normalizeBuyerState(value);
  if (!code) return [];
  const name=Object.entries(STATE_NAMES).find(([, stateCode]) => stateCode === code)?.[0];
  return name ? [code,name] : [code];
}
export function normalizeCountyName(value?: string | null): string {
  const text = (value ?? "").trim().replace(/\s+county$/i,"").trim().replace(/\s+/g," ").toLowerCase();
  return /^[a-z][a-z .'-]*$/.test(text) && !["unknown","unresolved","none","na","n a","county","not captured","not entered","tbd","pending","unverified"].includes(text) ? text : "";
}
// Only the reviewed, unambiguous Greenville NC mapping is inferred here.
// Multi-county cities (including High Point) require explicit county evidence.
const NC_CITY_TO_COUNTY: Record<string, string> = { greenville:"Pitt" };
export function inferNcCountyFromCity(city?: string | null, state?: string | null): string | null {
  return normalizeBuyerState(state) === "NC" ? NC_CITY_TO_COUNTY[(city ?? "").toLowerCase().replace(/[^a-z]/g,"")] ?? null : null;
}
export function resolveBuyerCounty(county?: string | null, city?: string | null, state?: string | null) {
  const display = normalizeCountyName(county) ? county!.trim() : inferNcCountyFromCity(city,state);
  return { core:normalizeCountyName(display), display:display ?? null };
}
export function buyerGeographyMatches(county: string | null | undefined, state: string | null | undefined, expectedCounty: string, expectedState: string) {
  const countyCore=normalizeCountyName(expectedCounty), stateCode=normalizeBuyerState(expectedState);
  return Boolean(countyCore && stateCode) && normalizeCountyName(county) === countyCore && normalizeBuyerState(state) === stateCode;
}
/** Kept for real PostgREST callers; the restricted capability client uses exact ilike reads. */
export function buyerCountyFilter(county: string): string {
  const core=normalizeCountyName(county);
  if (!core) throw new Error("Buyer county not evaluated");
  return "county.ilike."+JSON.stringify(core)+",county.ilike."+JSON.stringify(core+" County");
}
export function stateFromAddress(value?: string | null): string | null {
  const match=(value ?? "").match(/,\s*([A-Za-z]{2})(?:\s*,?\s*\d{5}(?:-\d{4})?)?\s*$/);
  return normalizeBuyerState(match?.[1]);
}

