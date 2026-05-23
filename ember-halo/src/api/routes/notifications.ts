/**
 * Ember Halo — Notification Preferences API
 * Per-admin, per-event notification configuration.
 * Called during admin onboarding and settings tab.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const ALL_NOTIFICATION_EVENTS = [
  'conversation_started',
  'lawful_use_confirmed',
  'nda_accepted',
  'special_request_created',
  'booking_confirmed',
  'payment_completed',
  'payment_failed',
  'schedule_changed',
  'media_viewed',
  'screenshot_event',
  'review_eligible',
  'post_service_followup',
  'collaboration_request_received',
  'high_value_customer_detected',
  'admin_takeover_recommended',
] as const;

export type NotificationEvent = typeof ALL_NOTIFICATION_EVENTS[number];

export async function getNotificationPreferences(adminId: string) {
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('notification_preferences')
    .select('*')
    .eq('admin_id', adminId)
    .order('event_type');

  if (error) throw new Error(error.message);

  // Fill in defaults for any missing event types
  const existing = new Set((data ?? []).map(d => d.event_type));
  const missing = ALL_NOTIFICATION_EVENTS.filter(e => !existing.has(e));

  return {
    preferences: data ?? [],
    unconfigured_events: missing,
  };
}

export async function upsertNotificationPreference(adminId: string, pref: {
  event_type: string;
  channel: 'sms' | 'email' | 'both' | 'none';
  notify_phone?: string;
  notify_email?: string;
  is_enabled: boolean;
}) {
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('notification_preferences')
    .upsert({
      admin_id: adminId,
      ...pref,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function bulkUpdateNotificationPreferences(
  adminId: string,
  prefs: Array<{
    event_type: string;
    channel: 'sms' | 'email' | 'both' | 'none';
    is_enabled: boolean;
  }>,
  contactInfo: { notify_phone?: string; notify_email?: string }
) {
  const rows = prefs.map(p => ({
    admin_id: adminId,
    event_type: p.event_type,
    channel: p.channel,
    is_enabled: p.is_enabled,
    notify_phone: contactInfo.notify_phone ?? null,
    notify_email: contactInfo.notify_email ?? null,
    updated_at: new Date().toISOString(),
  }));

  const { data, error } = await supabase
    .schema('ember_halo')
    .from('notification_preferences')
    .upsert(rows)
    .select();

  if (error) throw new Error(error.message);

  // Also update admin contact fields for convenience
  await supabase
    .schema('ember_halo')
    .from('admins')
    .update({
      notify_sms: contactInfo.notify_phone ?? null,
      notify_email: contactInfo.notify_email ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', adminId);

  return data;
}
