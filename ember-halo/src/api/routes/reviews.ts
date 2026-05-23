/**
 * Ember Halo — Reviews API
 * Only verified buyers (completed orders) can submit reviews.
 * Admins can feature, hide, or respond. Cannot fake reviews.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── REVIEW ELIGIBILITY ────────────────────────────────────────

export async function checkReviewEligibility(orderId: string): Promise<{
  eligible: boolean;
  reason?: string;
  admin_id?: string;
}> {
  const { data: order, error } = await supabase
    .schema('ember_halo')
    .from('orders')
    .select('id, admin_id, status')
    .eq('id', orderId)
    .single();

  if (error || !order) return { eligible: false, reason: 'Order not found' };
  if (order.status !== 'completed' && order.status !== 'delivered') {
    return { eligible: false, reason: 'Order not yet completed' };
  }

  // Check no existing review for this order
  const { data: existing } = await supabase
    .schema('ember_halo')
    .from('reviews')
    .select('id')
    .eq('order_id', orderId)
    .maybeSingle();  // null when no review exists — .single() would throw

  if (existing) return { eligible: false, reason: 'Review already submitted for this order' };

  return { eligible: true, admin_id: order.admin_id };
}

// ── SUBMIT REVIEW ─────────────────────────────────────────────

export async function submitReview(params: {
  order_id: string;
  star_rating: number;
  review_text?: string;
  tags?: string[];
  customer_alias?: string;
}) {
  const { eligible, reason, admin_id } = await checkReviewEligibility(params.order_id);
  if (!eligible) throw new Error(reason ?? 'Not eligible');
  if (params.star_rating < 1 || params.star_rating > 5) throw new Error('Rating must be 1–5');

  const { data: order } = await supabase
    .schema('ember_halo')
    .from('orders')
    .select('id')
    .eq('id', params.order_id)
    .single();

  const { data: schedRecord } = await supabase
    .schema('ember_halo')
    .from('scheduling_records')
    .select('id')
    .eq('order_id', params.order_id)
    .maybeSingle();  // scheduling record may not exist yet — .single() would throw

  const { data, error } = await supabase
    .schema('ember_halo')
    .from('reviews')
    .insert({
      admin_id: admin_id!,
      order_id: params.order_id,
      scheduling_record_id: schedRecord?.id ?? null,
      customer_alias: params.customer_alias ?? null,
      star_rating: params.star_rating,
      review_text: params.review_text ?? null,
      tags: params.tags ?? [],
      is_featured: false,
      is_hidden: false,
      is_verified: true,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

// ── ADMIN REVIEW MANAGEMENT ───────────────────────────────────

export async function listAdminReviews(adminId: string, opts: { include_hidden?: boolean } = {}) {
  let query = supabase
    .schema('ember_halo')
    .from('reviews')
    .select('*')
    .eq('admin_id', adminId)
    .order('is_featured', { ascending: false })
    .order('created_at', { ascending: false });

  if (!opts.include_hidden) query = query.eq('is_hidden', false);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function featureReview(adminId: string, reviewId: string, featured: boolean) {
  // Unfeature all others first if featuring (keep one featured at a time optional)
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('reviews')
    .update({ is_featured: featured })
    .eq('id', reviewId)
    .eq('admin_id', adminId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function hideReview(adminId: string, reviewId: string, hidden: boolean) {
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('reviews')
    .update({ is_hidden: hidden })
    .eq('id', reviewId)
    .eq('admin_id', adminId)
    .select()
    .single();

  if (error) throw new Error(error.message);

  await supabase.schema('ember_halo').from('audit_logs').insert({
    admin_id: adminId,
    action: hidden ? 'review_hidden' : 'review_unhidden',
    entity_type: 'review',
    entity_id: reviewId,
  });

  return data;
}

export async function reportReview(adminId: string, reviewId: string, reason: string) {
  await supabase.schema('ember_halo').from('audit_logs').insert({
    admin_id: adminId,
    action: 'review_reported',
    entity_type: 'review',
    entity_id: reviewId,
    metadata: { reason },
  });
  return { ok: true };
}

// ── REVIEW STATS ──────────────────────────────────────────────

export async function getReviewStats(adminId: string) {
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('reviews')
    .select('star_rating')
    .eq('admin_id', adminId)
    .eq('is_hidden', false)
    .eq('is_verified', true);

  if (error) throw new Error(error.message);

  const ratings = data ?? [];
  if (ratings.length === 0) return { total: 0, average: 0, distribution: {} };

  const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  for (const r of ratings) {
    distribution[r.star_rating] = (distribution[r.star_rating] ?? 0) + 1;
    sum += r.star_rating;
  }

  return {
    total: ratings.length,
    average: Math.round((sum / ratings.length) * 10) / 10,
    distribution,
  };
}
