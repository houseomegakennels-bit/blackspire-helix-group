/**
 * Ember Halo — First-Run Seed
 * Run once: npx tsx src/lib/seed.ts
 * Creates the first admin account, persona, and standard package set.
 * Requires SUPABASE_SERVICE_ROLE_KEY in env.
 */

import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function seed() {
  console.log('Seeding Ember Halo first admin...');

  // ── 1. Create admin record ────────────────────────────────
  // auth_user_id is null until the admin signs in via Supabase Auth
  // In production: create the Supabase Auth user first, then link via auth_user_id

  const { data: admin, error: adminError } = await supabase
    .schema('ember_halo')
    .from('admins')
    .insert({
      role: 'owner',
      display_name: 'Owner',
      business_alias: 'Ember Halo',
      legal_email: process.env.FIRST_ADMIN_EMAIL ?? 'admin@emberhalo.com',
      is_active: true,
      is_online: false,
      active_city: 'Charlotte',
    })
    .select('id')
    .single();

  if (adminError) {
    console.error('Admin seed failed:', adminError.message);
    process.exit(1);
  }

  console.log(`Admin created: ${admin.id}`);

  // ── 2. Create persona ─────────────────────────────────────

  const { error: personaError } = await supabase
    .schema('ember_halo')
    .from('admin_personas')
    .insert({
      admin_id: admin.id,
      customer_facing_name: 'Nyla',
      persona_style: 'sophisticated',
      flirtation_level: 'medium',
      preferred_pet_names: ['baby', 'handsome'],
      active_city: 'Charlotte',
      hours_of_operation: {
        mon: '17:00-23:00',
        tue: '17:00-23:00',
        wed: '17:00-23:00',
        thu: '17:00-23:00',
        fri: '17:00-00:00',
        sat: '14:00-00:00',
        sun: '14:00-23:00',
      },
      is_active: true,
    });

  if (personaError) console.error('Persona seed error:', personaError.message);
  else console.log('Persona "Nyla" created.');

  // ── 3. Create location controls ───────────────────────────

  await supabase
    .schema('ember_halo')
    .from('admin_location_controls')
    .insert({
      admin_id: admin.id,
      active_cities: ['Charlotte'],
      online_status: false,
      travel_mode_enabled: false,
      rush_hour_enabled: false,
    });

  console.log('Location controls created.');

  // ── 4. Seed standard packages ─────────────────────────────
  // Prices are placeholders — admin edits these from dashboard

  const packages = [
    { package_name: '15 Roses', rose_count: 15, pickup_price: 65.00,  delivery_price: 85.00  },
    { package_name: '30 Roses', rose_count: 30, pickup_price: 110.00, delivery_price: 135.00 },
    { package_name: '100 Roses', rose_count: 100, pickup_price: 275.00, delivery_price: 315.00 },
    { package_name: '200 Roses', rose_count: 200, pickup_price: 475.00, delivery_price: 525.00 },
    {
      package_name: '200+ Custom',
      rose_count: 999,
      pickup_price: 0.00,
      delivery_price: 0.00,
      custom_quote_required: true,
    },
  ];

  const { error: pkgError } = await supabase
    .schema('ember_halo')
    .from('packages')
    .insert(packages.map(p => ({ ...p, admin_id: admin.id, is_active: true })));

  if (pkgError) console.error('Package seed error:', pkgError.message);
  else console.log(`${packages.length} packages created.`);

  // ── 5. Seed default notification preferences ──────────────

  const events = [
    'conversation_started',
    'special_request_created',
    'booking_confirmed',
    'payment_failed',
    'screenshot_event',
    'review_eligible',
  ];

  await supabase
    .schema('ember_halo')
    .from('notification_preferences')
    .insert(
      events.map(event => ({
        admin_id: admin.id,
        event_type: event,
        channel: 'both',
        is_enabled: true,
      }))
    );

  console.log('Notification preferences seeded.');

  console.log('\n✓ Seed complete.');
  console.log(`Admin ID: ${admin.id}`);
  console.log('Next: create a Supabase Auth user and set auth_user_id on this admin record.');
  console.log('Next: run Stripe Connect onboarding via POST /api/admin/stripe/onboard');
}

seed().catch(console.error);
