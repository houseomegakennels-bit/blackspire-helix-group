-- ============================================================
-- Ember Halo — Migration 002: Stripe Connect + Twilio columns
-- Adds per-admin Stripe Express accounts and Twilio routing.
-- ============================================================

-- These columns were added to the admins table after initial schema.
-- Already included in 001 for fresh installs, kept here for reference.

-- stripe_account_id  TEXT UNIQUE  -- Stripe Express connected account ID
-- stripe_onboarded   BOOLEAN      -- true once details_submitted + charges_enabled + payouts_enabled
-- twilio_phone_number TEXT         -- admin's outbound Twilio number (routes inbound SMS back to correct admin)

-- If upgrading from an older install that lacks these columns:
ALTER TABLE ember_halo.admins
  ADD COLUMN IF NOT EXISTS stripe_account_id   TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS stripe_onboarded    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS twilio_phone_number TEXT;

-- Index for fast Twilio → admin lookup on every inbound SMS
CREATE INDEX IF NOT EXISTS admins_twilio_number_idx
  ON ember_halo.admins(twilio_phone_number)
  WHERE twilio_phone_number IS NOT NULL;

-- sms_opt_out flag on conversations (STOP command compliance)
ALTER TABLE ember_halo.conversations
  ADD COLUMN IF NOT EXISTS sms_opt_out BOOLEAN NOT NULL DEFAULT false;
