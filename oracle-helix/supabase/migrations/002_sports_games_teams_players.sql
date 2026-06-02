-- ============================================================
-- ORACLE HELIX — Migration 002: Sports, Games, Teams, Players
-- ============================================================

-- Sport keys
CREATE TYPE sport_key AS ENUM (
  'NBA', 'NFL', 'MLB', 'NHL', 'WNBA', 'PGA',
  'UFC', 'SOCCER', 'NCAA_BB', 'NCAA_FB', 'TENNIS', 'NASCAR', 'ESPORTS'
);

-- Game status
CREATE TYPE game_status AS ENUM (
  'scheduled', 'live', 'halftime', 'final', 'postponed', 'canceled', 'suspended'
);

-- ---- SPORTS -------------------------------------------------
CREATE TABLE sports (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key         sport_key UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  league      TEXT NOT NULL,
  season_type TEXT,                         -- regular, playoffs, preseason
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  config      JSONB NOT NULL DEFAULT '{}'   -- sport-specific config
);

INSERT INTO sports (key, name, league, season_type) VALUES
  ('NBA', 'Basketball', 'NBA', 'regular'),
  ('NFL', 'Football', 'NFL', 'regular'),
  ('MLB', 'Baseball', 'MLB', 'regular'),
  ('NHL', 'Hockey', 'NHL', 'regular'),
  ('WNBA', 'Basketball', 'WNBA', 'regular'),
  ('PGA', 'Golf', 'PGA Tour', 'regular');

-- ---- TEAMS --------------------------------------------------
CREATE TABLE teams (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport           sport_key NOT NULL,
  external_id     TEXT,                    -- ESPN/league API ID
  abbreviation    TEXT NOT NULL,
  name            TEXT NOT NULL,
  city            TEXT NOT NULL,
  full_name       TEXT GENERATED ALWAYS AS (city || ' ' || name) STORED,
  conference      TEXT,
  division        TEXT,
  logo_url        TEXT,
  primary_color   TEXT,
  secondary_color TEXT,
  stadium_id      UUID,                    -- FK added after stadiums table
  timezone        TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(sport, abbreviation)
);

-- ---- STADIUMS -----------------------------------------------
CREATE TABLE stadiums (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  city          TEXT NOT NULL,
  state         TEXT,
  country       TEXT NOT NULL DEFAULT 'USA',
  is_dome       BOOLEAN NOT NULL DEFAULT FALSE,
  capacity      INTEGER,
  surface       TEXT,                        -- grass, turf, hardwood, ice
  latitude      DECIMAL(10,7),
  longitude     DECIMAL(10,7),
  elevation_ft  INTEGER,
  sport         sport_key,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE teams ADD CONSTRAINT fk_teams_stadium
  FOREIGN KEY (stadium_id) REFERENCES stadiums(id);

-- ---- PLAYERS ------------------------------------------------
CREATE TABLE players (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport           sport_key NOT NULL,
  team_id         UUID REFERENCES teams(id),
  external_id     TEXT,                    -- ESPN/league API ID
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  full_name       TEXT GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED,
  position        TEXT,
  jersey_number   TEXT,
  height_inches   INTEGER,
  weight_lbs      INTEGER,
  age             INTEGER,
  birth_date      DATE,
  college         TEXT,
  draft_year      INTEGER,
  draft_pick      INTEGER,
  status          TEXT NOT NULL DEFAULT 'active',  -- active, injured, inactive
  headshot_url    TEXT,
  salary          BIGINT,
  contract_years  INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- PLAYER INJURIES ----------------------------------------
CREATE TABLE player_injuries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id       UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  game_id         UUID,                     -- FK added after games table
  injury_type     TEXT NOT NULL,
  body_part       TEXT,
  status          TEXT NOT NULL,            -- out, doubtful, questionable, probable
  description     TEXT,
  reported_at     TIMESTAMPTZ NOT NULL,
  expected_return DATE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- GAMES --------------------------------------------------
CREATE TABLE games (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sport               sport_key NOT NULL,
  external_id         TEXT UNIQUE,          -- ESPN/league API ID
  season              TEXT NOT NULL,        -- '2024-25', '2025'
  season_type         TEXT NOT NULL DEFAULT 'regular',
  week                INTEGER,              -- NFL week number
  home_team_id        UUID NOT NULL REFERENCES teams(id),
  away_team_id        UUID NOT NULL REFERENCES teams(id),
  stadium_id          UUID REFERENCES stadiums(id),
  status              game_status NOT NULL DEFAULT 'scheduled',
  scheduled_at        TIMESTAMPTZ NOT NULL,
  started_at          TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ,
  home_score          INTEGER,
  away_score          INTEGER,
  period              INTEGER,              -- quarter, inning, period
  period_time         TEXT,                 -- time remaining in period
  broadcasts          TEXT[],              -- ['ESPN', 'TNT']
  national_broadcast  TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE player_injuries ADD CONSTRAINT fk_injury_game
  FOREIGN KEY (game_id) REFERENCES games(id);

-- ---- GAME STATS (box scores) ---------------------------------
CREATE TABLE game_stats (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  team_id     UUID NOT NULL REFERENCES teams(id),
  stats       JSONB NOT NULL DEFAULT '{}',  -- sport-specific box score stats
  is_home     BOOLEAN NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(game_id, team_id)
);

-- ---- PLAYER GAME STATS --------------------------------------
CREATE TABLE player_game_stats (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id     UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id   UUID NOT NULL REFERENCES players(id),
  team_id     UUID NOT NULL REFERENCES teams(id),
  stats       JSONB NOT NULL DEFAULT '{}',  -- sport-specific player stats
  started     BOOLEAN NOT NULL DEFAULT FALSE,
  minutes     DECIMAL(5,2),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(game_id, player_id)
);

-- ---- MLB ADVANCED ANALYTICS ---------------------------------
CREATE TABLE mlb_pitch_data (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         UUID REFERENCES games(id),
  pitcher_id      UUID NOT NULL REFERENCES players(id),
  game_date       DATE NOT NULL,
  pitch_type      TEXT NOT NULL,            -- FF, SL, CH, CU, SI, FC, KC
  pitch_pct       DECIMAL(5,2),
  avg_velocity    DECIMAL(5,2),
  max_velocity    DECIMAL(5,2),
  avg_spin_rate   INTEGER,
  whiff_rate      DECIMAL(5,2),
  called_strike_rate DECIMAL(5,2),
  ground_ball_rate   DECIMAL(5,2),
  hard_hit_rate      DECIMAL(5,2),
  xba             DECIMAL(5,3),
  xslg            DECIMAL(5,3),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE mlb_park_factors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stadium_id      UUID NOT NULL REFERENCES stadiums(id),
  season          TEXT NOT NULL,
  overall_factor  DECIMAL(6,3) NOT NULL DEFAULT 1.0,
  runs_factor     DECIMAL(6,3),
  hr_factor       DECIMAL(6,3),
  hits_factor     DECIMAL(6,3),
  k_factor        DECIMAL(6,3),
  hand            TEXT NOT NULL DEFAULT 'both',  -- L, R, both
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(stadium_id, season, hand)
);

CREATE TABLE mlb_spray_charts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id   UUID NOT NULL REFERENCES players(id),
  game_id     UUID REFERENCES games(id),
  hit_x       DECIMAL(7,3),
  hit_y       DECIMAL(7,3),
  hit_type    TEXT,         -- single, double, triple, HR, out
  exit_velo   DECIMAL(5,2),
  launch_angle DECIMAL(5,2),
  distance_ft  INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- TRIGGERS -----------------------------------------------
CREATE TRIGGER teams_updated_at BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER players_updated_at BEFORE UPDATE ON players
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER games_updated_at BEFORE UPDATE ON games
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---- RLS ----------------------------------------------------
ALTER TABLE sports ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE stadiums ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_injuries ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_game_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE mlb_pitch_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE mlb_park_factors ENABLE ROW LEVEL SECURITY;
ALTER TABLE mlb_spray_charts ENABLE ROW LEVEL SECURITY;

-- All sports data is read-only for authenticated users; writes are service-role only
CREATE POLICY "Authenticated read sports" ON sports FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Authenticated read teams" ON teams FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Authenticated read stadiums" ON stadiums FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Authenticated read players" ON players FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Authenticated read injuries" ON player_injuries FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Authenticated read games" ON games FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Authenticated read game_stats" ON game_stats FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Authenticated read player_game_stats" ON player_game_stats FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Authenticated read mlb_pitch_data" ON mlb_pitch_data FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Authenticated read mlb_park_factors" ON mlb_park_factors FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Authenticated read mlb_spray_charts" ON mlb_spray_charts FOR SELECT TO authenticated USING (TRUE);

-- ---- INDEXES ------------------------------------------------
CREATE INDEX idx_games_sport ON games(sport);
CREATE INDEX idx_games_scheduled_at ON games(scheduled_at);
CREATE INDEX idx_games_status ON games(status);
CREATE INDEX idx_games_home_team ON games(home_team_id);
CREATE INDEX idx_games_away_team ON games(away_team_id);
CREATE INDEX idx_players_sport ON players(sport);
CREATE INDEX idx_players_team ON players(team_id);
CREATE INDEX idx_player_injuries_player ON player_injuries(player_id);
CREATE INDEX idx_player_injuries_active ON player_injuries(is_active);
CREATE INDEX idx_player_game_stats_game ON player_game_stats(game_id);
CREATE INDEX idx_player_game_stats_player ON player_game_stats(player_id);
CREATE INDEX idx_mlb_pitch_data_pitcher ON mlb_pitch_data(pitcher_id);
CREATE INDEX idx_mlb_spray_charts_player ON mlb_spray_charts(player_id);
