/**
 * Ember Halo — Owner Profile API
 * AI bio generation, publish/unpublish, version history.
 * Public profile read requires no auth. Edit requires admin auth.
 */

import { createClient } from '@supabase/supabase-js';
import { generateOwnerBioDraft } from '../../ai/concierge.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ── PUBLIC PROFILE (no auth) ──────────────────────────────────

export async function getPublicProfile(adminId: string) {
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('owner_profiles')
    .select(`
      id, display_name, bio, title, service_area, hours_of_operation,
      specials_text, privacy_level, is_published, updated_at,
      profile_image_id
    `)
    .eq('admin_id', adminId)
    .eq('is_published', true)
    .single();

  if (error || !data) throw new Error('Profile not found');

  // Get reviews (public — verified + not hidden)
  const { data: reviews } = await supabase
    .schema('ember_halo')
    .from('reviews')
    .select('id, customer_alias, star_rating, review_text, tags, is_featured, created_at')
    .eq('admin_id', adminId)
    .eq('is_hidden', false)
    .eq('is_verified', true)
    .order('is_featured', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(20);

  // Get gallery images for slideshow
  const { data: gallery } = await supabase
    .schema('ember_halo')
    .from('media_gallery')
    .select('id, category, caption, sort_order')
    .eq('admin_id', adminId)
    .eq('is_active', true)
    .in('category', ['owner_profile', 'luxury_roses', 'arrangements'])
    .order('sort_order', { ascending: true })
    .limit(10);

  return { profile: data, reviews: reviews ?? [], gallery: gallery ?? [] };
}

// ── ADMIN PROFILE MANAGEMENT (requires auth) ──────────────────

export async function getAdminProfile(adminId: string) {
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('owner_profiles')
    .select('*')
    .eq('admin_id', adminId)
    .single();

  if (error) return null; // profile may not exist yet
  return data;
}

export async function generateAiBio(adminId: string, intake: {
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
  return generateOwnerBioDraft(intake);
}

export async function saveProfile(adminId: string, fields: {
  display_name: string;
  bio: string;
  title?: string;
  service_area?: string;
  hours_of_operation?: string;
  specials_text?: string;
  tone?: string;
  privacy_level?: 'standard' | 'private' | 'high_protection';
  profile_image_id?: string;
}) {
  // Check if profile exists
  const { data: existing } = await supabase
    .schema('ember_halo')
    .from('owner_profiles')
    .select('id, version')
    .eq('admin_id', adminId)
    .single();

  if (existing) {
    // Snapshot current version before overwriting
    const { data: currentFull } = await supabase
      .schema('ember_halo')
      .from('owner_profiles')
      .select('*')
      .eq('id', existing.id)
      .single();

    if (currentFull) {
      await supabase.schema('ember_halo').from('owner_profile_versions').insert({
        profile_id: existing.id,
        version: currentFull.version,
        snapshot: currentFull,
      });
    }

    const { data, error } = await supabase
      .schema('ember_halo')
      .from('owner_profiles')
      .update({ ...fields, version: existing.version + 1, updated_at: new Date().toISOString() })
      .eq('admin_id', adminId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  } else {
    const { data, error } = await supabase
      .schema('ember_halo')
      .from('owner_profiles')
      .insert({ admin_id: adminId, ...fields, version: 1, is_published: false })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }
}

export async function publishProfile(adminId: string, publish: boolean) {
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('owner_profiles')
    .update({ is_published: publish, updated_at: new Date().toISOString() })
    .eq('admin_id', adminId)
    .select('id, is_published')
    .single();

  if (error) throw new Error(error.message);

  await supabase.schema('ember_halo').from('audit_logs').insert({
    admin_id: adminId,
    action: publish ? 'profile_published' : 'profile_unpublished',
    entity_type: 'owner_profile',
    entity_id: data.id,
  });

  return data;
}

export async function restoreProfileVersion(adminId: string, versionNumber: number) {
  const { data: profile } = await supabase
    .schema('ember_halo')
    .from('owner_profiles')
    .select('id')
    .eq('admin_id', adminId)
    .single();

  if (!profile) throw new Error('Profile not found');

  const { data: versionRecord, error: vErr } = await supabase
    .schema('ember_halo')
    .from('owner_profile_versions')
    .select('snapshot')
    .eq('profile_id', profile.id)
    .eq('version', versionNumber)
    .single();

  if (vErr || !versionRecord) throw new Error('Version not found');

  const snap = versionRecord.snapshot as Record<string, unknown>;
  // Guard required string fields against null/undefined values in the stored snapshot
  const display_name = typeof snap.display_name === 'string' ? snap.display_name : '';
  const bio = typeof snap.bio === 'string' ? snap.bio : '';
  const title = typeof snap.title === 'string' ? snap.title : undefined;
  const service_area = typeof snap.service_area === 'string' ? snap.service_area : undefined;
  const hours_of_operation = typeof snap.hours_of_operation === 'string' ? snap.hours_of_operation : undefined;
  const specials_text = typeof snap.specials_text === 'string' ? snap.specials_text : undefined;
  const privacyRaw = snap.privacy_level;
  const privacy_level = (privacyRaw === 'standard' || privacyRaw === 'private' || privacyRaw === 'high_protection')
    ? privacyRaw
    : undefined;
  const profile_image_id = typeof snap.profile_image_id === 'string' ? snap.profile_image_id : undefined;

  return saveProfile(adminId, {
    display_name,
    bio,
    title,
    service_area,
    hours_of_operation,
    specials_text,
    privacy_level,
    profile_image_id,
  });
}

export async function listProfileVersions(adminId: string) {
  const { data: profile } = await supabase
    .schema('ember_halo')
    .from('owner_profiles')
    .select('id')
    .eq('admin_id', adminId)
    .single();

  if (!profile) return [];

  const { data } = await supabase
    .schema('ember_halo')
    .from('owner_profile_versions')
    .select('id, version, saved_at')
    .eq('profile_id', profile.id)
    .order('version', { ascending: false });

  return data ?? [];
}
