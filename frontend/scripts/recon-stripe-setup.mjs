/**
 * One-time Stripe setup for Blackspire Recon Engine.
 *
 * Creates the products + prices for the 3 subscription plans and the
 * pay-as-you-go unlock, then prints the env lines to paste into Vercel.
 *
 * Usage (from frontend/):
 *   STRIPE_SECRET_KEY=sk_live_or_test_xxx node scripts/recon-stripe-setup.mjs
 *
 * Safe to re-run: it looks up existing products by name before creating.
 */
import Stripe from "stripe";

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("Missing STRIPE_SECRET_KEY env var. Aborting.");
  process.exit(1);
}
const stripe = new Stripe(key);

const PLANS = [
  { env: "STRIPE_PRICE_SCOUT", name: "Recon Engine — Scout", amount: 3000, recurring: true },
  { env: "STRIPE_PRICE_OPERATOR", name: "Recon Engine — Operator", amount: 6000, recurring: true },
  { env: "STRIPE_PRICE_COMMANDER", name: "Recon Engine — Commander", amount: 10000, recurring: true },
  { env: "STRIPE_PRICE_PAYG", name: "Recon Engine — Opportunity Unlock", amount: 3000, recurring: false },
];

async function findOrCreateProduct(name) {
  const existing = await stripe.products.search({ query: `name:'${name}' AND active:'true'` });
  if (existing.data[0]) return existing.data[0];
  return stripe.products.create({ name });
}

async function ensurePrice(product, amount, recurring) {
  const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
  const match = prices.data.find(
    (p) =>
      p.unit_amount === amount &&
      p.currency === "usd" &&
      (recurring ? p.recurring?.interval === "month" : !p.recurring),
  );
  if (match) return match;
  return stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: amount,
    ...(recurring ? { recurring: { interval: "month" } } : {}),
  });
}

const lines = [];
for (const plan of PLANS) {
  const product = await findOrCreateProduct(plan.name);
  const price = await ensurePrice(product, plan.amount, plan.recurring);
  lines.push(`${plan.env}=${price.id}`);
  console.log(`✓ ${plan.name} -> ${price.id}`);
}

console.log("\nAdd these to your Vercel environment variables:\n");
console.log(lines.join("\n"));
console.log("\nAlso set STRIPE_SECRET_KEY and (after creating the webhook) STRIPE_WEBHOOK_SECRET.");
