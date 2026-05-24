/**
 * Ember Halo — Conversation API
 * POST /api/conversation/message
 * Core endpoint called by Lovable frontend and SMS relay (n8n).
 * Handles state transitions, AI responses, special request detection, and audit logging.
 */

import twilio from 'twilio';
import { createClient } from '@supabase/supabase-js';
import { processMessage, type MessageHistoryItem, type ConversationContext } from '../../ai/concierge.js';
import { getLivePricing } from './pricing.js';
import { classifyAndPersist, alertIfHighValue } from '../../ai/classifier.js';
import { getAvailabilityContext } from './location.js';
import type { ConversationState } from '../../ai/prompts/state-machine.js';

// ── SYSTEM TRIGGER CODES (sent by n8n workflows, not real customer messages) ──
const SYSTEM_TRIGGERS: Record<string, { syntheticMessage: string; forceMode?: string }> = {
  '__SYSTEM_PAYMENT_RETRY__': {
    syntheticMessage: '[SYSTEM: The customer\'s payment attempt just failed. Gracefully and warmly let them know and invite them to try again. Keep it brief — 1-2 sentences. Do not mention card errors directly.]',
  },
  '__SYSTEM_OUT_FOR_DELIVERY__': {
    syntheticMessage: '[SYSTEM: The customer\'s rose order is now out for delivery. Send a brief, warm status update. Build anticipation. 1-2 sentences max.]',
  },
  '__SYSTEM_POST_SERVICE_FOLLOWUP__': {
    syntheticMessage: '[SYSTEM: The order has been delivered. Send a warm, brief post-service message checking in. If they express satisfaction, invite them to leave a review — only once, never push twice.]',
    forceMode: 'post_service_retention',
  },
};

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface IncomingMessage {
  conversation_id?: string;       // null = new conversation
  admin_id: string;
  channel: 'web' | 'sms';
  customer_message: string;
  customer_phone?: string;        // required for SMS
  customer_session_id?: string;   // required for web
  suppressSmsReply?: boolean;     // set true when TwiML handles the reply (direct webhook path)
}

export interface ConversationMessageResponse {
  conversation_id: string;
  reply: string;
  state: ConversationState;
  special_request_detected: boolean;
  lawful_phrase_matched: boolean;
  nda_accepted: boolean;
  admin_takeover_recommended: boolean;
}

export async function handleIncomingMessage(
  req: IncomingMessage
): Promise<ConversationMessageResponse> {
  // 0. Detect n8n system trigger codes — remap before any other logic
  const triggerConfig = SYSTEM_TRIGGERS[req.customer_message];
  const isSystemTrigger = !!triggerConfig;
  if (isSystemTrigger) {
    req = { ...req, customer_message: triggerConfig.syntheticMessage };
  }

  // 1. Fetch or create conversation.
  //    System triggers may arrive without a conversation_id (e.g. WF 06 out-for-delivery).
  //    In that case, look up by customer_phone + admin_id to avoid creating ghost conversations.
  let conversation: Awaited<ReturnType<typeof fetchConversation>>;
  if (req.conversation_id) {
    conversation = await fetchConversation(req.conversation_id);
  } else if (isSystemTrigger && req.customer_phone) {
    const existing = await findConversationByPhone(req.admin_id, req.customer_phone);
    conversation = existing ?? await createConversation(req);
  } else if (req.channel === 'web' && req.customer_session_id) {
    const existing = await findConversationBySession(req.admin_id, req.customer_session_id);
    conversation = existing ?? await createConversation(req);
  } else {
    conversation = await createConversation(req);
  }

  // 2. Load message history (last 20 turns for context window efficiency)
  const history = await loadHistory(conversation.id, 20);

  // 3. Load persona for this admin
  const persona = await loadPersona(req.admin_id);
  if (!persona) throw new Error(`No persona configured for admin ${req.admin_id}`);

  // 4. Load live pricing
  const pricingData = await getLivePricing(req.admin_id);
  const pricing = {
    packages: pricingData.standard_packages.map(p => ({
      roses: p.rose_count,
      pickup_price: p.pickup_price,
      delivery_price: p.delivery_price,
    })),
    special_packages: pricingData.special_packages.map(s => ({
      name: s.package_name,
      roses: s.rose_count,
      pickup_price: s.pickup_price ?? undefined,
      delivery_price: s.delivery_price ?? undefined,
      description: s.description ?? undefined,
    })),
  };

  // 5. Load availability context so AI knows current city / hours
  const availability = await getAvailabilityContext(req.admin_id);
  if (availability.active_cities.length > 0) {
    persona.active_city = availability.active_cities[0];
  }
  if (availability.hours_today) {
    persona.hours_of_operation = availability.hours_today;
  }

  const turnCount = history.filter(m => m.role === 'user').length;

  // 6. Check if a package has already been selected (active non-cancelled order exists)
  const { data: activeOrder } = await supabase
    .schema('ember_halo')
    .from('orders')
    .select('id')
    .eq('conversation_id', conversation.id)
    .neq('status', 'cancelled')
    .limit(1)
    .maybeSingle();   // returns null (not throw) when no active order exists

  // 7. Build conversation context (system triggers may force a specific mode)
  const ctx: ConversationContext = {
    state: (triggerConfig?.forceMode ?? conversation.ai_mode) as ConversationState,
    adminTakeover: conversation.admin_takeover,
    specialRequestActive: conversation.special_request_flag,
    turnCount,
    packageSelected: !!activeOrder,
    persona,
    pricing,
  };

  // 8. Run classifier in parallel with AI call (non-blocking for AI latency)
  const [result, classificationResult] = await Promise.all([
    processMessage(req.customer_message, history, ctx),
    conversation.nda_accepted
      ? classifyAndPersist(conversation.id, req.customer_message, turnCount)
      : Promise.resolve({ dominant_tag: null, signals: [] }),
  ]);

  // Alert admin if high-value customer detected for first time
  if (classificationResult.dominant_tag) {
    await alertIfHighValue(conversation.id, req.admin_id, classificationResult.dominant_tag);
  }

  // 8. Persist customer message (skip for system triggers — they are internal, not customer-authored)
  if (!isSystemTrigger) {
    await supabase.schema('ember_halo').from('messages').insert({
      conversation_id: conversation.id,
      sender: 'customer',
      content: req.customer_message,
      ai_mode: conversation.ai_mode,
    });
  }

  // 8. Persist AI reply
  await supabase.schema('ember_halo').from('messages').insert({
    conversation_id: conversation.id,
    sender: 'ai',
    content: result.reply,
    ai_mode: result.newState,
  });

  // 9. Update conversation state
  const updates: Record<string, unknown> = {
    ai_mode: result.newState,
    last_message_at: new Date().toISOString(),
  };

  if (result.lawfulPhraseMatched) updates.lawful_use_confirmed = true;
  if (result.ndaAccepted) updates.nda_accepted = true;
  if (result.specialRequestDetected) updates.special_request_flag = true;

  await supabase
    .schema('ember_halo')
    .from('conversations')
    .update(updates)
    .eq('id', conversation.id);

  // 10. Log NDA acceptance
  if (result.ndaAccepted) {
    await supabase.schema('ember_halo').from('agreements').insert({
      conversation_id: conversation.id,
      session_id: req.customer_session_id ?? null,
      customer_alias: conversation.customer_alias,
      customer_phone: req.customer_phone ?? null,
      agreement_text: 'Customer accepted Ember Halo privacy and confidentiality agreement.',
    });
  }

  // 11. Create special request record and trigger n8n alert
  if (result.specialRequestDetected && !conversation.special_request_flag) {
    await createSpecialRequest(conversation.id, req.admin_id, req.customer_message);
    await triggerN8nEvent('special_request_created', {
      conversation_id: conversation.id,
      admin_id: req.admin_id,
      channel: req.channel,
      request_summary: req.customer_message.substring(0, 200),
    });
  }

  // 12. Admin takeover recommendation (high special request confidence)
  const adminTakeoverRecommended = result.specialRequestDetected;
  if (adminTakeoverRecommended) {
    await supabase.schema('ember_halo').from('audit_logs').insert({
      admin_id: req.admin_id,
      action: 'admin_takeover_recommended',
      entity_type: 'conversation',
      entity_id: conversation.id,
      metadata: { reason: 'special_request_detected', message_preview: req.customer_message.substring(0, 100) },
    });
  }

  // 13. For SMS conversations, send reply outbound via Twilio SDK.
  //     Skip when suppressSmsReply=true (direct /webhooks/twilio/sms path — TwiML handles the reply).
  //     Always send when coming from n8n (no TwiML path back to Twilio).
  if (req.channel === 'sms' && !req.suppressSmsReply && conversation.customer_phone) {
    await sendOutboundSms(req.admin_id, conversation.customer_phone, result.reply);
  }

  return {
    conversation_id: conversation.id,
    reply: result.reply,
    state: result.newState,
    special_request_detected: result.specialRequestDetected,
    lawful_phrase_matched: result.lawfulPhraseMatched,
    nda_accepted: result.ndaAccepted,
    admin_takeover_recommended: adminTakeoverRecommended,
  };
}

async function fetchConversation(id: string) {
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('conversations')
    .select('*')
    .eq('id', id)
    .single();
  if (error || !data) throw new Error(`Conversation not found: ${id}`);
  return data;
}

async function createConversation(req: IncomingMessage) {
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('conversations')
    .insert({
      admin_id: req.admin_id,
      channel: req.channel,
      customer_phone: req.customer_phone ?? null,
      customer_session_id: req.customer_session_id ?? null,
      ai_mode: 'locked_gate',
      lawful_use_confirmed: false,
      nda_accepted: false,
      is_active: true,
      admin_takeover: false,
      special_request_flag: false,
    })
    .select()
    .single();

  if (error || !data) throw new Error('Failed to create conversation');

  // Notify admin of new conversation start
  await triggerN8nEvent('conversation_started', {
    conversation_id: data.id,
    admin_id: req.admin_id,
    channel: req.channel,
  });

  return data;
}

async function loadHistory(conversationId: string, limit: number): Promise<MessageHistoryItem[]> {
  const { data } = await supabase
    .schema('ember_halo')
    .from('messages')
    .select('sender, content')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: true })
    .limit(limit);

  return (data ?? []).map(m => ({
    role: m.sender === 'customer' ? 'user' : 'assistant',
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

  return {
    concierge_name: data.customer_facing_name,
    active_city: data.active_city ?? 'your city',
    hours_of_operation: formatHours(data.hours_of_operation),
    preferred_pet_names: data.preferred_pet_names ?? [],
    flirtation_level: data.flirtation_level,
    persona_style: data.persona_style,
  };
}

async function createSpecialRequest(
  conversationId: string,
  adminId: string,
  requestMessage: string
) {
  await supabase.schema('ember_halo').from('special_requests').insert({
    conversation_id: conversationId,
    admin_id: adminId,
    request_type: 'auto_detected',
    request_summary: requestMessage.substring(0, 500),
    status: 'pending',
  });
}

async function findConversationByPhone(adminId: string, phone: string) {
  const { data } = await supabase
    .schema('ember_halo')
    .from('conversations')
    .select('*')
    .eq('admin_id', adminId)
    .eq('customer_phone', phone)
    .eq('is_active', true)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();  // returns null when no active conversation found for this phone
  return data ?? null;
}

async function findConversationBySession(adminId: string, sessionId: string) {
  const { data } = await supabase
    .schema('ember_halo')
    .from('conversations')
    .select('*')
    .eq('admin_id', adminId)
    .eq('customer_session_id', sessionId)
    .eq('is_active', true)
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

async function sendOutboundSms(adminId: string, toPhone: string, message: string): Promise<void> {
  try {
    const sid   = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) return;

    // Fetch this admin's Twilio number (may differ per admin in multi-tenant setup)
    const { data: adminRow } = await supabase
      .schema('ember_halo')
      .from('admins')
      .select('twilio_phone_number')
      .eq('id', adminId)
      .single();

    const fromNumber = adminRow?.twilio_phone_number ?? process.env.TWILIO_PHONE_NUMBER;
    if (!fromNumber) return;

    const client = twilio(sid, token);
    await client.messages.create({ body: message, from: fromNumber, to: toPhone });
  } catch (err) {
    console.error('[sendOutboundSms] Failed to send SMS:', err);
    // Non-fatal — reply is still persisted in DB
  }
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

function formatHours(hoursJson: Record<string, string> | null): string {
  if (!hoursJson) return 'available evenings';
  const entries = Object.entries(hoursJson);
  if (entries.length === 0) return 'available evenings';
  // Simple: show first day range as representative
  const times = [...new Set(Object.values(hoursJson))];
  return times[0] ?? 'available evenings';
}
