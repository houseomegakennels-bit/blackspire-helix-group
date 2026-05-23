/**
 * Ember Halo — Conversation State Machine
 * Controls AI mode transitions based on conversation events.
 * Backend only — never expose to client.
 */

import type { AiMode } from './modes.js';

export type ConversationState =
  | 'locked_gate'
  | 'lawful_use_confirmed'
  | 'nda_pending'
  | 'unlocked_customer_ui'
  | 'quote_pending'
  | 'checkout_pending'
  | 'booking_confirmed'
  | 'post_service_followup';

export type StateEvent =
  | 'LAWFUL_USE_PHRASE_MATCHED'
  | 'NDA_ACCEPTED'
  | 'PACKAGE_SELECTED'
  | 'QUOTE_ISSUED'
  | 'CHECKOUT_INITIATED'
  | 'PAYMENT_WEBHOOK_CONFIRMED'
  | 'DELIVERY_COMPLETED'
  | 'SPECIAL_REQUEST_DETECTED'
  | 'ADMIN_TAKEOVER'
  | 'ADMIN_RELEASED'
  | 'EXTENDED_CONVERSATION_DETECTED'; // no action taken, just signals long_conversation mode

const REQUIRED_LAWFUL_PHRASE =
  'i confirm that i am at least 18 years old and will use this service only for lawful floral gifting';

export function normalizeLawfulPhrase(input: string): string {
  return input.trim().toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ');
}

export function isLawfulPhraseMatch(input: string): boolean {
  return normalizeLawfulPhrase(input) === REQUIRED_LAWFUL_PHRASE;
}

/** Maps conversation state to the AI mode that should be active */
export function stateToAiMode(
  state: ConversationState,
  opts: {
    adminTakeover?: boolean;
    specialRequestActive?: boolean;
    extendedConversation?: boolean;
    packageSelected?: boolean;
  } = {}
): AiMode {
  if (opts.adminTakeover) return 'admin_assist';
  if (opts.specialRequestActive) return 'special_request_stall';

  switch (state) {
    case 'locked_gate':
    case 'lawful_use_confirmed':
      return 'locked_gate';

    case 'nda_pending':
      return 'nda_pending';

    case 'unlocked_customer_ui':
      if (opts.extendedConversation) return 'long_conversation';
      if (opts.packageSelected) return 'upsell';
      return 'sales_concierge';

    case 'quote_pending':
      return 'upsell';

    case 'checkout_pending':
      return 'sales_concierge';

    case 'booking_confirmed':
      return 'post_service_retention';

    case 'post_service_followup':
      return 'post_service_retention';

    default:
      return 'locked_gate';
  }
}

/** Pure state transition function — no side effects */
export function transition(
  current: ConversationState,
  event: StateEvent
): ConversationState {
  switch (current) {
    case 'locked_gate':
      if (event === 'LAWFUL_USE_PHRASE_MATCHED') return 'nda_pending';
      return current;

    case 'lawful_use_confirmed':
      return 'nda_pending';

    case 'nda_pending':
      if (event === 'NDA_ACCEPTED') return 'unlocked_customer_ui';
      return current;

    case 'unlocked_customer_ui':
      if (event === 'QUOTE_ISSUED') return 'quote_pending';
      return current;

    case 'quote_pending':
      if (event === 'CHECKOUT_INITIATED') return 'checkout_pending';
      return current;

    case 'checkout_pending':
      if (event === 'PAYMENT_WEBHOOK_CONFIRMED') return 'booking_confirmed';
      return current;

    case 'booking_confirmed':
      if (event === 'DELIVERY_COMPLETED') return 'post_service_followup';
      return current;

    case 'post_service_followup':
      return current;

    default:
      return 'locked_gate';
  }
}

/** Special request detection — runs on every incoming customer message */
export function detectSpecialRequest(message: string): boolean {
  const lower = message.toLowerCase();
  const triggers = [
    '200+', 'more than 200', 'over 200', '300', '400', '500',
    'outside', 'outside your area', 'different city',
    'right now', 'asap', 'immediately', 'rush', 'urgent',
    'multiple locations', 'two addresses', 'three addresses',
    'setup', 'arrange', 'install', 'display',
    'after hours', 'late night', 'midnight', 'early morning',
    'private', 'sensitive', 'discreet delivery note',
    'manual payment', 'pay another way', 'invoice',
    'vip', 'large order', 'bulk'
  ];
  return triggers.some(t => lower.includes(t));
}

/** Extended conversation detection — fires after N back-and-forth turns with no package selected */
export function isExtendedConversation(turnCount: number, packageSelected: boolean): boolean {
  return turnCount >= 6 && !packageSelected;
}

/** Post-gate smooth transition message — sent immediately after NDA accepted */
export const POST_NDA_OPENERS = [
  "Mmm... perfect. Now tell me what kind of roses we're sending tonight. ð¹",
  "Lovely. Now we can make this elegant. Are we thinking 15, 30, 100, or 200 roses tonight?",
  "Perfect. Let's keep this smooth. Who are these going to tonight?",
  "Good. Now — how many roses are we talking? I've got the night covered.",
];

export function getPostNdaOpener(): string {
  return POST_NDA_OPENERS[Math.floor(Math.random() * POST_NDA_OPENERS.length)];
}
