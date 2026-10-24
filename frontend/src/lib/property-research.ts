import { analyzeInvestment, parseInvestmentAmount, type InvestmentInputs } from "@/lib/investment-analysis";

export type ResearchSource = { url: string; documentId: string; accessedOn: string };
export type ComparableEvidence = {
  id: string; address: string; status: "listed" | "sold" | "unknown";
  price: number | null; date: string; squareFeet: number | null;
  source: ResearchSource; notes: string; share: boolean;
};
export type TitleEvidence = {
  id: string; kind: "recorded_mortgage" | "payoff_statement" | "lien" | "title_report";
  amount: number | null; amountState: "unknown" | "documented";
  asOf: string; source: ResearchSource; reviewer: string;
  status: "unreviewed" | "reviewed"; notes: string;
};
export type ResearchScenario = { label: "low" | "base" | "high"; inputs: InvestmentInputs };
export type PropertyResearch = {
  version: 1; comps: ComparableEvidence[]; titleEvidence: TitleEvidence[];
  scenarios: ResearchScenario[]; privateNotes: string;
  duplicateReview: { candidateIds: string[]; decision: "not_reviewed" | "distinct" | "possible_duplicate"; notes: string };
};
export type ResearchSnapshot = { revision: number; updatedAt: string | null; research: PropertyResearch };
export type PacketAudience = "buyer" | "seller" | "jv" | "title";

export function emptyPropertyResearch(): PropertyResearch {
  return { version: 1, comps: [], titleEvidence: [], scenarios: [], privateNotes: "", duplicateReview: { candidateIds: [], decision: "not_reviewed", notes: "" } };
}

export function researchMoney(value: number | null): string {
  return value == null ? "Unknown" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function text(value: unknown, max = 2000): string {
  if (typeof value !== "string" || value.length > max) throw new Error("Research text is invalid or too long.");
  return value.trim();
}
function date(value: unknown): string {
  const result = text(value, 10);
  const parsed = new Date(result + "T00:00:00Z");
  if (result && (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result)) throw new Error("Use a valid calendar date.");
  return result;
}
export function safeResearchUrl(value: unknown): string {
  const result = text(value, 2048);
  if (!result) return "";
  let parsed: URL;
  try { parsed = new URL(result); } catch { throw new Error("Use a complete HTTPS source link."); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("Use a complete HTTPS source link.");
  return parsed.href;
}
function source(value: unknown): ResearchSource {
  if (!value || typeof value !== "object") throw new Error("Add the research source.");
  const row = value as Record<string, unknown>;
  return { url: safeResearchUrl(row.url), documentId: text(row.documentId, 128), accessedOn: date(row.accessedOn) };
}
function member<T extends string>(value: unknown, options: readonly T[]): T {
  if (typeof value !== "string" || !options.includes(value as T)) throw new Error("Choose a valid research status.");
  return value as T;
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error("Too many research rows.");
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Research row is invalid.");
  return value as Record<string, unknown>;
}

/** Rebuild a bounded, known-fields record. Extra input cannot mark title clear or enter a packet. */
export function validatePropertyResearch(value: unknown): PropertyResearch {
  const row = object(value);
  if (row.version !== 1) throw new Error("Unsupported research version.");
  const comps = array(row.comps, 30).map(value => {
    const item = object(value);
    const result: ComparableEvidence = { id: text(item.id, 80), address: text(item.address, 300), status: member(item.status, ["listed", "sold", "unknown"]), price: parseInvestmentAmount(item.price), date: date(item.date), squareFeet: parseInvestmentAmount(item.squareFeet), source: source(item.source), notes: text(item.notes), share: item.share === true };
    if (!result.id || !result.address) throw new Error("Comparable address and ID are required.");
    if (result.status === "sold" && (!result.date || result.price == null || (!result.source.url && !result.source.documentId))) throw new Error("Sold comparables require a sale date, sale price and source.");
    if (result.share && (!result.source.url || !result.source.accessedOn)) throw new Error("Shared comparables require a source link and access date.");
    return result;
  });
  const titleEvidence = array(row.titleEvidence, 30).map(value => {
    const item = object(value);
    const amountState = member(item.amountState, ["unknown", "documented"]);
    const result: TitleEvidence = { id: text(item.id, 80), kind: member(item.kind, ["recorded_mortgage", "payoff_statement", "lien", "title_report"]), amount: amountState === "unknown" ? null : parseInvestmentAmount(item.amount), amountState, asOf: date(item.asOf), source: source(item.source), reviewer: text(item.reviewer, 160), status: member(item.status, ["unreviewed", "reviewed"]), notes: text(item.notes) };
    if (!result.id) throw new Error("Evidence ID is required.");
    if (amountState === "documented" && (result.amount == null || !result.asOf || (!result.source.url && !result.source.documentId))) throw new Error("A documented amount requires an amount, as-of date and source. Zero must be supported too.");
    if (result.status === "reviewed" && (!result.reviewer || (!result.source.url && !result.source.documentId))) throw new Error("Reviewed evidence requires a reviewer and source.");
    return result;
  });
  for (const items of [comps, titleEvidence]) if (new Set(items.map(item => item.id)).size !== items.length) throw new Error("Research row IDs must be unique.");
  const scenarios = array(row.scenarios, 3).map(value => {
    const scenario = object(value), input = object(scenario.inputs);
    const result: ResearchScenario = { label: member(scenario.label, ["low", "base", "high"]), inputs: {
      strategy: member(input.strategy ?? "assignment", ["assignment", "flip", "rental"] as const),
      purchasePrice: parseInvestmentAmount(input.purchasePrice), resaleValue: parseInvestmentAmount(input.resaleValue), repairs: parseInvestmentAmount(input.repairs), closingCosts: parseInvestmentAmount(input.closingCosts), holdingCosts: parseInvestmentAmount(input.holdingCosts), profitTarget: parseInvestmentAmount(input.profitTarget), assignmentFee: parseInvestmentAmount(input.assignmentFee), monthlyRent: parseInvestmentAmount(input.monthlyRent), monthlyExpenses: parseInvestmentAmount(input.monthlyExpenses), monthlyDebtService: parseInvestmentAmount(input.monthlyDebtService),
    } };
    analyzeInvestment(result.inputs);
    return result;
  });
  if (new Set(scenarios.map(item => item.label)).size !== scenarios.length) throw new Error("Use one row per low, base and high scenario.");
  const duplicate = object(row.duplicateReview);
  return { version: 1, comps, titleEvidence, scenarios, privateNotes: text(row.privateNotes, 10000), duplicateReview: { candidateIds: array(duplicate.candidateIds, 20).map(value => text(value, 80)), decision: member(duplicate.decision, ["not_reviewed", "distinct", "possible_duplicate"]), notes: text(duplicate.notes) } };
}

export function compareResearchScenarios(research: PropertyResearch) {
  return (["low", "base", "high"] as const).map(label => {
    const scenario = research.scenarios.find(item => item.label === label);
    try { return { label, analysis: scenario ? analyzeInvestment(scenario.inputs) : null, error: null }; }
    catch { return { label, analysis: null, error: "Review invalid amounts. Inputs must be zero or positive; negative calculated results remain visible." }; }
  });
}

/** This preview has no free-text source capable of carrying private operator notes. */
export function buildRecipientPacketPreview(address: string, audience: PacketAudience, research: PropertyResearch) {
  const comps = research.comps.filter(item => item.share && item.source.url).map(item => ({ address: item.address, status: item.status, price: item.price, date: item.date, squareFeet: item.squareFeet, sourceUrl: item.source.url, sourceAccessedOn: item.source.accessedOn }));
  const title = audience === "title" ? research.titleEvidence.filter(item => item.status === "reviewed").map(item => ({ kind: item.kind, amount: item.amount, amountState: item.amountState, asOf: item.asOf, sourceUrl: item.source.url, sourceDocumentId: item.source.documentId })) : [];
  return { audience, propertyAddress: address, comparableResearch: audience === "seller" ? [] : comps, titleEvidence: title, titleStatus: "Not determined by this research workspace", notice: "Preview only. Verify sources and authority before sharing. No message, offer or signature is sent." };
}
