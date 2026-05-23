/**
 * Ember Halo — Payment Routes
 * Creates PaymentIntents for standard packages.
 * Custom/manual quotes use a separate admin-only payment link route.
 * All prices verified from backend before payment creation — never trust frontend price.
 */

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-12-18.accel' });
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface CreatePaymentIntentRequest {
  order_id: string;
  fulfillment_type: 'pickup' | 'delivery';
}

export interface CreatePaymentIntentResponse {
  client_secret: string;
  payment_intent_id: string;
  amount: number;
  currency: string;
}

/** Step 1: Verify price from backend, Step 2: Create PaymentIntent against connected account */
export async function createPaymentIntent(
  req: CreatePaymentIntentRequest
): Promise<CreatePaymentIntentResponse> {
  // 1. Fetch the order and its package pricing from backend — never trust frontend
  const { data: order, error: orderError } = await supabase
    .schema('ember_halo')
    .from('orders')
    .select(`
      id, admin_id, final_price, fulfillment_type, status, is_custom_quote,
      package_id, special_package_id,
      admins!inner(stripe_account_id, stripe_onboarded)
    `)
    .eq('id', req.order_id)
    .single();

  if (orderError || !order) {
    throw new Error(`Order not found: ${req.order_id}`);
  }

  if (order.status !== 'pending_payment') {
    throw new Error(`Order ${req.order_id} is not in pending_payment state`);
  }

  if (order.is_custom_quote) {
    throw new Error('Custom quote orders require admin-approved payment link');
  }

  const admin = order.admins as { stripe_account_id: string; stripe_onboarded: boolean };

  if (!admin.stripe_account_id || !admin.stripe_onboarded) {
    throw new Error('Admin Stripe account not set up');
  }

  // 2. Verify current price from the package record — never use the stored final_price blindly
  const verifiedPrice = await verifyCurrentPrice(
    order.package_id,
    order.special_package_id,
    req.fulfillment_type
  );

  if (Math.abs(verifiedPrice - Number(order.final_price)) > 0.01) {
    // Price changed since quote — update order and surface to customer
    await supabase
      .schema('ember_halo')
      .from('orders')
      .update({
        final_price: verifiedPrice,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.order_id);
  }

  const amountCents = Math.round(verifiedPrice * 100);

  // 3. Create PaymentIntent as destination charge to admin's connected account
  const intent = await stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    payment_method_types: ['card', 'cashapp'],
    metadata: {
      order_id: req.order_id,
      admin_id: order.admin_id,
      fulfillment_type: req.fulfillment_type,
    },
    transfer_data: {
      destination: admin.stripe_account_id,
    },
  });

  // 4. Upsert payment record
  await supabase
    .schema('ember_halo')
    .from('payments')
    .upsert({
      order_id: req.order_id,
      admin_id: order.admin_id,
      stripe_payment_id: intent.id,
      stripe_account_id: admin.stripe_account_id,
      amount: verifiedPrice,
      currency: 'usd',
      status: 'pending',
      webhook_confirmed: false,
    });

  return {
    client_secret: intent.client_secret!,
    payment_intent_id: intent.id,
    amount: verifiedPrice,
    currency: 'usd',
  };
}

/** Admin-only: create a payment link for custom/manual quotes */
export async function createManualPaymentLink(adminId: string, params: {
  order_id: string;
  amount: number;
  description: string;
}): Promise<{ url: string; payment_link_id: string }> {
  const { data: admin } = await supabase
    .schema('ember_halo')
    .from('admins')
    .select('stripe_account_id, stripe_onboarded')
    .eq('id', adminId)
    .single();

  if (!admin?.stripe_account_id || !admin.stripe_onboarded) {
    throw new Error('Admin Stripe account not set up');
  }

  const price = await stripe.prices.create(
    {
      unit_amount: Math.round(params.amount * 100),
      currency: 'usd',
      product_data: { name: params.description },
    },
    { stripeAccount: admin.stripe_account_id }
  );

  const link = await stripe.paymentLinks.create(
    {
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: { order_id: params.order_id, admin_id: adminId },
      after_completion: { type: 'redirect', redirect: { url: `${process.env.APP_URL}/booking-confirmed` } },
    },
    { stripeAccount: admin.stripe_account_id }
  );

  await supabase
    .schema('ember_halo')
    .from('payments')
    .insert({
      order_id: params.order_id,
      admin_id: adminId,
      stripe_payment_id: link.id,
      stripe_account_id: admin.stripe_account_id,
      amount: params.amount,
      currency: 'usd',
      status: 'pending',
      is_manual_link: true,
      webhook_confirmed: false,
    });

  return { url: link.url, payment_link_id: link.id };
}

/** Stripe Connect: generate onboarding link for a new admin */
export async function createConnectOnboardingLink(adminId: string): Promise<string> {
  const { data: admin } = await supabase
    .schema('ember_halo')
    .from('admins')
    .select('stripe_account_id, legal_email')
    .eq('id', adminId)
    .single();

  if (!admin) throw new Error('Admin not found');

  let accountId = admin.stripe_account_id;

  if (!accountId) {
    const account = await stripe.accounts.create({
      type: 'express',
      email: admin.legal_email,
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
      metadata: { admin_id: adminId },
    });

    accountId = account.id;

    await supabase
      .schema('ember_halo')
      .from('admins')
      .update({ stripe_account_id: accountId, updated_at: new Date().toISOString() })
      .eq('id', adminId);
  }

  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${process.env.APP_URL}/admin/stripe/onboard?retry=true`,
    return_url: `${process.env.APP_URL}/admin/stripe/onboard/complete`,
    type: 'account_onboarding',
  });

  return link.url;
}

async function verifyCurrentPrice(
  packageId: string | null,
  specialPackageId: string | null,
  fulfillmentType: 'pickup' | 'delivery'
): Promise<number> {
  if (packageId) {
    const { data } = await supabase
      .schema('ember_halo')
      .from('packages')
      .select('pickup_price, delivery_price, is_active')
      .eq('id', packageId)
      .single();

    if (!data || !data.is_active) throw new Error('Package not available');
    return fulfillmentType === 'pickup' ? Number(data.pickup_price) : Number(data.delivery_price);
  }

  if (specialPackageId) {
    const { data } = await supabase
      .schema('ember_halo')
      .from('special_packages')
      .select('pickup_price, delivery_price, is_active, requires_admin_approval')
      .eq('id', specialPackageId)
      .single();

    if (!data || !data.is_active) throw new Error('Special package not available');
    if (data.requires_admin_approval) throw new Error('Special package requires admin approval');
    return fulfillmentType === 'pickup'
      ? Number(data.pickup_price)
      : Number(data.delivery_price);
  }

  throw new Error('No package or special package specified');
}
