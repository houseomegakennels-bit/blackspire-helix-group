/**
 * Ember Halo — Stripe Webhook Handler
 * This is the ONLY source of truth for payment status.
 * Never trust frontend redirect success. Only trust these webhook events.
 */

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { upsertVaultFromOrder } from '../routes/vip-vault.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2025-02-24.acacia' });
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // service role bypasses RLS — backend only
);

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET!;

/** Express/Node handler — also works with Hono, Fastify, etc. */
export async function handleStripeWebhook(
  rawBody: Buffer | string,
  signature: string
): Promise<{ status: number; body: string }> {
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, WEBHOOK_SECRET);
  } catch (err) {
    console.error('Stripe webhook signature verification failed:', err);
    return { status: 400, body: 'Webhook signature verification failed' };
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        await handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
        break;

      case 'payment_intent.canceled':
        await handlePaymentCancelled(event.data.object as Stripe.PaymentIntent);
        break;

      case 'account.updated':
        await handleConnectAccountUpdated(event.data.object as Stripe.Account);
        break;

      default:
        // Unhandled event types are fine — log and move on
        console.log(`Unhandled Stripe event: ${event.type}`);
    }

    return { status: 200, body: 'ok' };
  } catch (err) {
    console.error(`Error processing Stripe event ${event.type}:`, err);
    // Return 200 to prevent Stripe from retrying — log separately
    return { status: 200, body: 'processed with error' };
  }
}

async function handlePaymentSucceeded(intent: Stripe.PaymentIntent): Promise<void> {
  const orderId = intent.metadata?.order_id;
  if (!orderId) {
    console.warn('payment_intent.succeeded — no order_id in metadata', intent.id);
    return;
  }

  // 1. Mark payment as confirmed (webhook is the source of truth)
  await supabase
    .schema('ember_halo')
    .from('payments')
    .update({
      status: 'paid',
      webhook_confirmed: true,
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_payment_id', intent.id);

  // 2. Advance order to confirmed
  await supabase
    .schema('ember_halo')
    .from('orders')
    .update({
      status: 'confirmed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId);

  // 3. Create/update scheduling record status
  await supabase
    .schema('ember_halo')
    .from('scheduling_records')
    .update({
      status: 'confirmed',
      payment_status: 'paid',
      updated_at: new Date().toISOString(),
    })
    .eq('order_id', orderId);

  // 4. Log status history
  const { data: record } = await supabase
    .schema('ember_halo')
    .from('scheduling_records')
    .select('id')
    .eq('order_id', orderId)
    .single();

  if (record) {
    await supabase
      .schema('ember_halo')
      .from('scheduling_status_history')
      .insert({
        scheduling_record_id: record.id,
        previous_status: 'pending_payment',
        new_status: 'confirmed',
        note: `Payment confirmed via Stripe webhook. PaymentIntent: ${intent.id}`,
      });
  }

  // 5. Audit log
  await supabase
    .schema('ember_halo')
    .from('audit_logs')
    .insert({
      action: 'payment_confirmed',
      entity_type: 'payment',
      metadata: {
        stripe_payment_id: intent.id,
        order_id: orderId,
        amount: intent.amount,
        payment_method: intent.payment_method_types?.[0],
      },
    });

  // 6. Update VIP vault (fire-and-forget — non-blocking)
  upsertVaultFromOrder(orderId).catch(err =>
    console.error('VIP vault update failed (non-fatal):', err)
  );

  // 7. Trigger n8n booking_confirmed workflow
  await triggerN8nEvent('booking_confirmed', {
    order_id: orderId,
    stripe_payment_id: intent.id,
    amount: intent.amount / 100,
    currency: intent.currency,
  });
}

async function handlePaymentFailed(intent: Stripe.PaymentIntent): Promise<void> {
  const orderId = intent.metadata?.order_id;
  if (!orderId) return;

  await supabase
    .schema('ember_halo')
    .from('payments')
    .update({
      status: 'failed',
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_payment_id', intent.id);

  await supabase
    .schema('ember_halo')
    .from('orders')
    .update({
      status: 'pending_payment',
      updated_at: new Date().toISOString(),
    })
    .eq('id', orderId);

  // Trigger n8n to send graceful AI follow-up + admin alert
  await triggerN8nEvent('payment_failed', {
    order_id: orderId,
    stripe_payment_id: intent.id,
    failure_message: intent.last_payment_error?.message ?? 'Unknown error',
  });
}

async function handlePaymentCancelled(intent: Stripe.PaymentIntent): Promise<void> {
  const orderId = intent.metadata?.order_id;
  if (!orderId) return;

  await supabase
    .schema('ember_halo')
    .from('payments')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_payment_id', intent.id);
}

async function handleConnectAccountUpdated(account: Stripe.Account): Promise<void> {
  const isOnboarded =
    account.details_submitted &&
    account.charges_enabled &&
    account.payouts_enabled;

  await supabase
    .schema('ember_halo')
    .from('admins')
    .update({
      stripe_onboarded: isOnboarded,
      updated_at: new Date().toISOString(),
    })
    .eq('stripe_account_id', account.id);
}

async function triggerN8nEvent(eventType: string, payload: Record<string, unknown>): Promise<void> {
  const n8nWebhookUrl = process.env.N8N_WEBHOOK_BASE_URL;
  if (!n8nWebhookUrl) return;

  try {
    await fetch(`${n8nWebhookUrl}/ember-halo/${eventType}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: eventType, ...payload, timestamp: new Date().toISOString() }),
    });
  } catch (err) {
    console.error(`Failed to trigger n8n event ${eventType}:`, err);
    // Non-fatal — log and continue
  }
}
