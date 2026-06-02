-- ============================================================
-- ORACLE HELIX — Migration 001: Users, Profiles & Subscriptions
-- ============================================================

-- Subscription tiers
CREATE TYPE subscription_tier AS ENUM ('free', 'starter', 'pro', 'elite', 'enterprise');

-- User roles
CREATE TYPE app_role AS ENUM ('user', 'admin', 'analyst');

-- Risk tolerance
CREATE TYPE risk_tolerance AS ENUM ('conservative', 'moderate', 'aggressive');

-- ---- PROFILES -----------------------------------------------
CREATE TABLE profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           TEXT UNIQUE NOT NULL,
  display_name    TEXT,
  avatar_url      TEXT,
  role            app_role NOT NULL DEFAULT 'user',
  risk_tolerance  risk_tolerance NOT NULL DEFAULT 'moderate',
  timezone        TEXT NOT NULL DEFAULT 'America/New_York',
  onboarding_done BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- SUBSCRIPTIONS ------------------------------------------
CREATE TABLE subscriptions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  tier                subscription_tier NOT NULL DEFAULT 'free',
  status              TEXT NOT NULL DEFAULT 'active', -- active, canceled, past_due, trialing
  stripe_customer_id  TEXT,
  stripe_sub_id       TEXT,
  current_period_start TIMESTAMPTZ,
  current_period_end   TIMESTAMPTZ,
  trial_ends_at       TIMESTAMPTZ,
  canceled_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ---- USER PREFERENCES ---------------------------------------
CREATE TABLE user_preferences (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  favorite_sports     TEXT[] NOT NULL DEFAULT '{}',   -- ['NBA','NFL','MLB']
  favorite_teams      JSONB NOT NULL DEFAULT '{}',    -- {NBA: ['LAL','BOS'], NFL: ['KC']}
  favorite_players    TEXT[] NOT NULL DEFAULT '{}',
  preferred_markets   TEXT[] NOT NULL DEFAULT '{}',   -- ['spread','total','player_props']
  default_sportsbook  TEXT,
  ui_theme            TEXT NOT NULL DEFAULT 'dark',
  dashboard_layout    JSONB NOT NULL DEFAULT '{}',
  alert_channels      JSONB NOT NULL DEFAULT '{"email": true, "push": true}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ---- SAVED LAYOUTS (War Room) --------------------------------
CREATE TABLE saved_layouts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  layout_data JSONB NOT NULL DEFAULT '{}',  -- widget positions, sizes, configs
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  sport_focus TEXT,                          -- NULL = all sports
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- USER ROLES ---------------------------------------------
CREATE TABLE user_roles (
  id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role    app_role NOT NULL,
  UNIQUE(user_id, role)
);

-- ---- TRIGGERS -----------------------------------------------
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  INSERT INTO subscriptions (user_id) VALUES (NEW.id);
  INSERT INTO user_preferences (user_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER subscriptions_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER user_preferences_updated_at BEFORE UPDATE ON user_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---- RLS ----------------------------------------------------
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_layouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users read own subscription" ON subscriptions FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users manage own preferences" ON user_preferences FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own layouts" ON saved_layouts FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users read own roles" ON user_roles FOR SELECT USING (auth.uid() = user_id);

-- ---- INDEXES ------------------------------------------------
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_user_preferences_user_id ON user_preferences(user_id);
CREATE INDEX idx_saved_layouts_user_id ON saved_layouts(user_id);
