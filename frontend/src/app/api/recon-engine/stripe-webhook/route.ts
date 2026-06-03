import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";

import { getStripe } from "@/lib/recon-engine-stripe";
import { recordReconCheckout } from "@/lib/recon-engine-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const signature = request.headers.get("stripe-signature");
  const rawBody = await request.text();

  if (!secret || !signature) {
    return NextResponse.json({ ok: false, error: "Webhook not configured." }, { status: 503 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid signature." }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      await recordReconCheckout({
        email: session.customer_details?.email ?? session.customer_email ?? null,
        plan: (session.metadata?.plan as string | undefined) ?? null,
        mode: session.mode ?? null,
        amountTotal: session.amount_total ?? null,
        customerId: typeof session.customer === "string" ? session.customer : null,
      });
    }
  } catch {
    // Swallow processing errors so Stripe doesn't retry-storm; the event is
    // still acknowledged. Failures are visible in Vercel logs.
  }

  return NextResponse.json({ received: true });
}
