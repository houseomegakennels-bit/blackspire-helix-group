/**
 * Ember Halo — Order Status & Scheduling Records API
 * Used by frontend to poll order status after payment.
 * Used by admin dashboard to manage full scheduling record lifecycle.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface OrderStatusResponse {
  order_id: string;
  status: string;
  payment_status: string;
  scheduling_record_id: string | null;
  webhook_confirmed: boolean;
}

/** Polled by frontend every 3s after payment submit */
export async function getOrderStatus(orderId: string): Promise<OrderStatusResponse> {
  const { data: order, error } = await supabase
    .schema('ember_halo')
    .from('orders')
    .select('id, status')
    .eq('id', orderId)
    .single();

  if (error || !order) throw new Error(`Order not found: ${orderId}`);

  const { data: payment } = await supabase
    .schema('ember_halo')
    .from('payments')
    .select('status, webhook_confirmed')
    .eq('order_id', orderId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();  // returns null (not throw) if no payment record yet

  const { data: record } = await supabase
    .schema('ember_halo')
    .from('scheduling_records')
    .select('id')
    .eq('order_id', orderId)
    .maybeSingle();  // returns null (not throw) if not yet scheduled

  return {
    order_id: orderId,
    status: order.status,
    payment_status: payment?.status ?? 'pending',
    scheduling_record_id: record?.id ?? null,
    webhook_confirmed: payment?.webhook_confirmed ?? false,
  };
}

// ── SCHEDULING RECORDS (Admin) ────────────────────────────────

export interface SchedulingRecordFilters {
  admin_id: string;
  status?: string;
  fulfillment_type?: 'pickup' | 'delivery';
  city?: string;
  date_from?: string;
  date_to?: string;
  special_request_only?: boolean;
  payment_status?: string;
  search?: string;
  page?: number;
  per_page?: number;
}

export async function listSchedulingRecords(filters: SchedulingRecordFilters) {
  const page = filters.page ?? 1;
  const perPage = Math.min(filters.per_page ?? 25, 100);
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  let query = supabase
    .schema('ember_halo')
    .from('scheduling_records')
    .select('*, scheduling_status_history(previous_status, new_status, changed_at)', { count: 'exact' })
    .eq('admin_id', filters.admin_id)
    .order('scheduled_date', { ascending: false })
    .range(from, to);

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.fulfillment_type) query = query.eq('fulfillment_type', filters.fulfillment_type);
  if (filters.city) query = query.ilike('active_city', `%${filters.city}%`);
  if (filters.date_from) query = query.gte('scheduled_date', filters.date_from);
  if (filters.date_to) query = query.lte('scheduled_date', filters.date_to);
  if (filters.special_request_only) query = query.eq('special_request_flag', true);
  if (filters.payment_status) query = query.eq('payment_status', filters.payment_status);
  if (filters.search) {
    query = query.or(`customer_alias.ilike.%${filters.search}%,notes.ilike.%${filters.search}%`);
  }

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  return {
    records: data ?? [],
    total: count ?? 0,
    page,
    per_page: perPage,
    total_pages: Math.ceil((count ?? 0) / perPage),
  };
}

export async function updateSchedulingStatus(params: {
  scheduling_record_id: string;
  admin_id: string;
  new_status: string;
  note?: string;
}): Promise<void> {
  const { data: record, error } = await supabase
    .schema('ember_halo')
    .from('scheduling_records')
    .select('id, status, admin_id, order_id')
    .eq('id', params.scheduling_record_id)
    .eq('admin_id', params.admin_id)
    .single();

  if (error || !record) throw new Error('Scheduling record not found or unauthorized');

  const previousStatus = record.status;

  await supabase
    .schema('ember_halo')
    .from('scheduling_records')
    .update({
      status: params.new_status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.scheduling_record_id);

  // Log status change
  await supabase.schema('ember_halo').from('scheduling_status_history').insert({
    scheduling_record_id: params.scheduling_record_id,
    previous_status: previousStatus,
    new_status: params.new_status,
    changed_by_admin_id: params.admin_id,
    note: params.note ?? null,
  });

  // Sync order status
  await supabase
    .schema('ember_halo')
    .from('orders')
    .update({ status: params.new_status, updated_at: new Date().toISOString() })
    .eq('id', record.order_id);

  // Trigger n8n if delivery status changed
  if (['out_for_delivery', 'delivered', 'completed'].includes(params.new_status)) {
    await triggerN8nEvent('schedule_changed', {
      scheduling_record_id: params.scheduling_record_id,
      admin_id: params.admin_id,
      previous_status: previousStatus,
      new_status: params.new_status,
    });

    if (params.new_status === 'delivered') {
      await triggerN8nEvent('post_service_followup', {
        scheduling_record_id: params.scheduling_record_id,
        admin_id: params.admin_id,
        order_id: record.order_id,
      });
    }
  }
}

/** Admin exports scheduling records to CSV-friendly array */
export async function exportSchedulingRecords(adminId: string, dateFrom: string, dateTo: string) {
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('scheduling_records')
    .select(`
      id, customer_alias, package_name, fulfillment_type, active_city,
      address_or_pickup, scheduled_date, time_window, status,
      payment_status, notes, special_request_flag, created_at
    `)
    .eq('admin_id', adminId)
    .gte('scheduled_date', dateFrom)
    .lte('scheduled_date', dateTo)
    .order('scheduled_date', { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

async function triggerN8nEvent(eventType: string, payload: Record<string, unknown>): Promise<void> {
  const base = process.env.N8N_WEBHOOK_BASE_URL;
  if (!base) return;
  try {
    await fetch(`${base}/ember-halo/${eventType}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: eventType, ...payload, timestamp: new Date().toISOString() }),
    });
  } catch { /* non-fatal */ }
}
