/**
 * Ember Halo — Conversations List & Special Requests API
 * Admin dashboard conversation center + special requests queue.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── CONVERSATIONS LIST ────────────────────────────────────────

export async function listConversations(adminId: string, opts: {
  channel?: 'web' | 'sms';
  is_active?: boolean;
  special_request_only?: boolean;
  admin_takeover_only?: boolean;
  search?: string;
  page?: number;
  per_page?: number;
}) {
  const page    = opts.page ?? 1;
  const perPage = Math.min(opts.per_page ?? 30, 100);
  const from    = (page - 1) * perPage;
  const to      = from + perPage - 1;

  let query = supabase
    .schema('ember_halo')
    .from('conversations')
    .select(`
      id, channel, customer_alias, customer_phone, customer_session_id,
      ai_mode, lawful_use_confirmed, nda_accepted, is_active,
      admin_takeover, takeover_admin_id, customer_classification,
      special_request_flag, started_at, last_message_at
    `, { count: 'exact' })
    .eq('admin_id', adminId)
    .order('last_message_at', { ascending: false })
    .range(from, to);

  if (opts.channel)               query = query.eq('channel', opts.channel);
  if (opts.is_active !== undefined) query = query.eq('is_active', opts.is_active);
  if (opts.special_request_only)  query = query.eq('special_request_flag', true);
  if (opts.admin_takeover_only)   query = query.eq('admin_takeover', true);
  if (opts.search) {
    query = query.or(
      `customer_alias.ilike.%${opts.search}%,customer_phone.ilike.%${opts.search}%`
    );
  }

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  // Attach last message preview to each conversation.
  // Fetch the most recent messages across these conversations (DESC order).
  // Loop keeps only the first (latest) message seen per conversation_id.
  // Cap at ids.length * 5 — enough to guarantee coverage without a full table scan.
  const ids = (data ?? []).map(c => c.id);
  const { data: lastMessages } = ids.length > 0
    ? await supabase
        .schema('ember_halo')
        .from('messages')
        .select('conversation_id, content, sender, sent_at')
        .in('conversation_id', ids)
        .order('sent_at', { ascending: false })
        .limit(Math.min(ids.length * 5, 500))
    : { data: [] };

  const lastByConvo: Record<string, { content: string; sender: string; sent_at: string }> = {};
  for (const m of lastMessages ?? []) {
    if (!lastByConvo[m.conversation_id]) {
      lastByConvo[m.conversation_id] = { content: m.content, sender: m.sender, sent_at: m.sent_at };
    }
  }

  return {
    conversations: (data ?? []).map(c => ({
      ...c,
      last_message: lastByConvo[c.id] ?? null,
    })),
    total: count ?? 0,
    page,
    per_page: perPage,
  };
}

export async function getConversationDetail(adminId: string, conversationId: string) {
  const { data: conv, error } = await supabase
    .schema('ember_halo')
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .eq('admin_id', adminId)
    .single();

  if (error || !conv) throw new Error('Conversation not found');

  const { data: messages } = await supabase
    .schema('ember_halo')
    .from('messages')
    .select('id, sender, content, ai_mode, sent_at')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: true });

  const { data: classifications } = await supabase
    .schema('ember_halo')
    .from('customer_classifications')
    .select('classification, confidence_score, detected_at')
    .eq('conversation_id', conversationId)
    .order('detected_at', { ascending: false });

  const { data: specialRequests } = await supabase
    .schema('ember_halo')
    .from('special_requests')
    .select('id, request_type, request_summary, status, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false });

  return {
    conversation: conv,
    messages: messages ?? [],
    classifications: classifications ?? [],
    special_requests: specialRequests ?? [],
  };
}

// ── SPECIAL REQUESTS QUEUE ────────────────────────────────────

export async function listSpecialRequests(adminId: string, opts: {
  status?: string;
  page?: number;
  per_page?: number;
}) {
  const page    = opts.page ?? 1;
  const perPage = Math.min(opts.per_page ?? 25, 100);
  const from    = (page - 1) * perPage;
  const to      = from + perPage - 1;

  let query = supabase
    .schema('ember_halo')
    .from('special_requests')
    .select(`
      id, request_type, request_summary, active_city, fulfillment_type,
      status, admin_action_note, created_at, resolved_at,
      conversation_id, order_id
    `, { count: 'exact' })
    .eq('admin_id', adminId)
    .order('created_at', { ascending: false })
    .range(from, to);

  if (opts.status) query = query.eq('status', opts.status);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  return { requests: data ?? [], total: count ?? 0, page, per_page: perPage };
}
