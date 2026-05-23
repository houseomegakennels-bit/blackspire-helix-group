/**
 * Ember Halo — AI Sales Analytics API
 * Upsell performance, conversion rates, chatbot effectiveness, revenue metrics.
 * Admin dashboard analytics tab reads from this.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── OVERVIEW ──────────────────────────────────────────────────

export async function getAnalyticsOverview(adminId: string, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const [conversations, orders, payments, upsells, reviews] = await Promise.all([
    supabase.schema('ember_halo').from('conversations')
      .select('id, nda_accepted, customer_classification, started_at', { count: 'exact' })
      .eq('admin_id', adminId)
      .gte('started_at', since),

    supabase.schema('ember_halo').from('orders')
      .select('id, status, final_price, fulfillment_type, rose_count', { count: 'exact' })
      .eq('admin_id', adminId)
      .gte('created_at', since),

    supabase.schema('ember_halo').from('payments')
      .select('amount, status')
      .eq('admin_id', adminId)
      .eq('status', 'paid')
      .eq('webhook_confirmed', true)
      .gte('created_at', since),

    supabase.schema('ember_halo').from('upsell_events')
      .select('converted, from_rose_count, to_rose_count')
      .eq('admin_id', adminId)
      .gte('recorded_at', since),

    supabase.schema('ember_halo').from('reviews')
      .select('star_rating')
      .eq('admin_id', adminId)
      .gte('created_at', since),
  ]);

  const totalConversations = conversations.count ?? 0;
  const confirmedOrders = (orders.data ?? []).filter(o => o.status === 'confirmed' || o.status === 'completed' || o.status === 'delivered');
  const totalRevenue = (payments.data ?? []).reduce((sum, p) => sum + Number(p.amount), 0);
  const avgOrderValue = confirmedOrders.length > 0
    ? confirmedOrders.reduce((sum, o) => sum + Number(o.final_price), 0) / confirmedOrders.length
    : 0;

  const upsellTotal = upsells.data?.length ?? 0;
  const upsellConverted = (upsells.data ?? []).filter(u => u.converted).length;
  const upsellRate = upsellTotal > 0 ? Math.round((upsellConverted / upsellTotal) * 100) : 0;

  const ndaAccepted = (conversations.data ?? []).filter(c => c.nda_accepted).length;
  const conversionRate = ndaAccepted > 0
    ? Math.round((confirmedOrders.length / ndaAccepted) * 100)
    : 0;

  const avgRating = reviews.data && reviews.data.length > 0
    ? Math.round((reviews.data.reduce((s, r) => s + r.star_rating, 0) / reviews.data.length) * 10) / 10
    : null;

  // Fulfillment split
  const deliveryOrders = confirmedOrders.filter(o => o.fulfillment_type === 'delivery').length;
  const pickupOrders = confirmedOrders.filter(o => o.fulfillment_type === 'pickup').length;

  // Customer classification distribution
  const classifications: Record<string, number> = {};
  for (const c of conversations.data ?? []) {
    if (c.customer_classification) {
      classifications[c.customer_classification] = (classifications[c.customer_classification] ?? 0) + 1;
    }
  }

  return {
    period_days: days,
    total_conversations: totalConversations,
    nda_accepted: ndaAccepted,
    confirmed_orders: confirmedOrders.length,
    conversion_rate_pct: conversionRate,
    total_revenue: Math.round(totalRevenue * 100) / 100,
    avg_order_value: Math.round(avgOrderValue * 100) / 100,
    upsell_attempts: upsellTotal,
    upsell_converted: upsellConverted,
    upsell_rate_pct: upsellRate,
    delivery_orders: deliveryOrders,
    pickup_orders: pickupOrders,
    avg_review_rating: avgRating,
    customer_classifications: classifications,
  };
}

// ── UPSELL PERFORMANCE ────────────────────────────────────────

export async function getUpsellPerformance(adminId: string, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .schema('ember_halo')
    .from('upsell_events')
    .select('from_rose_count, to_rose_count, converted, upsell_phrase, active_city, persona_style, recorded_at')
    .eq('admin_id', adminId)
    .gte('recorded_at', since)
    .order('recorded_at', { ascending: false });

  if (error) throw new Error(error.message);

  // Group by from→to transition
  const transitions: Record<string, { attempts: number; conversions: number }> = {};
  for (const e of data ?? []) {
    const key = `${e.from_rose_count}→${e.to_rose_count}`;
    if (!transitions[key]) transitions[key] = { attempts: 0, conversions: 0 };
    transitions[key].attempts++;
    if (e.converted) transitions[key].conversions++;
  }

  // Top converting phrases
  const phrasePerf: Record<string, { attempts: number; conversions: number }> = {};
  for (const e of data ?? []) {
    if (!e.upsell_phrase) continue;
    if (!phrasePerf[e.upsell_phrase]) phrasePerf[e.upsell_phrase] = { attempts: 0, conversions: 0 };
    phrasePerf[e.upsell_phrase].attempts++;
    if (e.converted) phrasePerf[e.upsell_phrase].conversions++;
  }

  const topPhrases = Object.entries(phrasePerf)
    .map(([phrase, stats]) => ({
      phrase,
      ...stats,
      rate_pct: stats.attempts > 0 ? Math.round((stats.conversions / stats.attempts) * 100) : 0,
    }))
    .sort((a, b) => b.rate_pct - a.rate_pct)
    .slice(0, 10);

  return { transitions, top_phrases: topPhrases, raw_count: data?.length ?? 0 };
}

// ── REVENUE BY DAY ────────────────────────────────────────────

export async function getRevenueByDay(adminId: string, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .schema('ember_halo')
    .from('payments')
    .select('amount, created_at')
    .eq('admin_id', adminId)
    .eq('status', 'paid')
    .eq('webhook_confirmed', true)
    .gte('created_at', since)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);

  // Group by date
  const byDay: Record<string, number> = {};
  for (const p of data ?? []) {
    const day = p.created_at.split('T')[0];
    byDay[day] = (byDay[day] ?? 0) + Number(p.amount);
  }

  return Object.entries(byDay).map(([date, revenue]) => ({ date, revenue: Math.round(revenue * 100) / 100 }));
}

// ── LOG UPSELL EVENT ──────────────────────────────────────────

export async function logUpsellAttempt(params: {
  conversation_id: string;
  admin_id: string;
  from_rose_count: number;
  to_rose_count: number;
  upsell_phrase?: string;
  active_city?: string;
  persona_style?: string;
}): Promise<string> {
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('upsell_events')
    .insert({ ...params, converted: false })
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  return data.id;
}

export async function markUpsellConverted(upsellEventId: string): Promise<void> {
  await supabase
    .schema('ember_halo')
    .from('upsell_events')
    .update({ converted: true })
    .eq('id', upsellEventId);
}
