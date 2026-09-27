import { getRealEstateMarketProfile } from "@/lib/real-estate-market-registry";
import { normalizeUsStateCode } from "@/lib/real-estate-jurisdiction";

export type RealEstateTransactionAction =
  | "send_deal_email"
  | "generate_contract"
  | "prepare_signature"
  | "publish_buyer_packet";

export type RealEstateTransactionPolicyInput = {
  state?: string | null;
  county?: string | null;
  city?: string | null;
  action: RealEstateTransactionAction;
};

export type RealEstateTransactionPolicyDecision = {
  allowed: boolean;
  state: string | null;
  marketKey: string | null;
  reason: string;
};

export function evaluateRealEstateTransactionPolicy(
  input: RealEstateTransactionPolicyInput,
): RealEstateTransactionPolicyDecision {
  const state = normalizeUsStateCode(input.state);
  if (!state) {
    return {
      allowed: false,
      state: null,
      marketKey: null,
      reason: "Property state is unresolved. Resolve jurisdiction before external transaction actions.",
    };
  }

  // Preserve the existing North Carolina lane while the expansion controls are
  // introduced. NC remains subject to its existing approval/template/outreach gates.
  if (state === "NC") {
    return {
      allowed: true,
      state,
      marketKey: null,
      reason: "North Carolina remains on the existing transaction-control path.",
    };
  }

  const jurisdictionName = input.county?.trim() || input.city?.trim() || "";
  const market = jurisdictionName ? getRealEstateMarketProfile(state, jurisdictionName) : null;
  if (!market) {
    return {
      allowed: false,
      state,
      marketKey: null,
      reason: `${state} jurisdiction is not an approved Blackspire transaction market.`,
    };
  }

  if (market.transactionReadiness !== "ready") {
    return {
      allowed: false,
      state,
      marketKey: market.key,
      reason: `${market.key} is ${market.transactionReadiness} for transaction actions.`,
    };
  }

  return {
    allowed: true,
    state,
    marketKey: market.key,
    reason: `${market.key} is transaction-ready for ${input.action}.`,
  };
}
