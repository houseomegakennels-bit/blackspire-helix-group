# Ember Halo — Supabase Schema

## Project
- **Project ID:** `kchtrvfcixnimvxxctkj`
- **Schema:** `ember_halo` (all tables live in this schema, not `public`)
- **URL:** `https://kchtrvfcixnimvxxctkj.supabase.co`

## Apply Migrations (Fresh Setup)

1. Open **Supabase Dashboard → SQL Editor**
2. Run each migration file in order:
   ```
   001_ember_halo_core_schema.sql   ← Full schema (30 tables, RLS enabled)
   002_ember_halo_stripe_twilio.sql ← Stripe Connect + Twilio columns (idempotent)
   003_ember_halo_n8n_columns.sql   ← n8n workflow support columns (idempotent)
   ```
3. Create the Storage bucket:
   - Dashboard → Storage → New bucket
   - Name: `ember-halo-media`
   - Public: **OFF** (all media served via signed URLs)

Migrations 002 and 003 use `ADD COLUMN IF NOT EXISTS` — safe to re-run on an existing install.

## After Schema Setup

1. Run the seed script: `npm run seed`
2. Create a Supabase Auth user for the admin
3. Link via: `UPDATE ember_halo.admins SET auth_user_id = '<auth-uid>' WHERE legal_email = 'your@email.com'`

## RLS Policy

All tables have RLS enabled. The backend uses the **service role key** which bypasses RLS entirely. The frontend (anon key) has **no direct table access** — all operations go through the backend API.

Never expose the service role key to the frontend.

## Storage

Bucket: `ember-halo-media`
- All images stored as `{admin_id}/{uuid}.jpg`
- Served via 5-minute expiring signed URLs (`getSignedMediaUrl` in `src/lib/media.ts`)
- EXIF stripped on upload via `sharp`
- Optional session watermark applied at upload time
