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
