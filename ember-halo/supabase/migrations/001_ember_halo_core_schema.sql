-- ============================================================
-- Ember Halo — Migration 001: Core Schema
-- All tables in the ember_halo schema.
-- Run on a fresh Supabase project via Dashboard > SQL Editor.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS ember_halo;

-- ── ADMINS ────────────────────────────────────────────────────
-- One row per operator (business owner / concierge).
-- auth_user_id links to Supabase Auth after first login.

CREATE TABLE ember_halo.admins (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id      UUID UNIQUE,                         -- set after Supabase Auth signup
  role              TEXT NOT NULL DEFAULT 'owner',       -- 'owner' | 'collaborator'
  display_name      TEXT NOT NULL,
  business_alias    TEXT,
  legal_email       TEXT UNIQUE NOT NULL,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  is_online         BOOLEAN NOT NULL DEFAULT false,
  active_city       TEXT,
  stripe_account_id TEXT UNIQUE,
  stripe_onboarded  BOOLEAN NOT NULL DEFAULT false,
  twilio_phone_number TEXT,                              -- admin's Twilio outbound number
  notify_sms        TEXT,                                -- admin's personal SMS for alerts
  notify_email      TEXT,                                -- admin's personal email for alerts
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── ADMIN PERSONAS ────────────────────────────────────────────
-- AI concierge identity per admin. Only one active at a time.

CREATE TABLE ember_halo.admin_personas (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id              UUID NOT NULL REFERENCES ember_halo.admins(id) ON DELETE CASCADE,
  customer_facing_name  TEXT NOT NULL,                   -- name the AI uses (e.g., "Nyla")
  persona_style         TEXT NOT NULL,                   -- 'sophisticated'|'playful'|'romantic'|'dominant'|'soft_luxury'|'cold_luxury'
  flirtation_level      TEXT NOT NULL DEFAULT 'medium',  -- 'low'|'medium'|'high'
  preferred_pet_names   TEXT[] NOT NULL DEFAULT '{}',    -- e.g., ['baby', 'handsome']
  active_city           TEXT,
  hours_of_operation    JSONB,                           -- { mon: '17:00-23:00', ... }
  is_active             BOOLEAN NOT NULL DEFAULT false,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX admin_personas_active_idx
  ON ember_halo.admin_personas(admin_id)
  WHERE is_active = true;

-- ── ADMIN LOCATION CONTROLS ───────────────────────────────────
-- Mobile pop-up operator: real-time city / availability switches.

CREATE TABLE ember_halo.admin_location_controls (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id              UUID NOT NULL UNIQUE REFERENCES ember_halo.admins(id) ON DELETE CASCADE,
  active_cities         TEXT[] NOT NULL DEFAULT '{}',
  service_radius_miles  INTEGER,
  travel_mode_enabled   BOOLEAN NOT NULL DEFAULT false,
  online_status         BOOLEAN NOT NULL DEFAULT false,
  rush_hour_enabled     BOOLEAN NOT NULL DEFAULT false,
  holiday_mode          BOOLEAN NOT NULL DEFAULT false,
  availability_until    TIMESTAMPTZ,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── PACKAGES (standard) ───────────────────────────────────────
-- Seeded with 15/30/100/200/200+ tiers. Admin edits prices.

CREATE TABLE ember_halo.packages (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id                 UUID NOT NULL REFERENCES ember_halo.admins(id) ON DELETE CASCADE,
  package_name             TEXT NOT NULL,
  rose_count               INTEGER NOT NULL,
  pickup_price             NUMERIC(10,2) NOT NULL DEFAULT 0,
  delivery_price           NUMERIC(10,2) NOT NULL DEFAULT 0,
  custom_quote_required    BOOLEAN NOT NULL DEFAULT false,
  is_active                BOOLEAN NOT NULL DEFAULT true,
  last_updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated_by_admin_id UUID REFERENCES ember_halo.admins(id)
);

-- ── SPECIAL PACKAGES ─────────────────────────────────────────
-- Time-limited or city-specific packages. Admin-managed.

CREATE TABLE ember_halo.special_packages (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id                 UUID NOT NULL REFERENCES ember_halo.admins(id) ON DELETE CASCADE,
  package_name             TEXT NOT NULL,
  rose_count               INTEGER NOT NULL,
  pickup_price             NUMERIC(10,2),
  delivery_price           NUMERIC(10,2),
  description              TEXT,
  active_city_or_region    TEXT,
  start_date               DATE,
  end_date                 DATE,
  availability_limit       INTEGER,
  remaining_slots          INTEGER,
  is_public                BOOLEAN NOT NULL DEFAULT false,
  is_active                BOOLEAN NOT NULL DEFAULT false,   -- always starts inactive
  requires_admin_approval  BOOLEAN NOT NULL DEFAULT false,
  media_gallery_image_id   UUID,
  last_updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated_by_admin_id UUID REFERENCES ember_halo.admins(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── SCARCITY SETTINGS ────────────────────────────────────────
-- Admin-controlled scarcity messages shown during AI sales.

CREATE TABLE ember_halo.scarcity_settings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID NOT NULL REFERENCES ember_halo.admins(id) ON DELETE CASCADE,
  package_id  UUID REFERENCES ember_halo.packages(id),
  active_city TEXT,
  message     TEXT NOT NULL,
  expires_at  TIMESTAMPTZ,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── CONVERSATIONS ─────────────────────────────────────────────
-- One row per customer session (web or SMS).

CREATE TABLE ember_halo.conversations (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id                UUID NOT NULL REFERENCES ember_halo.admins(id) ON DELETE CASCADE,
  channel                 TEXT NOT NULL DEFAULT 'web',         -- 'web'|'sms'
  customer_alias          TEXT,
  customer_phone          TEXT,
  customer_session_id     TEXT,
  ai_mode                 TEXT NOT NULL DEFAULT 'locked_gate',
  lawful_use_confirmed    BOOLEAN NOT NULL DEFAULT false,
  nda_accepted            BOOLEAN NOT NULL DEFAULT false,
  is_active               BOOLEAN NOT NULL DEFAULT true,
  admin_takeover          BOOLEAN NOT NULL DEFAULT false,
  takeover_admin_id       UUID REFERENCES ember_halo.admins(id),
  customer_classification TEXT,
  special_request_flag    BOOLEAN NOT NULL DEFAULT false,
  sms_opt_out             BOOLEAN NOT NULL DEFAULT false,
  started_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX conversations_admin_active_idx ON ember_halo.conversations(admin_id, is_active);
CREATE INDEX conversations_phone_idx ON ember_halo.conversations(customer_phone) WHERE customer_phone IS NOT NULL;

-- ── MESSAGES ──────────────────────────────────────────────────
-- Full message log per conversation.

CREATE TABLE ember_halo.messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES ember_halo.conversations(id) ON DELETE CASCADE,
  sender          TEXT NOT NULL,                 -- 'customer'|'ai'|'admin'
  content         TEXT NOT NULL,
  ai_mode         TEXT,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX messages_conversation_idx ON ember_halo.messages(conversation_id, sent_at);

-- ── AGREEMENTS ────────────────────────────────────────────────
-- NDA / privacy agreement acceptance log.

CREATE TABLE ember_halo.agreements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES ember_halo.conversations(id) ON DELETE CASCADE,
  session_id      TEXT,
  customer_alias  TEXT,
  customer_phone  TEXT,
  agreement_text  TEXT NOT NULL,
  signed_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── ORDERS ────────────────────────────────────────────────────

CREATE TABLE ember_halo.orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id          UUID NOT NULL REFERENCES ember_halo.admins(id) ON DELETE CASCADE,
  conversation_id   UUID REFERENCES ember_halo.conversations(id),
  package_id        UUID REFERENCES ember_halo.packages(id),
  special_package_id UUID REFERENCES ember_halo.special_packages(id),
  is_custom_quote   BOOLEAN NOT NULL DEFAULT false,
  status            TEXT NOT NULL DEFAULT 'pending_payment',
  final_price       NUMERIC(10,2) NOT NULL,
  fulfillment_type  TEXT NOT NULL DEFAULT 'delivery',    -- 'pickup'|'delivery'
  rose_count        INTEGER,
  rose_color        TEXT,
  anonymous_sender  BOOLEAN NOT NULL DEFAULT false,
  customer_alias    TEXT,
  customer_phone    TEXT,
  delivery_date     DATE,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX orders_conversation_idx ON ember_halo.orders(conversation_id);
CREATE INDEX orders_admin_status_idx ON ember_halo.orders(admin_id, status);

-- ── PAYMENTS ──────────────────────────────────────────────────
-- Stripe PaymentIntent records. webhook_confirmed = source of truth.

CREATE TABLE ember_halo.payments (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL REFERENCES ember_halo.orders(id) ON DELETE CASCADE,
  admin_id            UUID NOT NULL REFERENCES ember_halo.admins(id),
  stripe_payment_id   TEXT UNIQUE NOT NULL,
  stripe_account_id   TEXT NOT NULL,
  amount              NUMERIC(10,2) NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'usd',
  status              TEXT NOT NULL DEFAULT 'pending',   -- 'pending'|'paid'|'failed'|'cancelled'
  webhook_confirmed   BOOLEAN NOT NULL DEFAULT false,    -- ONLY source of truth for paid status
  is_manual_link      BOOLEAN NOT NULL DEFAULT false,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── SCHEDULING RECORDS ────────────────────────────────────────
-- Created automatically when payment_intent.succeeded fires.

CREATE TABLE ember_halo.scheduling_records (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id            UUID NOT NULL REFERENCES ember_halo.orders(id) ON DELETE CASCADE,
  admin_id            UUID NOT NULL REFERENCES ember_halo.admins(id),
  customer_alias      TEXT,
  customer_phone      TEXT,
  package_name        TEXT,
  fulfillment_type    TEXT,
  active_city         TEXT,
  address_or_pickup   TEXT,
  scheduled_date      DATE,
  time_window         TEXT,
  status              TEXT NOT NULL DEFAULT 'confirmed',
  payment_status      TEXT NOT NULL DEFAULT 'paid',
  notes               TEXT,
  special_request_flag BOOLEAN NOT NULL DEFAULT false,
  delivered_at        TIMESTAMPTZ,
  post_followup_sent  BOOLEAN NOT NULL DEFAULT false,
  post_followup_at    TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX scheduling_admin_date_idx ON ember_halo.scheduling_records(admin_id, scheduled_date);
CREATE INDEX scheduling_status_idx ON ember_halo.scheduling_records(status, post_followup_sent);

-- ── SCHEDULING STATUS HISTORY ─────────────────────────────────

CREATE TABLE ember_halo.scheduling_status_history (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduling_record_id   UUID NOT NULL REFERENCES ember_halo.scheduling_records(id) ON DELETE CASCADE,
  previous_status        TEXT,
  new_status             TEXT NOT NULL,
  changed_by_admin_id    UUID REFERENCES ember_halo.admins(id),
  note                   TEXT,
  changed_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── SPECIAL REQUESTS ─────────────────────────────────────────
-- Auto-detected or admin-flagged requests needing personal handling.

CREATE TABLE ember_halo.special_requests (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id        UUID REFERENCES ember_halo.conversations(id),
  admin_id               UUID NOT NULL REFERENCES ember_halo.admins(id),
  order_id               UUID REFERENCES ember_halo.orders(id),
  request_type           TEXT NOT NULL DEFAULT 'auto_detected',
  request_summary        TEXT,
  active_city            TEXT,
  fulfillment_type       TEXT,
  status                 TEXT NOT NULL DEFAULT 'pending',  -- 'pending'|'approved'|'denied'|'quoted'
  admin_action_note      TEXT,
  resolved_by_admin_id   UUID REFERENCES ember_halo.admins(id),
  resolved_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX special_requests_admin_status_idx ON ember_halo.special_requests(admin_id, status);

-- ── CUSTOMER CLASSIFICATIONS ──────────────────────────────────
-- AI behavioral signals per conversation. Feed upsell intensity.

CREATE TABLE ember_halo.customer_classifications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES ember_halo.conversations(id) ON DELETE CASCADE,
  classification   TEXT NOT NULL,
  confidence_score NUMERIC(3,2) NOT NULL,
  detected_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX classifications_conversation_idx ON ember_halo.customer_classifications(conversation_id, detected_at DESC);

-- ── UPSELL EVENTS ────────────────────────────────────────────
-- Log every upsell attempt and whether it converted.

CREATE TABLE ember_halo.upsell_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID REFERENCES ember_halo.conversations(id),
  admin_id         UUID NOT NULL REFERENCES ember_halo.admins(id),
  from_rose_count  INTEGER,
  to_rose_count    INTEGER,
  converted        BOOLEAN NOT NULL DEFAULT false,
  upsell_phrase    TEXT,
  active_city      TEXT,
  persona_style    TEXT,
  recorded_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── VIP CLIENT VAULT ─────────────────────────────────────────
-- Auto-built customer profile from order history. Admin annotates.

CREATE TABLE ember_halo.vip_client_vault (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id              UUID NOT NULL REFERENCES ember_halo.admins(id) ON DELETE CASCADE,
  customer_alias        TEXT NOT NULL DEFAULT 'Unknown',
  customer_phone        TEXT NOT NULL,
  preferred_rose_colors TEXT[] NOT NULL DEFAULT '{}',
  preferred_rose_count  INTEGER,
  preferred_fulfillment TEXT,
  anonymity_preference  BOOLEAN NOT NULL DEFAULT false,
  total_orders          INTEGER NOT NULL DEFAULT 0,
  total_spent           NUMERIC(10,2) NOT NULL DEFAULT 0,
  first_order_date      DATE,
  last_order_date       DATE,
  vip_tag               TEXT,                            -- 'high-value'|'regular'|null
  admin_notes           TEXT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(admin_id, customer_phone)
);

-- ── AUDIT LOGS ────────────────────────────────────────────────
-- Immutable event log. admin_id nullable for system events.

CREATE TABLE ember_halo.audit_logs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     UUID REFERENCES ember_halo.admins(id),    -- nullable for system/Stripe events
  action       TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  metadata     JSONB,
  logged_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX audit_logs_admin_idx ON ember_halo.audit_logs(admin_id, logged_at DESC);

-- ── NOTIFICATION PREFERENCES ──────────────────────────────────

CREATE TABLE ember_halo.notification_preferences (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id      UUID NOT NULL REFERENCES ember_halo.admins(id) ON DELETE CASCADE,
  event_type    TEXT NOT NULL,
  channel       TEXT NOT NULL DEFAULT 'both',       -- 'sms'|'email'|'both'|'none'
  notify_phone  TEXT,
  notify_email  TEXT,
  is_enabled    BOOLEAN NOT NULL DEFAULT true,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(admin_id, event_type)
);

-- ── NOTIFICATION LOG ─────────────────────────────────────────

CREATE TABLE ember_halo.notification_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id         UUID REFERENCES ember_halo.admins(id),
  conversation_id  UUID REFERENCES ember_halo.conversations(id),
  event_type       TEXT NOT NULL,
  channel          TEXT NOT NULL,
  recipient        TEXT,
  message_preview  TEXT,
  success          BOOLEAN NOT NULL DEFAULT true,
  logged_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── REVIEWS ──────────────────────────────────────────────────
-- Only verified buyers (completed orders) can submit reviews.

CREATE TABLE ember_halo.reviews (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id              UUID NOT NULL REFERENCES ember_halo.admins(id) ON DELETE CASCADE,
  order_id              UUID UNIQUE REFERENCES ember_halo.orders(id),  -- one review per order
  scheduling_record_id  UUID REFERENCES ember_halo.scheduling_records(id),
  customer_alias        TEXT,
  star_rating           INTEGER NOT NULL CHECK (star_rating BETWEEN 1 AND 5),
  review_text           TEXT,
  tags                  TEXT[] NOT NULL DEFAULT '{}',
  is_featured           BOOLEAN NOT NULL DEFAULT false,
  is_hidden             BOOLEAN NOT NULL DEFAULT false,
  is_verified           BOOLEAN NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX reviews_admin_idx ON ember_halo.reviews(admin_id, is_hidden, is_featured);

-- ── OWNER PROFILES ────────────────────────────────────────────
-- Public-facing profile page. Admin edits, AI helps write bio.

CREATE TABLE ember_halo.owner_profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id          UUID NOT NULL UNIQUE REFERENCES ember_halo.admins(id) ON DELETE CASCADE,
  display_name      TEXT NOT NULL,
  bio               TEXT,
  title             TEXT,
  service_area      TEXT,
  hours_of_operation TEXT,
  specials_text     TEXT,
  tone              TEXT,
  privacy_level     TEXT NOT NULL DEFAULT 'standard',    -- 'standard'|'private'|'high_protection'
  is_published      BOOLEAN NOT NULL DEFAULT false,
  profile_image_id  UUID,
  version           INTEGER NOT NULL DEFAULT 1,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── OWNER PROFILE VERSIONS ────────────────────────────────────

CREATE TABLE ember_halo.owner_profile_versions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES ember_halo.owner_profiles(id) ON DELETE CASCADE,
  version    INTEGER NOT NULL,
  snapshot   JSONB NOT NULL,
  saved_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── MEDIA GALLERY ────────────────────────────────────────────
-- All admin-uploaded images. Served via expiring signed URLs.

CREATE TABLE ember_halo.media_gallery (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id      UUID NOT NULL REFERENCES ember_halo.admins(id) ON DELETE CASCADE,
  category      TEXT NOT NULL DEFAULT 'luxury_roses',   -- 'luxury_roses'|'owner_profile'|'arrangements'
  storage_path  TEXT NOT NULL,                           -- path in Supabase Storage bucket
  caption       TEXT,
  public_url    TEXT,                                    -- cached signed URL (expires — refresh before serving)
  sort_order    INTEGER NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX media_gallery_admin_idx ON ember_halo.media_gallery(admin_id, is_active, sort_order);

-- ── MEDIA EVENTS ─────────────────────────────────────────────
-- View and screenshot detection events. IPs stored hashed only.

CREATE TABLE ember_halo.media_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id        UUID NOT NULL REFERENCES ember_halo.media_gallery(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES ember_halo.conversations(id),
  event_type      TEXT NOT NULL,                         -- 'viewed'|'screenshot_detected'
  session_id      TEXT,
  ip_hash         TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── COLLABORATIONS ────────────────────────────────────────────
-- Mutual partnership between two admins. Both must approve.

CREATE TABLE ember_halo.collaborations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_admin_id   UUID NOT NULL REFERENCES ember_halo.admins(id),
  receiver_admin_id    UUID NOT NULL REFERENCES ember_halo.admins(id),
  level                TEXT NOT NULL,                    -- 'basic_connection'|'overflow_support'|'calendar_coordination'|'special_request_support'|'city_coverage'|'full_partner'
  status               TEXT NOT NULL DEFAULT 'pending',  -- 'pending'|'active'|'rejected'|'revoked'
  request_note         TEXT,
  requester_revoked    BOOLEAN NOT NULL DEFAULT false,
  receiver_revoked     BOOLEAN NOT NULL DEFAULT false,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── PROVIDERS ────────────────────────────────────────────────
-- Security / support staff directory. Admin-approved before listing.

CREATE TABLE ember_halo.providers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name             TEXT NOT NULL,
  contact_name             TEXT,
  contact_email            TEXT NOT NULL,
  contact_phone            TEXT,
  coverage_cities          TEXT[] NOT NULL DEFAULT '{}',
  service_type             TEXT NOT NULL,                -- 'armed'|'non_armed'
  transportation_available BOOLEAN NOT NULL DEFAULT false,
  hourly_rate_min          NUMERIC(10,2),
  hourly_rate_max          NUMERIC(10,2),
  late_night_available     BOOLEAN NOT NULL DEFAULT false,
  vip_escort_capable       BOOLEAN NOT NULL DEFAULT false,
  verification_status      TEXT NOT NULL DEFAULT 'pending',  -- 'pending'|'approved'|'rejected'
  verified_by_admin_id     UUID REFERENCES ember_halo.admins(id),
  verified_at              TIMESTAMPTZ,
  is_active                BOOLEAN NOT NULL DEFAULT false,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── PROVIDER APPLICATIONS ────────────────────────────────────

CREATE TABLE ember_halo.provider_applications (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name             TEXT NOT NULL,
  contact_name             TEXT,
  contact_email            TEXT NOT NULL,
  contact_phone            TEXT,
  coverage_cities          TEXT[] NOT NULL DEFAULT '{}',
  service_type             TEXT NOT NULL,
  transportation_available BOOLEAN NOT NULL DEFAULT false,
  hourly_rate_min          NUMERIC(10,2),
  hourly_rate_max          NUMERIC(10,2),
  late_night_available     BOOLEAN NOT NULL DEFAULT false,
  vip_escort_capable       BOOLEAN NOT NULL DEFAULT false,
  document_paths           TEXT[],
  status                   TEXT NOT NULL DEFAULT 'pending',
  provider_id              UUID REFERENCES ember_halo.providers(id),
  reviewed_by_admin_id     UUID REFERENCES ember_halo.admins(id),
  reviewed_at              TIMESTAMPTZ,
  submitted_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── ADMIN PROVIDER BOOKMARKS ─────────────────────────────────

CREATE TABLE ember_halo.admin_provider_bookmarks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID NOT NULL REFERENCES ember_halo.admins(id) ON DELETE CASCADE,
  provider_id UUID NOT NULL REFERENCES ember_halo.providers(id) ON DELETE CASCADE,
  notes       TEXT,
  saved_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(admin_id, provider_id)
);

-- ============================================================
-- Row Level Security
-- Enable RLS on all tables but grant full access to service role.
-- Frontend (anon key) has no direct DB access — everything goes
-- through the backend API (service role only).
-- ============================================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'ember_halo'
  LOOP
    EXECUTE format('ALTER TABLE ember_halo.%I ENABLE ROW LEVEL SECURITY', tbl);
    -- Service role bypasses RLS entirely — no explicit policy needed
    -- Add customer-facing policies here if you ever expose tables via anon key
  END LOOP;
END $$;

-- ============================================================
-- Storage bucket (run once, or create in Supabase dashboard)
-- ============================================================
-- INSERT INTO storage.buckets (id, name, public)
-- VALUES ('ember-halo-media', 'ember-halo-media', false)
-- ON CONFLICT (id) DO NOTHING;
