export type InvestmentStrategy = "flip" | "rental" | "assignment";
export type InvestmentInputs = {
  strategy?: InvestmentStrategy;
  purchasePrice: number | null;
  resaleValue: number | null;
  repairs: number | null;
  closingCosts: number | null;
  holdingCosts: number | null;
  profitTarget: number | null;
  assignmentFee: number | null;
  monthlyRent?: number | null;
  monthlyExpenses?: number | null;
  monthlyDebtService?: number | null;
};

/** Empty is unknown; a deliberate zero is a known amount. Invalid input is rejected. */
export function parseInvestmentAmount(value: unknown): number | null {
  if (value == null || (typeof value === "string" && value.trim() === "")) return null;
  if (typeof value !== "number" && typeof value !== "string") throw new Error("Enter an amount or leave it unknown.");
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000) {
    throw new Error("Enter an amount between 0 and 100,000,000.");
  }
  return Math.round(amount * 100) / 100;
}

const roundCurrency = (value: number) => Math.round(value * 100) / 100;

export function analyzeInvestment(input: InvestmentInputs) {
  const strategy = input.strategy ?? "assignment";
  if (!["flip", "rental", "assignment"].includes(strategy)) throw new Error("Choose a valid purchase strategy.");
  const fields: Array<[string, number | null | undefined]> = [
    ["Purchase price", input.purchasePrice], ["Repairs", input.repairs],
    ["Closing costs", input.closingCosts],
    ...(strategy === "rental"
      ? [["Monthly rent", input.monthlyRent], ["Monthly operating expenses", input.monthlyExpenses], ["Monthly loan payment", input.monthlyDebtService]] as Array<[string, number | null | undefined]>
      : [["Resale value after repairs", input.resaleValue], ["Holding costs", input.holdingCosts], ["Profit target", input.profitTarget]] as Array<[string, number | null | undefined]>),
    ...(strategy === "assignment" ? [["Assignment fee", input.assignmentFee]] as Array<[string, number | null | undefined]> : []),
  ];
  const missing = fields.filter(([, value]) => value == null).map(([label]) => label);
  for (const [, value] of fields) if (value != null) parseInvestmentAmount(value);
  const complete = missing.length === 0;
  const acquisitionKnown = input.purchasePrice != null && input.repairs != null && input.closingCosts != null;
  const acquisitionCost = acquisitionKnown ? roundCurrency(input.purchasePrice! + input.repairs! + input.closingCosts!) : null;
  const fee = strategy === "assignment" ? input.assignmentFee : 0;
  const ceilingKnown = strategy !== "rental" && [input.resaleValue, input.repairs, input.closingCosts, input.holdingCosts, input.profitTarget, fee].every(value => value != null);
  const ceiling = ceilingKnown
    ? roundCurrency(input.resaleValue! - input.repairs! - input.closingCosts! - input.holdingCosts! - input.profitTarget! - fee!)
    : null;
  const askingGap = ceiling != null && input.purchasePrice != null ? roundCurrency(ceiling - input.purchasePrice) : null;
  const profit = complete && strategy !== "rental"
    ? roundCurrency(input.resaleValue! - acquisitionCost! - input.holdingCosts! - fee!)
    : null;
  const monthlyCashFlow = complete && strategy === "rental"
    ? roundCurrency(input.monthlyRent! - input.monthlyExpenses! - input.monthlyDebtService!)
    : null;
  // This is return on acquisition cost, not leveraged cash-on-cash return.
  const annualReturnOnCost = monthlyCashFlow != null && acquisitionCost != null && acquisitionCost > 0
    ? monthlyCashFlow * 12 / acquisitionCost * 100 : null;
  const fitsTarget = complete && (strategy === "rental" ? monthlyCashFlow! > 0 : askingGap! >= 0);
  return { strategy, complete, missing, acquisitionCost, ceiling, askingGap, profit, monthlyCashFlow, annualReturnOnCost, fitsTarget };
}
