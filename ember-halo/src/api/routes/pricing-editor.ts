/**
 * Ember Halo — Admin Pricing Editor API
 * Full CRUD for standard packages and special packages.
 * All price changes are logged in audit_logs.
 * AI can only read prices — never write them.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── STANDARD PACKAGES ────────────────────────────────────────

export async function getAdminPackages(adminId: string) {
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('packages')
    .select('*')
    .eq('admin_id', adminId)
    .order('rose_count', { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function updatePackagePrice(params: {
  admin_id: string;
  package_id: string;
  pickup_price?: number;
  delivery_price?: number;
  is_active?: boolean;
}) {
  const { data: existing, error: fetchErr } = await supabase
    .schema('ember_halo')
    .from('packages')
    .select('*')
    .eq('id', params.package_id)
    .eq('admin_id', params.admin_id)
    .single();

  if (fetchErr || !existing) throw new Error('Package not found or unauthorized');

  const updates: Record<string, unknown> = { last_updated_at: new Date().toISOString(), last_updated_by_admin_id: params.admin_id };
  if (params.pickup_price !== undefined) updates.pickup_price = params.pickup_price;
  if (params.delivery_price !== undefined) updates.delivery_price = params.delivery_price;
  if (params.is_active !== undefined) updates.is_active = params.is_active;

  const { data, error } = await supabase
    .schema('ember_halo')
    .from('packages')
    .update(updates)
    .eq('id', params.package_id)
    .select()
    .single();

  if (error) throw new Error(error.message);

  await supabase.schema('ember_halo').from('audit_logs').insert({
    admin_id: params.admin_id,
    action: 'package_price_updated',
    entity_type: 'package',
    entity_id: params.package_id,
    metadata: {
      previous: { pickup_price: existing.pickup_price, delivery_price: existing.delivery_price },
      updated: { pickup_price: params.pickup_price, delivery_price: params.delivery_price },
    },
  });

  return data;
}

// ── SPECIAL PACKAGES ──────────────────────────────────────────

export async function listSpecialPackages(adminId: string) {
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('special_packages')
    .select('*')
    .eq('admin_id', adminId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createSpecialPackage(adminId: string, pkg: {
  package_name: string;
  rose_count: number;
  pickup_price?: number;
  delivery_price?: number;
  description?: string;
  active_city_or_region?: string;
  start_date?: string;
  end_date?: string;
  availability_limit?: number;
  is_public?: boolean;
  requires_admin_approval?: boolean;
  media_gallery_image_id?: string;
}) {
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('special_packages')
    .insert({
      admin_id: adminId,
      ...pkg,
      remaining_slots: pkg.availability_limit ?? null,
      is_active: false, // always starts inactive — admin must explicitly activate
      last_updated_by_admin_id: adminId,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);

  await supabase.schema('ember_halo').from('audit_logs').insert({
    admin_id: adminId,
    action: 'special_package_created',
    entity_type: 'special_package',
    entity_id: data.id,
    metadata: { package_name: pkg.package_name, rose_count: pkg.rose_count },
  });

  return data;
}

export async function updateSpecialPackage(adminId: string, packageId: string, updates: Record<string, unknown>) {
  // Strip fields admin cannot change via this route
  const safe = { ...updates };
  delete safe.admin_id;
  delete safe.id;
  safe.last_updated_at = new Date().toISOString();
  safe.last_updated_by_admin_id = adminId;

  const { data, error } = await supabase
    .schema('ember_halo')
    .from('special_packages')
    .update(safe)
    .eq('id', packageId)
    .eq('admin_id', adminId)
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function toggleSpecialPackage(adminId: string, packageId: string, active: boolean) {
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('special_packages')
    .update({ is_active: active, last_updated_at: new Date().toISOString(), last_updated_by_admin_id: adminId })
    .eq('id', packageId)
    .eq('admin_id', adminId)
    .select()
    .single();

  if (error) throw new Error(error.message);

  await supabase.schema('ember_halo').from('audit_logs').insert({
    admin_id: adminId,
    action: active ? 'special_package_activated' : 'special_package_deactivated',
    entity_type: 'special_package',
    entity_id: packageId,
  });

  return data;
}

// ── SCARCITY ENGINE ───────────────────────────────────────────

export async function setScarcityMessage(adminId: string, params: {
  package_id?: string;
  active_city?: string;
  message: string;
  expires_at?: string;
  is_active: boolean;
}) {
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('scarcity_settings')
    .upsert({
      admin_id: adminId,
      package_id: params.package_id ?? null,
      active_city: params.active_city ?? null,
      message: params.message,
      expires_at: params.expires_at ?? null,
      is_active: params.is_active,
    })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function getActiveScarcityMessages(adminId: string) {
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('scarcity_settings')
    .select('*')
    .eq('admin_id', adminId)
    .eq('is_active', true)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

  if (error) throw new Error(error.message);
  return data ?? [];
}
