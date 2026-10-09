/** Client-safe presentation rules; never change the underlying evidence. */
export function readableNextStep(value: string) {
  if (/workflow|dispatch|502|bad gateway/i.test(value)) return "The buyer search needs attention. Open Buyers to check its status before using the results.";
  if (/buyer search.*(launched|created)/i.test(value)) return "Check the buyer search results and confirm each buyer’s criteria before preparing outreach.";
  return value.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "(reference in activity)");
}

export function draftNeedsReview(value: string) {
  return /not entered|not captured|market still resolving|unknown opportunity|workflow trigger|dispatch|bad gateway|<html|[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i.test(value);
}

export function suspectedTestRecord(value: string) {
  return /diagnostic|smoke[- ]?test|smoke investor|smoke@example|buyer@example|proof-test|deal-doc-test|55 Test Loop/i.test(value);
}

export function buyerCandidateLabel(county: string, market: string) {
  const normalize = (value: string) => value.toLowerCase().replace(/\bcounty\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  const wanted = normalize(county);
  const found = normalize(market.split(",")[0]);
  return wanted && wanted === found
    ? "County candidate — verify property type, criteria and funding"
    : "Broader candidate — county fit not established";
}

export function validCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
