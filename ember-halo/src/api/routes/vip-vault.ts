/**
 * Ember Halo — VIP Client Vault API
 * Customer profiling built from order history.
 * Auto-updated on booking confirmation. Admin can tag + annotate.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── READ ──────────────────────────────────────────────────────

export async function getVaultEntry(adminId: string, customerPhone: string) {
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('vip_client_vault')
    .select('*')
    .eq('admin_id', adminId)
    .eq('customer_phone', customerPhone)
    .single();

  if (error) return null;
  return data;
}

export async function listVaultEntries(adminId: string, opts: {
  vip_tag?: string;
  search?: string;
  min_orders?: number;
  min_spent?: number;
  page?: number;
  per_page?: number;
}) {
  const page = opts.page ?? 1;
  const perPage = Math.min(opts.per_page ?? 25, 100);
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  let query = supabase
    .schema('ember_halo')
    .from('vip_client_vault')
    .select('*', { count: 'exact' })
    .eq('admin_id', adminId)
    .order('total_spent', { ascending: false })
    .range(from, to);

  if (opts.vip_tag) query = query.eq('vip_tag', opts.vip_tag);
  if (opts.min_orders) query = query.gte('total_orders', opts.min_orders);
  if (opts.min_spent) query = query.gte('total_spent', opts.min_spent);
  if (opts.search) query = query.ilike('customer_alias', `%${opts.search}%`);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  return { entries: data ?? [], total: count ?? 0, page, per_page: perPage };
}

// ── UPDATE (admin annotations) ────────────────────────────────

export async function updateVaultEntry(adminId: string, entryId: string, updates: {
  preferred_rose_colors?: string[];
  preferred_rose_count?: number;
  preferred_fulfillment?: string;
  anonymity_preference?: boolean;
  vip_tag?: string;
  admin_notes?: string;
}) {
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('vip_client_vault')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', entryId)
    .eq('admin_id', adminId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

// ── AUTO-UPDATE (called by Stripe webhook on payment confirmed) ─

export async function upsertVaultFromOrder(orderId: string): Promise<void> {
  const { data: order, error } = await supabase
    .schema('ember_halo')
    .from('orders')
    .select('admin_id, customer_phone, customer_alias, final_price, fulfillment_type, rose_count, anonymous_sender, rose_color, delivery_date')
    .eq('id', orderId)
    .single();

  if (error || !order || !order.customer_phone) return;

  const { data: existing } = await supabase
    .schema('ember_halo')
    .from('vip_client_vault')
    .select('id, total_orders, total_spent, first_order_date, preferred_rose_colors')
    .eq('admin_id', order.admin_id)
    .eq('customer_phone', order.customer_phone)
    .single();

  if (existing) {
    const newTotal = existing.total_orders + 1;
    const newSpent = Number(existing.total_spent) + Number(order.final_price);
    const existingColors: string[] = existing.preferred_rose_colors ?? [];
    const colors = order.rose_color && !existingColors.includes(order.rose_color)
      ? [...existingColors, order.rose_color]
      : existingColors;

    // Auto-tag based on spend/order count — never downgrade (high-value > regular > null)
    const TAG_RANK: Record<string, number> = { 'high-value': 2, 'regular': 1 };
    const autoTag = newSpent >= 500 ? 'high-value' : newTotal >= 3 ? 'regular' : null;
    const existingRank = TAG_RANK[existing.vip_tag ?? ''] ?? 0;
    const autoRank    = TAG_RANK[autoTag ?? ''] ?? 0;
    // Keep whichever tag is higher-ranked; preserve manually-set tags above auto threshold
    const resolvedTag = autoRank >= existingRank ? (autoTag ?? existing.vip_tag ?? null)
                                                  : (existing.vip_tag ?? null);

    await supabase
      .schema('ember_halo')
      .from('vip_client_vault')
      .update({
        customer_alias: order.customer_alias ?? undefined,
        total_orders: newTotal,
        total_spent: newSpent,
        last_order_date: order.delivery_date ?? new Date().toISOString().split('T')[0],
        preferred_rose_colors: colors,
        preferred_rose_count: order.rose_count,
        preferred_fulfillment: order.fulfillment_type,
        anonymity_preference: order.anonymous_sender,
        vip_tag: resolvedTag ?? undefined,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
  } else {
    await supabase
      .schema('ember_halo')
      .from('vip_client_vault')
      .insert({
        admin_id: order.admin_id,
        customer_alias: order.customer_alias ?? 'Unknown',
        customer_phone: order.customer_phone,
        preferred_rose_colors: order.rose_color ? [order.rose_color] : [],
        preferred_rose_count: order.rose_count,
        preferred_fulfillment: order.fulfillment_type,
        anonymity_preference: order.anonymous_sender ?? false,
        total_orders: 1,
        total_spent: Number(order.final_price),
        first_order_date: order.delivery_date ?? new Date().toISOString().split('T')[0],
        last_order_date: order.delivery_date ?? new Date().toISOString().split('T')[0],
      });
  }
}
