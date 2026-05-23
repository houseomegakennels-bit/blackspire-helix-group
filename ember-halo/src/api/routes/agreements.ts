/**
 * Ember Halo — Agreement Acceptance Log
 * POST /api/agreement/accept
 * Called by frontend when customer accepts the NDA/privacy agreement.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const AGREEMENT_TEXT =
  'Customer accepted Ember Halo privacy and confidentiality agreement. ' +
  'Agreed not to redistribute, screenshot, or share content from this platform. ' +
  'Confirmed service is for lawful floral gifting only.';

export async function logAgreementAccepted(body: Record<string, unknown>): Promise<void> {
  const conversationId = body.conversation_id as string | undefined;
  const sessionId = body.session_id as string | undefined;
  const customerAlias = body.customer_alias as string | undefined;
  const customerPhone = body.customer_phone as string | undefined;

  if (!conversationId) throw new Error('conversation_id required');

  await supabase.schema('ember_halo').from('agreements').insert({
    conversation_id: conversationId,
    session_id: sessionId ?? null,
    customer_alias: customerAlias ?? null,
    customer_phone: customerPhone ?? null,
    agreement_text: AGREEMENT_TEXT,
  });

  // Mark conversation as NDA accepted
  await supabase
    .schema('ember_halo')
    .from('conversations')
    .update({ nda_accepted: true, last_message_at: new Date().toISOString() })
    .eq('id', conversationId);
}
