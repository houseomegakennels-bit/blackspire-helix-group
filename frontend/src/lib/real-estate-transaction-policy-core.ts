export type TransactionReadiness = "blocked" | "research" | "pilot" | "ready";

export type TransactionPolicyCoreInput = {
  state?: string | null;
  marketKey?: string | null;
  transactionReadiness?: TransactionReadiness | null;
  action: string;
};

export type TransactionPolicyCoreDecision = {
  allowed: boolean;
  state: string | null;
  marketKey: string | null;
  reason: string;
};

function normalizeState(state?: string | null) {
  const normalized = (state ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : "";
}

export function evaluateTransactionPolicyCore(
  input: TransactionPolicyCoreInput,
): TransactionPolicyCoreDecision {
  const state = normalizeState(input.state);
  if (!state) {
    return {
      allowed: false,
      state: null,
      marketKey: null,
      reason: "Property state is unresolved. Resolve jurisdiction before external transaction actions.",
    };
  }

  if (state === "NC") {
    return {
      allowed: true,
      state,
      marketKey: null,
      reason: "North Carolina remains on the existing transaction-control path.",
    };
  }

  if (!input.marketKey) {
    return {
      allowed: false,
      state,
      marketKey: null,
      reason: `${state} jurisdiction is not an approved Blackspire transaction market.`,
    };
  }

  if (input.transactionReadiness !== "ready") {
    return {
      allowed: false,
      state,
      marketKey: input.marketKey,
      reason: `${input.marketKey} is ${input.transactionReadiness ?? "blocked"} for transaction actions.`,
    };
  }

  return {
    allowed: true,
    state,
    marketKey: input.marketKey,
    reason: `${input.marketKey} is transaction-ready for ${input.action}.`,
  };
}
