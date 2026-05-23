/**
 * Ember Halo — AI Concierge Service
 * Handles message routing, mode selection, and Anthropic API calls.
 * Uses prompt caching for persona + pricing context (expensive, stable blocks).
 */

import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt, type PersonaContext, type PricingContext } from './prompts/modes.js';
import {
  transition,
  stateToAiMode,
  isLawfulPhraseMatch,
  detectSpecialRequest,
  isExtendedConversation,
  getPostNdaOpener,
  type ConversationState,
  type StateEvent,
} from './prompts/state-machine.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export interface ConversationContext {
  state: ConversationState;
  adminTakeover: boolean;
  specialRequestActive: boolean;
  turnCount: number;
  packageSelected: boolean;
  persona: PersonaContext;
  pricing: PricingContext;
}

export interface MessageHistoryItem {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConciergeResponse {
  reply: string;
  newState: ConversationState;
  events: StateEvent[];
  specialRequestDetected: boolean;
  lawfulPhraseMatched: boolean;
  ndaAccepted: boolean;
}

/** Primary entry point — process an incoming customer message */
export async function processMessage(
  customerMessage: string,
  history: MessageHistoryItem[],
  ctx: ConversationContext
): Promise<ConciergeResponse> {
  const events: StateEvent[] = [];
  let newState = ctx.state;
  let specialRequestDetected = false;
  let lawfulPhraseMatched = false;
  let ndaAccepted = false;

  // Gate: check for lawful-use phrase
  if (ctx.state === 'locked_gate' && isLawfulPhraseMatch(customerMessage)) {
    lawfulPhraseMatched = true;
    events.push('LAWFUL_USE_PHRASE_MATCHED');
    newState = transition(ctx.state, 'LAWFUL_USE_PHRASE_MATCHED');
  }

  // NDA: any clear affirmative
  if (ctx.state === 'nda_pending' && isNdaAffirmative(customerMessage)) {
    ndaAccepted = true;
    events.push('NDA_ACCEPTED');
    newState = transition(ctx.state, 'NDA_ACCEPTED');

    // Return the post-NDA opener without calling the AI — this is deterministic
    return {
      reply: getPostNdaOpener(),
      newState,
      events,
      specialRequestDetected: false,
      lawfulPhraseMatched: false,
      ndaAccepted: true,
    };
  }

  // Special request detection (runs on every message in unlocked states)
  if (ctx.state !== 'locked_gate' && ctx.state !== 'nda_pending') {
    if (detectSpecialRequest(customerMessage)) {
      specialRequestDetected = true;
      events.push('SPECIAL_REQUEST_DETECTED');
    }
  }

  const mode = stateToAiMode(newState, {
    adminTakeover: ctx.adminTakeover,
    specialRequestActive: ctx.specialRequestActive || specialRequestDetected,
    extendedConversation: isExtendedConversation(ctx.turnCount, ctx.packageSelected),
    packageSelected: ctx.packageSelected,
  });

  const systemPrompt = buildSystemPrompt(mode, ctx.persona, ctx.pricing);

  // Build messages with prompt caching on the system prompt (stable, expensive context)
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,   // concierge replies should be short
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' }, // cache the full system prompt
      },
    ],
    messages: [
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: customerMessage },
    ],
  });

  const reply = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');

  return {
    reply,
    newState,
    events,
    specialRequestDetected,
    lawfulPhraseMatched,
    ndaAccepted,
  };
}

function isNdaAffirmative(message: string): boolean {
  const lower = message.toLowerCase().trim();
  const affirmatives = [
    'yes', 'ok', 'okay', 'sure', 'agreed', 'i agree', 'agree',
    "let's go", 'lets go', 'yep', 'yup', 'absolutely', 'of course',
    'ready', "i'm ready", 'im ready', 'continue', 'proceed',
    'got it', 'understood', 'fine', 'sounds good', 'deal',
  ];
  return affirmatives.some(a => lower === a || lower.startsWith(a + ' '));
}

/** Generate an admin assist suggestion panel for Concierge Takeover Mode */
export async function generateAdminAssist(
  history: MessageHistoryItem[],
  ctx: Omit<ConversationContext, 'adminTakeover'>
): Promise<string> {
  const systemPrompt = buildSystemPrompt('admin_assist', ctx.persona, ctx.pricing);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    system: [
      {
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      ...history.map(m => ({ role: m.role, content: m.content })),
      {
        role: 'user',
        content: 'Generate 3 suggested reply options for the admin to send next, based on the conversation so far. Also provide a brief status note.',
      },
    ],
  });

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');
}

/** Generate AI bio draft for owner profile onboarding */
export async function generateOwnerBioDraft(intake: {
  display_name: string;
  title?: string;
  service_city: string;
  hours: string;
  tone: string;
  specials?: string;
  pickup_available: boolean;
  delivery_available: boolean;
  rough_notes?: string;
}): Promise<string> {
  const prompt = `
You are writing a short luxury concierge bio for an owner profile page on Ember Halo, a premium roses-only gifting platform.
The bio should be elegant, private, seductive, and mysterious. 2-3 short paragraphs max. No corporate language.

Intake information:
Name/Alias: ${intake.display_name}
Title: ${intake.title ?? 'Rose Concierge'}
City: ${intake.service_city}
Hours: ${intake.hours}
Tone: ${intake.tone}
Offers pickup: ${intake.pickup_available ? 'yes' : 'no'}
Offers delivery: ${intake.delivery_available ? 'yes' : 'no'}
${intake.specials ? `Current specials: ${intake.specials}` : ''}
${intake.rough_notes ? `Owner notes: ${intake.rough_notes}` : ''}

Write a luxury owner profile bio. Keep it short, premium, and in the voice of the persona.
`.trim();

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('');
}
