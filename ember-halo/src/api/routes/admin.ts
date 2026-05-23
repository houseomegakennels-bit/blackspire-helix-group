/**
 * Ember Halo — Admin Operations API
 * Concierge Takeover, release, special request resolution, dashboard summary.
 */

import twilio from 'twilio';
import { createClient } from '@supabase/supabase-js';
import { generateAdminAssist } from '../../ai/concierge.js';
import { getLivePricing } from './pricing.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── CONCIERGE TAKEOVER ────────────────────────────────────────

export async function handleAdminTakeover(
  adminId: string,
  conversationId: string
): Promise<{ ok: boolean; suggestions: string }> {
  const { data: conv, error } = await supabase
    .schema('ember_halo')
    .from('conversations')
    .select('*')
    .eq('id', conversationId)
    .single();

  if (error || !conv) throw new Error('Conversation not found');

  // Verify admin owns or is a valid collaborator for this conversation
  const authorized =
    conv.admin_id === adminId ||
    conv.takeover_admin_id === adminId ||
    (await isAuthorizedCollaborator(adminId, conv.admin_id));

  if (!authorized) throw new Error('Unauthorized');

  await supabase
    .schema('ember_halo')
    .from('conversations')
    .update({
      admin_takeover: true,
      takeover_admin_id: adminId,
      last_message_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  await supabase.schema('ember_halo').from('audit_logs').insert({
    admin_id: adminId,
    action: 'concierge_takeover',
    entity_type: 'conversation',
    entity_id: conversationId,
  });

  // Generate AI suggestions for this admin
  const history = await loadConversationHistory(conversationId);
  const persona = await loadPersona(conv.admin_id);
  const pricing = await getLivePricing(conv.admin_id);

  const pricingCtx = {
    packages: pricing.standard_packages.map(p => ({
      roses: p.rose_count,
      pickup_price: p.pickup_price,
      delivery_price: p.delivery_price,
    })),
    special_packages: pricing.special_packages.map(s => ({
      name: s.package_name,
      roses: s.rose_count,
      pickup_price: s.pickup_price ?? undefined,
      delivery_price: s.delivery_price ?? undefined,
    })),
  };

  const suggestions = persona
    ? await generateAdminAssist(history, {
        state: conv.ai_mode,
        specialRequestActive: conv.special_request_flag,
        turnCount: history.filter(m => m.role === 'user').length,
        packageSelected: false,
        persona,
        pricing: pricingCtx,
      })
    : 'Persona not configured — suggestions unavailable.';

  return { ok: true, suggestions };
}

export async function handleAdminRelease(
  adminId: string,
  conversationId: string
): Promise<{ ok: boolean }> {
  await supabase
    .schema('ember_halo')
    .from('conversations')
    .update({
      admin_takeover: false,
      takeover_admin_id: null,
      last_message_at: new Date().toISOString(),
    })
    .eq('id', conversationId)
    .eq('takeover_admin_id', adminId);

  await supabase.schema('ember_halo').from('audit_logs').insert({
    admin_id: adminId,
    action: 'concierge_released',
    entity_type: 'conversation',
    entity_id: conversationId,
  });

  return { ok: true };
}

// ── ADMIN SENDS MESSAGE IN TAKEOVER MODE ──────────────────────

export async function adminSendMessage(params: {
  admin_id: string;
  conversation_id: string;
  message: string;
}): Promise<{ ok: boolean }> {
  const { data: conv } = await supabase
    .schema('ember_halo')
    .from('conversations')
    .select('admin_takeover, takeover_admin_id, channel, customer_phone')
    .eq('id', params.conversation_id)
    .single();

  if (!conv?.admin_takeover || conv.takeover_admin_id !== params.admin_id) {
    throw new Error('Not in takeover mode or unauthorized');
  }

  // Store message
  await supabase.schema('ember_halo').from('messages').insert({
    conversation_id: params.conversation_id,
    sender: 'admin',
    content: params.message,
    ai_mode: 'admin_assist',
  });

  // If SMS channel, send via Twilio
  if (conv.channel === 'sms' && conv.customer_phone) {
    await sendTwilioMessage(conv.customer_phone, params.message, params.admin_id);
  }

  return { ok: true };
}

// ── SPECIAL REQUEST RESOLUTION ────────────────────────────────

export async function resolveSpecialRequest(params: {
  admin_id: string;
  special_request_id: string;
  action: 'approved' | 'denied' | 'quoted';
  note?: string;
}): Promise<{ ok: boolean }> {
  const { data: req_ } = await supabase
    .schema('ember_halo')
    .from('special_requests')
    .select('id, admin_id, conversation_id')
    .eq('id', params.special_request_id)
    .eq('admin_id', params.admin_id)
    .single();

  if (!req_) throw new Error('Special request not found or unauthorized');

  await supabase
    .schema('ember_halo')
    .from('special_requests')
    .update({
      status: params.action,
      admin_action_note: params.note ?? null,
      resolved_by_admin_id: params.admin_id,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', params.special_request_id);

  return { ok: true };
}

// ── ADMIN DASHBOARD SUMMARY ───────────────────────────────────

export async function getDashboardSummary(adminId: string) {
  const today = new Date().toISOString().split('T')[0];

  const [activeChats, todayBookings, pendingRequests, todayRevenue, unresolvedAlerts] =
    await Promise.all([
      supabase
        .schema('ember_halo')
        .from('conversations')
        .select('id', { count: 'exact', head: true })
        .eq('admin_id', adminId)
        .eq('is_active', true),

      supabase
        .schema('ember_halo')
        .from('scheduling_records')
        .select('id', { count: 'exact', head: true })
        .eq('admin_id', adminId)
        .eq('scheduled_date', today)
        .not('status', 'in', '(cancelled,rescheduled)'),

      supabase
        .schema('ember_halo')
        .from('special_requests')
        .select('id', { count: 'exact', head: true })
        .eq('admin_id', adminId)
        .eq('status', 'pending'),

      supabase
        .schema('ember_halo')
        .from('payments')
        .select('amount')
        .eq('admin_id', adminId)
        .eq('status', 'paid')
        .eq('webhook_confirmed', true)
        .gte('created_at', `${today}T00:00:00Z`),

      supabase
        .schema('ember_halo')
        .from('special_requests')
        .select('id, request_type, request_summary, created_at')
        .eq('admin_id', adminId)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(5),
    ]);

  const revenue = (todayRevenue.data ?? []).reduce(
    (sum, p) => sum + Number(p.amount),
    0
  );

  return {
    active_conversations: activeChats.count ?? 0,
    bookings_today: todayBookings.count ?? 0,
    pending_special_requests: pendingRequests.count ?? 0,
    revenue_today: revenue,
    unresolved_alerts: unresolvedAlerts.data ?? [],
  };
}

// ── HELPERS ───────────────────────────────────────────────────

async function isAuthorizedCollaborator(adminId: string, ownerAdminId: string): Promise<boolean> {
  const { data } = await supabase
    .schema('ember_halo')
    .from('collaborations')
    .select('id')
    .eq('status', 'active')
    .in('level', ['overflow_support', 'special_request_support', 'city_coverage', 'full_partner'])
    .or(
      `and(requester_admin_id.eq.${adminId},receiver_admin_id.eq.${ownerAdminId}),` +
      `and(receiver_admin_id.eq.${adminId},requester_admin_id.eq.${ownerAdminId})`
    )
    .limit(1);

  return (data?.length ?? 0) > 0;
}

async function loadConversationHistory(conversationId: string) {
  const { data } = await supabase
    .schema('ember_halo')
    .from('messages')
    .select('sender, content')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: true })
    .limit(20);

  return (data ?? []).map(m => ({
    role: m.sender === 'customer' ? 'user' as const : 'assistant' as const,
    content: m.content,
  }));
}

async function loadPersona(adminId: string) {
  const { data } = await supabase
    .schema('ember_halo')
    .from('admin_personas')
    .select('*')
    .eq('admin_id', adminId)
    .eq('is_active', true)
    .single();

  if (!data) return null;

  // Format hours from JSON object {mon: '5pm-11pm', ...} → readable string
  const hoursJson = data.hours_of_operation as Record<string, string> | null;
  const hoursStr = hoursJson
    ? [...new Set(Object.values(hoursJson))].join(', ')
    : 'available evenings';

  return {
    concierge_name: data.customer_facing_name,
    active_city: data.active_city ?? 'your city',
    hours_of_operation: hoursStr,
    preferred_pet_names: data.preferred_pet_names ?? [],
    flirtation_level: data.flirtation_level as 'low' | 'medium' | 'high',
    persona_style: data.persona_style as 'sophisticated' | 'playful' | 'romantic' | 'dominant' | 'soft_luxury' | 'cold_luxury',
  };
}

async function sendTwilioMessage(to: string, body: string, adminId: string): Promise<void> {
  try {
    const sid   = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) return;

    const { data: admin } = await supabase
      .schema('ember_halo')
      .from('admins')
      .select('twilio_phone_number')
      .eq('id', adminId)
      .single();

    const from = admin?.twilio_phone_number ?? process.env.TWILIO_PHONE_NUMBER;
    if (!from) return;

    const client = twilio(sid, token);
    await client.messages.create({ body, from, to });
  } catch (err) {
    console.error('[sendTwilioMessage] Failed:', err);
    // Non-fatal
  }
}
