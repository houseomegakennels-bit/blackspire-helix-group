import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";

import {
  getPlanMode,
  getPlanPricing,
  getPriceId,
  getStripe,
  isStripeConfigured,
  isValidPlan,
} from "@/lib/recon-engine-stripe";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    if (!isStripeConfigured()) {
      return NextResponse.json(
        { ok: false, error: "Billing is launching soon. Use the free scan and we'll set you up." },
        { status: 503 },
      );
    }

    const body = (await request.json()) as { planId?: string; email?: string };
    if (!isValidPlan(body.planId)) {
      return NextResponse.json({ ok: false, error: "Invalid plan." }, { status: 400 });
    }

    const mode = getPlanMode(body.planId);
    const presetPrice = getPriceId(body.planId);

    // Prefer a configured Price ID; otherwise build the price inline so no
    // setup script / price-ID env vars are needed.
    let lineItem: Stripe.Checkout.SessionCreateParams.LineItem;
    if (presetPrice) {
      lineItem = { price: presetPrice, quantity: 1 };
    } else {
      const pricing = getPlanPricing(body.planId);
      lineItem = {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: pricing.amountCents,
          product_data: { name: pricing.name },
          ...(pricing.interval ? { recurring: { interval: pricing.interval } } : {}),
        },
      };
    }

    const origin = request.headers.get("origin") || new URL(request.url).origin;
    const stripe = getStripe();

    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [lineItem],
      customer_email: body.email?.trim() || undefined,
      allow_promotion_codes: true,
      success_url: `${origin}/recon-engine?checkout=success&plan=${body.planId}`,
      cancel_url: `${origin}/recon-engine?checkout=cancelled#pricing`,
      metadata: { product: "recon-engine", plan: body.planId },
    });

    return NextResponse.json({ ok: true, url: session.url });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Checkout failed." },
      { status: 500 },
    );
  }
}
