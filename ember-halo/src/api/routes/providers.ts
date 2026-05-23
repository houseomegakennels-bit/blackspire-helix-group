/**
 * Ember Halo — Security/Support Provider Directory API
 * Admins browse vetted providers by city, type, pricing.
 * Providers apply via application portal. Admins approve.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── BROWSE PROVIDERS ──────────────────────────────────────────

export async function browseProviders(filters: {
  city?: string;
  service_type?: 'armed' | 'non_armed';
  transportation_available?: boolean;
  late_night_available?: boolean;
  vip_escort_capable?: boolean;
  hourly_max?: number;
  page?: number;
  per_page?: number;
}) {
  const page = filters.page ?? 1;
  const perPage = Math.min(filters.per_page ?? 20, 50);
  const from = (page - 1) * perPage;
  const to = from + perPage - 1;

  let query = supabase
    .schema('ember_halo')
    .from('providers')
    .select('id, company_name, coverage_cities, service_type, transportation_available, late_night_available, vip_escort_capable, hourly_rate_min, hourly_rate_max, verification_status', { count: 'exact' })
    .eq('is_active', true)
    .eq('verification_status', 'approved')
    .range(from, to);

  if (filters.service_type) query = query.eq('service_type', filters.service_type);
  if (filters.transportation_available !== undefined) query = query.eq('transportation_available', filters.transportation_available);
  if (filters.late_night_available !== undefined) query = query.eq('late_night_available', filters.late_night_available);
  if (filters.vip_escort_capable !== undefined) query = query.eq('vip_escort_capable', filters.vip_escort_capable);
  if (filters.hourly_max !== undefined) query = query.lte('hourly_rate_min', filters.hourly_max);
  if (filters.city) query = query.contains('coverage_cities', [filters.city]);

  const { data, error, count } = await query;
  if (error) throw new Error(error.message);

  return { providers: data ?? [], total: count ?? 0, page, per_page: perPage };
}

// ── BOOKMARK ──────────────────────────────────────────────────

export async function bookmarkProvider(adminId: string, providerId: string, notes?: string) {
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('admin_provider_bookmarks')
    .upsert({ admin_id: adminId, provider_id: providerId, notes: notes ?? null })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function removeBookmark(adminId: string, providerId: string) {
  await supabase
    .schema('ember_halo')
    .from('admin_provider_bookmarks')
    .delete()
    .eq('admin_id', adminId)
    .eq('provider_id', providerId);

  return { ok: true };
}

export async function listBookmarkedProviders(adminId: string) {
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('admin_provider_bookmarks')
    .select(`
      notes, saved_at,
      providers!inner(id, company_name, service_type, coverage_cities, transportation_available, hourly_rate_min, hourly_rate_max, late_night_available, vip_escort_capable)
    `)
    .eq('admin_id', adminId)
    .order('saved_at', { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

// ── PROVIDER APPLICATION ──────────────────────────────────────

export async function submitProviderApplication(app: {
  company_name: string;
  contact_name?: string;
  contact_email: string;
  contact_phone?: string;
  coverage_cities: string[];
  service_type: 'armed' | 'non_armed';
  transportation_available: boolean;
  hourly_rate_min?: number;
  hourly_rate_max?: number;
  late_night_available?: boolean;
  vip_escort_capable?: boolean;
  document_paths?: string[];
}) {
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('provider_applications')
    .insert({ ...app, status: 'pending' })
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  return { application_id: data.id };
}

// ── ADMIN: REVIEW APPLICATIONS ────────────────────────────────

export async function listPendingApplications() {
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('provider_applications')
    .select('*')
    .eq('status', 'pending')
    .order('submitted_at', { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function approveProviderApplication(reviewerAdminId: string, applicationId: string) {
  const { data: app, error } = await supabase
    .schema('ember_halo')
    .from('provider_applications')
    .select('*')
    .eq('id', applicationId)
    .single();

  if (error || !app) throw new Error('Application not found');

  // Create provider record
  const { data: provider } = await supabase
    .schema('ember_halo')
    .from('providers')
    .insert({
      company_name: app.company_name,
      contact_name: app.contact_name,
      contact_email: app.contact_email,
      contact_phone: app.contact_phone,
      coverage_cities: app.coverage_cities,
      service_type: app.service_type,
      transportation_available: app.transportation_available,
      hourly_rate_min: app.hourly_rate_min,
      hourly_rate_max: app.hourly_rate_max,
      late_night_available: app.late_night_available ?? false,
      vip_escort_capable: app.vip_escort_capable ?? false,
      verification_status: 'approved',
      verified_by_admin_id: reviewerAdminId,
      verified_at: new Date().toISOString(),
      is_active: true,
    })
    .select('id')
    .single();

  // Update application with provider link
  await supabase
    .schema('ember_halo')
    .from('provider_applications')
    .update({
      status: 'approved',
      provider_id: provider?.id,
      reviewed_by_admin_id: reviewerAdminId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', applicationId);

  return { provider_id: provider?.id };
}

export async function rejectProviderApplication(reviewerAdminId: string, applicationId: string) {
  await supabase
    .schema('ember_halo')
    .from('provider_applications')
    .update({
      status: 'rejected',
      reviewed_by_admin_id: reviewerAdminId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', applicationId);

  return { ok: true };
}
