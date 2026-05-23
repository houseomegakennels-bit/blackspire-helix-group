/**
 * Ember Halo — Customer Classification Engine
 * Runs on every incoming message in unlocked states.
 * Detects behavioral signals and writes to customer_classifications table.
 * Feeds into AI upsell intensity and admin alerts.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export type CustomerTag =
  | 'vip_buyer'
  | 'repeat_buyer'
  | 'high_spender'
  | 'rush_buyer'
  | 'last_minute'
  | 'luxury_tier'
  | 'indecisive'
  | 'price_sensitive'
  | 'high_intent';

interface ClassificationSignal {
  tag: CustomerTag;
  confidence: number; // 0.0 – 1.0
}

const RUSH_PATTERNS = [
  /right now/i, /asap/i, /immediately/i, /tonight/i, /within.{1,10}hour/i,
  /urgent/i, /rush/i, /as soon as/i, /quick/i, /fast/i, /hurry/i,
];

const HIGH_SPEND_PATTERNS = [
  /100 roses/i, /200 roses/i, /bigger/i, /biggest/i, /more than/i,
  /custom/i, /private/i, /vip/i, /special/i, /premium/i,
];

const PRICE_SENSITIVE_PATTERNS = [
  /how much/i, /price/i, /cost/i, /expensive/i, /cheap/i, /discount/i,
  /deal/i, /afford/i, /budget/i, /less/i, /smaller/i,
];

const HIGH_INTENT_PATTERNS = [
  /i want/i, /i'll take/i, /let's do/i, /book/i, /order/i,
  /confirm/i, /ready/i, /checkout/i, /pay/i, /tonight/i,
];

const LUXURY_PATTERNS = [
  /200/i, /custom/i, /private/i, /exclusive/i, /vip/i,
  /discreet/i, /luxury/i, /suite/i, /hotel/i, /penthouse/i,
];

/**
 * Analyzes a single message and conversation history for behavioral signals.
 * Returns detected tags with confidence scores.
 */
export function detectSignals(
  message: string,
  turnCount: number,
  previousTags: CustomerTag[]
): ClassificationSignal[] {
  const signals: ClassificationSignal[] = [];

  // Rush buyer
  if (RUSH_PATTERNS.some(p => p.test(message))) {
    signals.push({ tag: 'rush_buyer', confidence: 0.85 });
  }

  // High intent
  if (HIGH_INTENT_PATTERNS.some(p => p.test(message))) {
    signals.push({ tag: 'high_intent', confidence: 0.80 });
  }

  // High spender signals
  if (HIGH_SPEND_PATTERNS.some(p => p.test(message))) {
    signals.push({ tag: 'high_spender', confidence: 0.70 });
  }

  // Luxury tier
  if (LUXURY_PATTERNS.some(p => p.test(message))) {
    signals.push({ tag: 'luxury_tier', confidence: 0.65 });
  }

  // Price sensitive
  if (PRICE_SENSITIVE_PATTERNS.some(p => p.test(message))) {
    signals.push({ tag: 'price_sensitive', confidence: 0.75 });
  }

  // Indecisive — many turns, no high intent signals yet
  if (turnCount > 8 && !previousTags.includes('high_intent')) {
    signals.push({ tag: 'indecisive', confidence: 0.60 });
  }

  // Last minute — rush + tonight
  if (/tonight/i.test(message) && RUSH_PATTERNS.some(p => p.test(message))) {
    signals.push({ tag: 'last_minute', confidence: 0.80 });
  }

  return signals;
}

/**
 * Persists classification signals above threshold and returns the dominant tag.
 */
export async function classifyAndPersist(
  conversationId: string,
  message: string,
  turnCount: number
): Promise<{ dominant_tag: CustomerTag | null; signals: ClassificationSignal[] }> {
  // Load previously detected tags
  const { data: existing } = await supabase
    .schema('ember_halo')
    .from('customer_classifications')
    .select('classification, confidence_score')
    .eq('conversation_id', conversationId)
    .order('detected_at', { ascending: false })
    .limit(10);

  const previousTags = (existing ?? []).map(e => e.classification as CustomerTag);
  const signals = detectSignals(message, turnCount, previousTags);

  // Only persist signals above 0.60 confidence that aren't already logged
  const newSignals = signals.filter(s =>
    s.confidence >= 0.60 && !previousTags.includes(s.tag)
  );

  if (newSignals.length > 0) {
    await supabase.schema('ember_halo').from('customer_classifications').insert(
      newSignals.map(s => ({
        conversation_id: conversationId,
        classification: s.tag,
        confidence_score: s.confidence,
      }))
    );

    // Update conversation.customer_classification with dominant tag
    const dominant = getDominantTag([...previousTags, ...newSignals.map(s => s.tag)]);
    if (dominant) {
      await supabase
        .schema('ember_halo')
        .from('conversations')
        .update({ customer_classification: dominant })
        .eq('id', conversationId);
    }
  }

  const allTags = [...previousTags, ...newSignals.map(s => s.tag)];
  return { dominant_tag: getDominantTag(allTags), signals };
}

/**
 * Returns the highest-priority tag from a set.
 * Priority: vip_buyer > luxury_tier > high_spender > rush_buyer > high_intent > repeat_buyer > last_minute > indecisive > price_sensitive
 */
function getDominantTag(tags: CustomerTag[]): CustomerTag | null {
  const priority: CustomerTag[] = [
    'vip_buyer', 'luxury_tier', 'high_spender', 'rush_buyer',
    'high_intent', 'repeat_buyer', 'last_minute', 'indecisive', 'price_sensitive',
  ];
  for (const tag of priority) {
    if (tags.includes(tag)) return tag;
  }
  return null;
}

/**
 * Maps customer tag to AI upsell intensity.
 * Used by the concierge to adjust how hard to push upgrades.
 */
export function getUpsellIntensity(tag: CustomerTag | null): 'aggressive' | 'moderate' | 'soft' | 'none' {
  switch (tag) {
    case 'vip_buyer':
    case 'luxury_tier':
    case 'high_spender':
      return 'aggressive';
    case 'high_intent':
    case 'rush_buyer':
    case 'repeat_buyer':
      return 'moderate';
    case 'last_minute':
      return 'soft'; // they're in a hurry — don't slow checkout with upselling
    case 'indecisive':
      return 'soft'; // already hesitating — don't push
    case 'price_sensitive':
      return 'none'; // upselling will kill the sale
    default:
      return 'moderate';
  }
}

/**
 * Triggers a high-value customer alert to n8n if tag is vip/luxury/high-spend.
 */
export async function alertIfHighValue(
  conversationId: string,
  adminId: string,
  tag: CustomerTag | null
): Promise<void> {
  if (!tag || !['vip_buyer', 'luxury_tier', 'high_spender'].includes(tag)) return;

  const base = process.env.N8N_WEBHOOK_BASE_URL;
  if (!base) return;

  try {
    await fetch(`${base}/ember-halo/high_value_customer_detected`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'high_value_customer_detected',
        conversation_id: conversationId,
        admin_id: adminId,
        classification: tag,
        timestamp: new Date().toISOString(),
      }),
    });
  } catch { /* non-fatal */ }
}
