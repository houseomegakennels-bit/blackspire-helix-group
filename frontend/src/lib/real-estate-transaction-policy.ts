import { getRealEstateMarketProfile } from "@/lib/real-estate-market-registry";
import { normalizeUsStateCode } from "@/lib/real-estate-jurisdiction";
import {
  evaluateTransactionPolicyCore,
  type TransactionPolicyCoreDecision,
} from "@/lib/real-estate-transaction-policy-core";

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

export type RealEstateTransactionPolicyDecision = TransactionPolicyCoreDecision;

export function evaluateRealEstateTransactionPolicy(
  input: RealEstateTransactionPolicyInput,
): RealEstateTransactionPolicyDecision {
  const state = normalizeUsStateCode(input.state);
  const jurisdictionName = input.county?.trim() || input.city?.trim() || "";
  const market = state && state !== "NC" && jurisdictionName
    ? getRealEstateMarketProfile(state, jurisdictionName)
    : null;

  return evaluateTransactionPolicyCore({
    state,
    marketKey: market?.key ?? null,
    transactionReadiness: market?.transactionReadiness ?? null,
    action: input.action,
  });
}
