import "server-only";

import Stripe from "stripe";

export type ReconPlanId = "scout" | "operator" | "commander" | "payg";

let cached: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured.");
  if (!cached) cached = new Stripe(key);
  return cached;
}

/** Resolve the Stripe Price ID for a plan from env (set after running setup). */
export function getPriceId(plan: ReconPlanId): string | null {
  const map: Record<ReconPlanId, string | undefined> = {
    scout: process.env.STRIPE_PRICE_SCOUT,
    operator: process.env.STRIPE_PRICE_OPERATOR,
    commander: process.env.STRIPE_PRICE_COMMANDER,
    payg: process.env.STRIPE_PRICE_PAYG,
  };
  return map[plan]?.trim() || null;
}

export function getPlanMode(plan: ReconPlanId): "subscription" | "payment" {
  return plan === "payg" ? "payment" : "subscription";
}

export function isValidPlan(value: unknown): value is ReconPlanId {
  return value === "scout" || value === "operator" || value === "commander" || value === "payg";
}

/**
 * Inline plan pricing — checkout creates prices on the fly via `price_data`,
 * so no pre-created Stripe Price IDs or setup script are required.
 */
export type PlanPricing = { name: string; amountCents: number; interval: "month" | null };

const PLAN_PRICING: Record<ReconPlanId, PlanPricing> = {
  scout: { name: "Recon Engine — Scout", amountCents: 3000, interval: "month" },
  operator: { name: "Recon Engine — Operator", amountCents: 6000, interval: "month" },
  commander: { name: "Recon Engine — Commander", amountCents: 10000, interval: "month" },
  payg: { name: "Recon Engine — Opportunity Unlock", amountCents: 3000, interval: null },
};

export function getPlanPricing(plan: ReconPlanId): PlanPricing {
  return PLAN_PRICING[plan];
}
