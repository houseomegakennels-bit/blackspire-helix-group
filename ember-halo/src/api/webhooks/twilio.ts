/**
 * Ember Halo — Twilio Inbound SMS Handler
 * Receives customer SMS, routes to AI concierge, replies via TwiML.
 * Handles STOP opt-outs and maps Twilio numbers to admin accounts.
 */

import twilio from 'twilio';
import { createClient } from '@supabase/supabase-js';
import { handleIncomingMessage } from '../routes/conversation.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export interface TwilioWebhookResult {
  status: number;
  twiml: string;
}

export async function handleTwilioSms(
  rawBody: string,
  signature: string,
  requestUrl: string
): Promise<TwilioWebhookResult> {
  // Validate Twilio signature
  const authToken = process.env.TWILIO_AUTH_TOKEN!;
  const params = Object.fromEntries(new URLSearchParams(rawBody));

  const isValid = twilio.validateRequest(
    authToken,
    signature,
    `${process.env.APP_URL}/webhooks/twilio/sms`,
    params
  );

  if (!isValid) {
    console.warn('Invalid Twilio signature');
    return { status: 403, twiml: twimlResponse('') };
  }

  const from: string = params['From'] ?? '';
  const body: string = params['Body'] ?? '';
  const to: string = params['To'] ?? '';   // Twilio number = identifies which admin

  // STOP opt-out — must handle before anything else
  if (body.trim().toUpperCase() === 'STOP') {
    await logSmsOptOut(from);
    return {
      status: 200,
      twiml: twimlResponse('You have been unsubscribed. Reply START to re-subscribe.'),
    };
  }

  // START re-subscribe
  if (body.trim().toUpperCase() === 'START') {
    await logSmsResubscribe(from);
    return { status: 200, twiml: twimlResponse('') }; // silent — AI will greet on next message
  }

  // Check opt-out status — do not respond to opted-out numbers
  const isOptedOut = await checkOptOut(from);
  if (isOptedOut) {
    return { status: 200, twiml: twimlResponse('') };
  }

  // Resolve admin from Twilio number
  const adminId = await resolveAdminFromTwilioNumber(to);
  if (!adminId) {
    console.error(`No admin found for Twilio number: ${to}`);
    return { status: 200, twiml: twimlResponse('') };
  }

  try {
    const result = await handleIncomingMessage({
      admin_id: adminId,
      channel: 'sms',
      customer_message: body,
      customer_phone: from,
      suppressSmsReply: true,  // TwiML below handles the reply — prevents double-send
    });

    return {
      status: 200,
      twiml: twimlResponse(result.reply),
    };
  } catch (err) {
    console.error('SMS processing error:', err);
    // Graceful failure — never expose internal errors to customer
    return {
      status: 200,
      twiml: twimlResponse("Give me just a moment, I'll be right with you. 🌹"),
    };
  }
}

function twimlResponse(message: string): string {
  if (!message) {
    return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';
  }
  // Escape XML special chars
  const safe = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
}

async function resolveAdminFromTwilioNumber(twilioNumber: string): Promise<string | null> {
  const { data } = await supabase
    .schema('ember_halo')
    .from('admins')
    .select('id')
    .eq('twilio_phone_number', twilioNumber)
    .eq('is_active', true)
    .single();

  return data?.id ?? null;
}

async function checkOptOut(phone: string): Promise<boolean> {
  // Check the sms_opt_out flag on the most recent active conversation for this phone number.
  // If any active conversation has opted out, silence the response.
  const { data } = await supabase
    .schema('ember_halo')
    .from('conversations')
    .select('sms_opt_out')
    .eq('customer_phone', phone)
    .eq('sms_opt_out', true)
    .limit(1);

  return (data?.length ?? 0) > 0;
}

async function logSmsOptOut(phone: string): Promise<void> {
  // Mark all active conversations for this phone number as opted out
  await supabase
    .schema('ember_halo')
    .from('conversations')
    .update({ sms_opt_out: true, is_active: false })
    .eq('customer_phone', phone);

  // Also log to audit for compliance record
  await supabase.schema('ember_halo').from('audit_logs').insert({
    action: 'sms_opt_out',
    entity_type: 'sms_compliance',
    metadata: { phone, source: 'STOP_command' },
  });
}

async function logSmsResubscribe(phone: string): Promise<void> {
  // Clear opt-out flag on any conversations for this phone
  await supabase
    .schema('ember_halo')
    .from('conversations')
    .update({ sms_opt_out: false })
    .eq('customer_phone', phone);

  await supabase.schema('ember_halo').from('audit_logs').insert({
    action: 'sms_resubscribe',
    entity_type: 'sms_compliance',
    metadata: { phone, source: 'START_command' },
  });
}
