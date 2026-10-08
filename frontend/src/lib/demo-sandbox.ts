import { analyzeInvestment, parseInvestmentAmount, type InvestmentStrategy } from "./investment-analysis";

export type DemoLead = {
  id: string; name: string; city: string;
  asking: number | null; arv: number | null; repairs: number | null;
  strategy?: InvestmentStrategy; closingCosts?: number | null; holdingCosts?: number | null;
  profitTarget?: number | null; assignmentFee?: number | null;
  monthlyRent?: number | null; monthlyExpenses?: number | null; monthlyDebtService?: number | null;
  researchNotes?: string; researchSource?: string; researchAsOf?: string;
  stage: string; note: string;
};
export type DemoTask = { id: string; text: string; done: boolean; leadId?: string; owner?: string; dueDate?: string };
export type DemoState = { leads: DemoLead[]; tasks: DemoTask[]; activity: string[] };
export const demoStages = ["Intake", "Qualified", "Analyzing", "Buyer matching", "Under contract", "Closed"];

export function seedDemoState(): DemoState {
  return {
    leads: [{
      id: "example-property", name: "Sample property — Oak Lane", city: "Winston-Salem",
      asking: 125000, arv: 210000, repairs: 30000, closingCosts: 0, holdingCosts: 0,
      profitTarget: 63000, assignmentFee: 0, strategy: "assignment", stage: "Intake",
      note: "Fictional training record. The sample reserves $63,000 for buyer profit. Zero cost inputs are sample assumptions, not researched costs.",
    }],
    tasks: [{ id: "example-task", text: "Review the sample property's assumptions", done: false, leadId: "example-property" }],
    activity: ["Workspace created with clearly labeled fictional training records."],
  };
}

export function analyzeDemoDeal(lead: DemoLead) {
  // Legacy practice records preserve their old 30% reserve; all new records require explicit assumptions.
  const legacy = lead.strategy == null;
  const result = analyzeInvestment({
    strategy: lead.strategy ?? "assignment", purchasePrice: lead.asking, resaleValue: lead.arv,
    repairs: lead.repairs, closingCosts: legacy ? 0 : lead.closingCosts ?? null,
    holdingCosts: legacy ? 0 : lead.holdingCosts ?? null,
    profitTarget: legacy && lead.arv != null ? lead.arv * 0.3 : lead.profitTarget ?? null,
    assignmentFee: legacy ? 0 : lead.assignmentFee ?? null,
    monthlyRent: lead.monthlyRent, monthlyExpenses: lead.monthlyExpenses, monthlyDebtService: lead.monthlyDebtService,
  });
  return { ...result, mao: result.ceiling, spread: result.askingGap, legacy };
}

function text(value: unknown, max = 200) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
const amountKeys = ["asking", "arv", "repairs", "closingCosts", "holdingCosts", "profitTarget", "assignmentFee", "monthlyRent", "monthlyExpenses", "monthlyDebtService"] as const;
function strategy(value: unknown): InvestmentStrategy {
  if (!["flip", "rental", "assignment"].includes(String(value))) throw new Error("Choose buy/flip, buy/rent, or assignment.");
  return value as InvestmentStrategy;
}
function updateAmounts(lead: DemoLead, body: Record<string, unknown>) {
  for (const key of amountKeys) if (Object.prototype.hasOwnProperty.call(body, key)) lead[key] = parseInvestmentAmount(body[key]);
}
export function applyDemoAction(current: DemoState, body: Record<string, unknown>, id: string): DemoState {
  const state = structuredClone(current);
  const log = (message: string) => { state.activity = [message, ...state.activity].slice(0, 100); };
  if (body.action === "reset") return seedDemoState();
  if (body.action === "addLead") {
    if (state.leads.length >= 100) throw new Error("This demo supports up to 100 properties.");
    const name = text(body.name), city = text(body.city);
    if (!name || !city) throw new Error("Property address/label and city are required.");
    const lead: DemoLead = { id, name, city, asking: null, arv: null, repairs: null, strategy: strategy(body.strategy ?? "flip"), stage: "Intake", note: "" };
    updateAmounts(lead, body); state.leads.push(lead); log("Added " + name + "; unknown numbers remain blank.");
  } else if (["updateLead", "runPipeline", "deleteLead"].includes(String(body.action))) {
    const lead = state.leads.find(x => x.id === body.id);
    if (!lead) throw new Error("Property not found in your workspace.");
    if (body.action === "deleteLead") {
      state.leads = state.leads.filter(x => x.id !== lead.id);
      state.tasks = state.tasks.filter(x => x.leadId !== lead.id);
      log("Removed " + lead.name);
    } else if (body.action === "runPipeline") {
      const analysis = analyzeDemoDeal(lead);
      // Analysis never advances an existing transaction backwards or implies a signed agreement.
      if (["Intake", "Qualified", "Analyzing", "Buyer matching"].includes(lead.stage)) {
        lead.stage = analysis.complete && analysis.fitsTarget && analysis.strategy === "assignment" ? "Buyer matching" : "Analyzing";
      }
      const taskText = !analysis.complete
        ? "Collect missing numbers for " + lead.name + ": " + analysis.missing.join(", ")
        : analysis.fitsTarget ? "Review research and purchase terms for " + lead.name : "Review price and cost assumptions for " + lead.name;
      const existing = state.tasks.find(t => t.leadId === lead.id && !t.done && t.text === taskText);
      if (!existing) {
        if (state.tasks.length >= 100) throw new Error("Complete tasks before adding more.");
        state.tasks.push({ id, leadId: lead.id, text: taskText, done: false });
      }
      log("Reviewed numbers for " + lead.name + ". " + (analysis.complete ? "Calculation complete; research and terms still need review." : "Unknown figures remain. No valuation or contract status is confirmed."));
    } else {
      if (body.stage != null) {
        if (!demoStages.includes(String(body.stage))) throw new Error("Choose a valid stage.");
        lead.stage = String(body.stage);
      }
      if (body.strategy != null) lead.strategy = strategy(body.strategy);
      if (body.note != null) lead.note = text(body.note, 2000);
      for (const key of ["researchNotes", "researchSource", "researchAsOf"] as const) {
        if (body[key] != null) lead[key] = text(body[key], key === "researchNotes" ? 3000 : 500);
      }
      updateAmounts(lead, body); log("Updated " + lead.name);
    }
  } else if (body.action === "addTask") {
    const task = text(body.text, 500);
    if (!task) throw new Error("Enter a follow-up.");
    if (state.tasks.length >= 100) throw new Error("This demo supports up to 100 tasks.");
    const leadId = text(body.leadId);
    if (leadId && !state.leads.some(l => l.id === leadId)) throw new Error("Choose a property in this workspace.");
    state.tasks.push({ id, text: task, done: false, leadId: leadId || undefined, owner: text(body.owner), dueDate: text(body.dueDate) });
    log("Added follow-up");
  } else if (body.action === "toggleTask") {
    const task = state.tasks.find(x => x.id === body.id);
    if (!task) throw new Error("Follow-up not found.");
    task.done = !task.done; log(task.done ? "Completed follow-up" : "Reopened follow-up");
  } else throw new Error("Unsupported demonstration action.");
  return state;
}
