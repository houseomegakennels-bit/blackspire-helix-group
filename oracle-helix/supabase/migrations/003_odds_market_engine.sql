-- ============================================================
-- ORACLE HELIX — Migration 003: Odds, Market & Weather Engine
-- ============================================================

-- ---- SPORTSBOOKS --------------------------------------------
CREATE TABLE sportsbooks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key           TEXT UNIQUE NOT NULL,     -- 'draftkings', 'fanduel', 'betmgm'
  name          TEXT NOT NULL,
  logo_url      TEXT,
  affiliate_url TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  states_legal  TEXT[] NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO sportsbooks (key, name) VALUES
  ('draftkings', 'DraftKings'),
  ('fanduel', 'FanDuel'),
  ('betmgm', 'BetMGM'),
  ('caesars', 'Caesars'),
  ('pointsbet', 'PointsBet'),
  ('bet365', 'Bet365'),
  ('barstool', 'Barstool Sports'),
  ('wynn', 'WynnBET'),
  ('unibet', 'Unibet'),
  ('betrivers', 'BetRivers'),
  ('pinnacle', 'Pinnacle'),
  ('consensus', 'Consensus');  -- virtual "market consensus" book

-- ---- ODDS ---------------------------------------------------
CREATE TYPE market_type AS ENUM (
  'h2h',          -- moneyline
  'spreads',      -- point spread
  'totals',       -- over/under
  'outrights',    -- futures/outrights
  'player_props', -- player prop
  'team_props',   -- team prop
  'alternate_spreads',
  'alternate_totals',
  'first_half',
  'second_half'
);

CREATE TABLE odds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  sportsbook_id   UUID NOT NULL REFERENCES sportsbooks(id),
  market          market_type NOT NULL,
  outcome_name    TEXT NOT NULL,           -- team name, Over, Under, player name
  outcome_type    TEXT NOT NULL,           -- home, away, over, under
  price           INTEGER NOT NULL,        -- American odds (-110, +150)
  point           DECIMAL(5,2),            -- spread/total number
  implied_prob    DECIMAL(7,5),            -- calculated from price
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- LINE MOVEMENT ------------------------------------------
CREATE TABLE line_movement (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  sportsbook_id   UUID NOT NULL REFERENCES sportsbooks(id),
  market          market_type NOT NULL,
  outcome_type    TEXT NOT NULL,
  price_old       INTEGER NOT NULL,
  price_new       INTEGER NOT NULL,
  point_old       DECIMAL(5,2),
  point_new       DECIMAL(5,2),
  moved_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  move_magnitude  DECIMAL(7,3),            -- calculated significance of move
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- PLAYER PROPS -------------------------------------------
CREATE TABLE props (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id       UUID NOT NULL REFERENCES players(id),
  sportsbook_id   UUID NOT NULL REFERENCES sportsbooks(id),
  stat_type       TEXT NOT NULL,           -- 'points', 'rebounds', 'strikeouts', etc.
  line            DECIMAL(6,2) NOT NULL,
  over_price      INTEGER NOT NULL,
  under_price     INTEGER NOT NULL,
  over_prob       DECIMAL(7,5),
  under_prob      DECIMAL(7,5),
  best_book       TEXT,                    -- book with best over odds
  best_book_price INTEGER,
  is_alternate    BOOLEAN NOT NULL DEFAULT FALSE,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- PUBLIC BETTING PERCENTAGES -----------------------------
CREATE TABLE public_betting (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  market          market_type NOT NULL,
  outcome_type    TEXT NOT NULL,           -- home, away, over, under
  bet_pct         DECIMAL(6,3) NOT NULL,   -- % of tickets
  money_pct       DECIMAL(6,3),            -- % of money wagered
  ticket_count    INTEGER,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- SHARP MONEY SIGNALS ------------------------------------
CREATE TABLE sharp_signals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  market          market_type NOT NULL,
  outcome_type    TEXT NOT NULL,
  signal_type     TEXT NOT NULL,           -- 'steam_move', 'reverse_line', 'sharp_fade', 'wiseguy'
  confidence      DECIMAL(5,3) NOT NULL,   -- 0.0 to 1.0
  description     TEXT,
  triggered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- MARKET PSYCHOLOGY SCORES -------------------------------
CREATE TABLE market_psychology (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  market          market_type NOT NULL DEFAULT 'spreads',
  public_fade_signal    BOOLEAN NOT NULL DEFAULT FALSE,
  sharp_consensus       DECIMAL(5,3),       -- 0.0 = all public, 1.0 = all sharp
  line_movement_score   DECIMAL(5,3),       -- magnitude of total movement
  volatility_score      DECIMAL(5,3),       -- how much line has moved
  overreaction_flag     BOOLEAN NOT NULL DEFAULT FALSE,
  narrative_bias_score  DECIMAL(5,3),       -- media/public hype bias
  injury_adjustment     DECIMAL(5,3),       -- adjustment for injury news
  summary               TEXT,               -- AI-generated market summary
  calculated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- EV CALCULATIONS ----------------------------------------
CREATE TABLE ev_calculations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id       UUID REFERENCES players(id),  -- NULL = game bet
  sportsbook_id   UUID NOT NULL REFERENCES sportsbooks(id),
  market          market_type NOT NULL,
  outcome_type    TEXT NOT NULL,
  price           INTEGER NOT NULL,
  no_vig_prob     DECIMAL(7,5),            -- true probability (vig removed)
  ev_pct          DECIMAL(7,4),            -- expected value %
  kelly_fraction  DECIMAL(7,5),            -- Kelly criterion fraction
  is_positive_ev  BOOLEAN NOT NULL DEFAULT FALSE,
  calculated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- WEATHER DATA -------------------------------------------
CREATE TABLE weather_data (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  stadium_id      UUID REFERENCES stadiums(id),
  forecast_time   TIMESTAMPTZ NOT NULL,
  temperature_f   DECIMAL(5,2),
  feels_like_f    DECIMAL(5,2),
  humidity_pct    INTEGER,
  wind_speed_mph  DECIMAL(6,2),
  wind_direction  TEXT,                    -- 'NNW', 'SE', etc.
  wind_gust_mph   DECIMAL(6,2),
  precipitation_in DECIMAL(6,3),
  precip_chance   INTEGER,                 -- % chance
  cloud_cover_pct INTEGER,
  condition       TEXT,                    -- 'clear', 'cloudy', 'rain', 'snow'
  air_density     DECIMAL(8,5),
  dew_point_f     DECIMAL(5,2),
  impact_score    DECIMAL(5,3),            -- 0-1 weather impact on game
  impact_summary  TEXT,                    -- AI-generated impact description
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- ARBITRAGE OPPORTUNITIES --------------------------------
CREATE TABLE arbitrage_opportunities (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  market          market_type NOT NULL,
  book_1_id       UUID NOT NULL REFERENCES sportsbooks(id),
  book_2_id       UUID NOT NULL REFERENCES sportsbooks(id),
  outcome_1       TEXT NOT NULL,
  outcome_2       TEXT NOT NULL,
  price_1         INTEGER NOT NULL,
  price_2         INTEGER NOT NULL,
  arb_pct         DECIMAL(7,4) NOT NULL,   -- guaranteed profit %
  expires_at      TIMESTAMPTZ,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- RLS ----------------------------------------------------
ALTER TABLE sportsbooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE odds ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_movement ENABLE ROW LEVEL SECURITY;
ALTER TABLE props ENABLE ROW LEVEL SECURITY;
ALTER TABLE public_betting ENABLE ROW LEVEL SECURITY;
ALTER TABLE sharp_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_psychology ENABLE ROW LEVEL SECURITY;
ALTER TABLE ev_calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE weather_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE arbitrage_opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read sportsbooks" ON sportsbooks FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Authenticated read odds" ON odds FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Authenticated read line_movement" ON line_movement FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Authenticated read props" ON props FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Authenticated read public_betting" ON public_betting FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Authenticated read sharp_signals" ON sharp_signals FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Authenticated read market_psychology" ON market_psychology FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Authenticated read ev_calculations" ON ev_calculations FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Authenticated read weather_data" ON weather_data FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Authenticated read arb_opportunities" ON arbitrage_opportunities FOR SELECT TO authenticated USING (TRUE);

-- ---- INDEXES ------------------------------------------------
CREATE INDEX idx_odds_game_id ON odds(game_id);
CREATE INDEX idx_odds_sportsbook ON odds(sportsbook_id);
CREATE INDEX idx_odds_market ON odds(market);
CREATE INDEX idx_odds_fetched_at ON odds(fetched_at DESC);
CREATE INDEX idx_line_movement_game ON line_movement(game_id);
CREATE INDEX idx_line_movement_moved_at ON line_movement(moved_at DESC);
CREATE INDEX idx_props_game ON props(game_id);
CREATE INDEX idx_props_player ON props(player_id);
CREATE INDEX idx_props_stat_type ON props(stat_type);
CREATE INDEX idx_sharp_signals_game ON sharp_signals(game_id);
CREATE INDEX idx_sharp_signals_triggered ON sharp_signals(triggered_at DESC);
CREATE INDEX idx_ev_calculations_positive ON ev_calculations(is_positive_ev) WHERE is_positive_ev = TRUE;
CREATE INDEX idx_weather_game ON weather_data(game_id);
CREATE INDEX idx_arb_active ON arbitrage_opportunities(is_active) WHERE is_active = TRUE;
