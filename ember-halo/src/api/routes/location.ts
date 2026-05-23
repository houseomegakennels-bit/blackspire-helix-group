/**
 * Ember Halo — Admin Location & Hours API
 * Mobile pop-up operator controls. Instant city/availability switching.
 * AI reads this before quoting delivery times or active cities.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function getLocationControls(adminId: string) {
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('admin_location_controls')
    .select('*')
    .eq('admin_id', adminId)
    .single();

  if (error) return null;
  return data;
}

export async function updateLocationControls(adminId: string, updates: {
  active_cities?: string[];
  service_radius_miles?: number;
  travel_mode_enabled?: boolean;
  online_status?: boolean;
  rush_hour_enabled?: boolean;
  holiday_mode?: boolean;
  availability_until?: string | null;
}) {
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('admin_location_controls')
    .upsert({
      admin_id: adminId,
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  // Sync active_city on admin record and persona for AI context
  if (updates.active_cities && updates.active_cities.length > 0) {
    const primaryCity = updates.active_cities[0];
    await Promise.all([
      supabase.schema('ember_halo').from('admins')
        .update({ active_city: primaryCity, updated_at: new Date().toISOString() })
        .eq('id', adminId),
      supabase.schema('ember_halo').from('admin_personas')
        .update({ active_city: primaryCity, updated_at: new Date().toISOString() })
        .eq('admin_id', adminId),
    ]);
  }

  await supabase.schema('ember_halo').from('audit_logs').insert({
    admin_id: adminId,
    action: 'location_controls_updated',
    entity_type: 'admin_location_controls',
    metadata: updates,
  });

  return data;
}

export async function setOnlineStatus(adminId: string, online: boolean) {
  await supabase
    .schema('ember_halo')
    .from('admins')
    .update({ is_online: online, updated_at: new Date().toISOString() })
    .eq('id', adminId);

  await supabase
    .schema('ember_halo')
    .from('admin_location_controls')
    .update({ online_status: online, updated_at: new Date().toISOString() })
    .eq('admin_id', adminId);

  return { ok: true, online };
}

export async function updateOperatingHours(adminId: string, hours: Record<string, string>) {
  // hours format: { mon: "17:00-23:00", tue: "17:00-23:00", ... }
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('admin_personas')
    .update({ hours_of_operation: hours, updated_at: new Date().toISOString() })
    .eq('admin_id', adminId)
    .select('id, hours_of_operation')
    .single();

  if (error) throw new Error(error.message);
  return data;
}

/** Returns availability context for the AI to use when quoting delivery times */
export async function getAvailabilityContext(adminId: string): Promise<{
  is_online: boolean;
  active_cities: string[];
  hours_today: string | null;
  rush_hour_enabled: boolean;
  travel_mode: boolean;
  availability_until: string | null;
}> {
  const [controls, persona] = await Promise.all([
    supabase.schema('ember_halo').from('admin_location_controls')
      .select('*').eq('admin_id', adminId).single(),
    supabase.schema('ember_halo').from('admin_personas')
      .select('hours_of_operation').eq('admin_id', adminId).single(),
  ]);

  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const todayKey = days[new Date().getDay()];
  const hoursJson = persona.data?.hours_of_operation as Record<string, string> | null;
  const hoursToday = hoursJson?.[todayKey] ?? null;

  return {
    is_online: controls.data?.online_status ?? false,
    active_cities: controls.data?.active_cities ?? [],
    hours_today: hoursToday,
    rush_hour_enabled: controls.data?.rush_hour_enabled ?? false,
    travel_mode: controls.data?.travel_mode_enabled ?? false,
    availability_until: controls.data?.availability_until ?? null,
  };
}
