-- ============================================================
-- ORACLE HELIX — Migration 004: AI Intelligence, BetDNA & Simulations
-- ============================================================

-- ---- AI MEMORIES (persistent per-user AI context) -----------
CREATE TABLE ai_memories (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  memory_type     TEXT NOT NULL,           -- 'preference', 'pattern', 'history', 'strength'
  sport           sport_key,               -- NULL = cross-sport
  key             TEXT NOT NULL,
  value           JSONB NOT NULL,
  confidence      DECIMAL(5,3) NOT NULL DEFAULT 1.0,
  source          TEXT,                    -- 'user_stated', 'inferred', 'observed'
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, memory_type, key)
);

-- ---- AI SESSIONS (conversation history) ---------------------
CREATE TABLE ai_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  agent_type      TEXT NOT NULL DEFAULT 'research', -- research, risk, market, prop, weather, narrative, simulation, coach
  title           TEXT,
  messages        JSONB NOT NULL DEFAULT '[]',   -- [{role, content, timestamp}]
  context         JSONB NOT NULL DEFAULT '{}',   -- game_ids, player_ids, etc.
  token_count     INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- AI RESEARCH CARDS (generated intelligence) -------------
CREATE TABLE ai_research_cards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES profiles(id) ON DELETE SET NULL,  -- NULL = global card
  game_id         UUID REFERENCES games(id) ON DELETE CASCADE,
  player_id       UUID REFERENCES players(id) ON DELETE CASCADE,
  team_id         UUID REFERENCES teams(id) ON DELETE CASCADE,
  card_type       TEXT NOT NULL,           -- 'game_preview', 'player_profile', 'matchup', 'trend'
  sport           sport_key,
  title           TEXT NOT NULL,
  headline        TEXT NOT NULL,
  content         TEXT NOT NULL,
  insights        JSONB NOT NULL DEFAULT '[]',  -- [{key, value, confidence}]
  tags            TEXT[] NOT NULL DEFAULT '{}',
  agent_type      TEXT,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,
  is_featured     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- NARRATIVE INTELLIGENCE ---------------------------------
CREATE TABLE narrative_intelligence (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         UUID REFERENCES games(id) ON DELETE CASCADE,
  player_id       UUID REFERENCES players(id),
  team_id         UUID REFERENCES teams(id),
  narrative_type  TEXT NOT NULL,           -- 'revenge_game', 'hot_streak', 'cold_streak', 'spotlight', 'underdog'
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  sentiment_score DECIMAL(5,3),            -- -1.0 to 1.0
  hype_score      DECIMAL(5,3),            -- 0.0 to 1.0 media hype level
  bias_warning    BOOLEAN NOT NULL DEFAULT FALSE,  -- flag if narrative may bias market
  keywords        TEXT[] NOT NULL DEFAULT '{}',
  sources         JSONB NOT NULL DEFAULT '[]',
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- SOCIAL SENTIMENT ----------------------------------------
CREATE TABLE social_sentiment (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         UUID REFERENCES games(id) ON DELETE CASCADE,
  player_id       UUID REFERENCES players(id),
  team_id         UUID REFERENCES teams(id),
  platform        TEXT NOT NULL,           -- 'twitter', 'reddit', 'instagram'
  sentiment_score DECIMAL(5,3) NOT NULL,   -- -1.0 to 1.0
  volume_score    DECIMAL(5,3),            -- relative post volume
  trending_score  DECIMAL(5,3),            -- momentum of sentiment
  sample_size     INTEGER,
  keywords        TEXT[] NOT NULL DEFAULT '{}',
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- MATCHUP REPORTS ----------------------------------------
CREATE TABLE matchup_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id         UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  report_type     TEXT NOT NULL DEFAULT 'full',    -- 'full', 'quick', 'props_focus'
  offensive_edge  TEXT,                            -- home, away, even
  defensive_edge  TEXT,
  home_win_prob   DECIMAL(6,4),
  away_win_prob   DECIMAL(6,4),
  over_prob       DECIMAL(6,4),
  under_prob      DECIMAL(6,4),
  key_matchups    JSONB NOT NULL DEFAULT '[]',     -- [{player_vs, advantage, description}]
  ats_trends      JSONB NOT NULL DEFAULT '{}',     -- {home: {record, pct}, away: ...}
  fatigue_score   JSONB NOT NULL DEFAULT '{}',     -- {home: 0.8, away: 0.3}
  travel_score    JSONB NOT NULL DEFAULT '{}',     -- {home: 0, away: 2}  -- travel days
  coaching_notes  TEXT,
  environment_score DECIMAL(5,3),                  -- 0-1 home field advantage weight
  weather_impact  DECIMAL(5,3),
  summary         TEXT NOT NULL,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- BETDNA PROFILES ----------------------------------------
CREATE TABLE betdna_profiles (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  sport                   sport_key,              -- NULL = overall profile
  total_bets_tracked      INTEGER NOT NULL DEFAULT 0,
  wins                    INTEGER NOT NULL DEFAULT 0,
  losses                  INTEGER NOT NULL DEFAULT 0,
  pushes                  INTEGER NOT NULL DEFAULT 0,
  roi_pct                 DECIMAL(8,4) NOT NULL DEFAULT 0,
  roi_by_market           JSONB NOT NULL DEFAULT '{}',  -- {spread: roi, total: roi, ...}
  roi_by_sport            JSONB NOT NULL DEFAULT '{}',
  avg_odds                DECIMAL(8,3),
  closing_line_value_avg  DECIMAL(8,4),            -- CLV average
  tilt_score              DECIMAL(5,3) NOT NULL DEFAULT 0,    -- 0 = calm, 1 = tilting
  emotional_patterns      JSONB NOT NULL DEFAULT '{}',        -- detected patterns
  discipline_score        DECIMAL(5,3) NOT NULL DEFAULT 0.5,  -- 0-1
  confidence_accuracy     DECIMAL(5,3),            -- how well confidence matches results
  hot_streak_flag         BOOLEAN NOT NULL DEFAULT FALSE,
  cold_streak_flag        BOOLEAN NOT NULL DEFAULT FALSE,
  best_market             TEXT,
  worst_market            TEXT,
  peak_performance_time   TEXT,                    -- 'morning', 'afternoon', 'evening'
  last_updated            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, sport)
);

-- ---- BET TRACKER (NOT wagering — user tracks their own bets) -
CREATE TABLE bet_tracker (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  game_id         UUID REFERENCES games(id),
  player_id       UUID REFERENCES players(id),
  sportsbook_id   UUID REFERENCES sportsbooks(id),
  sport           sport_key NOT NULL,
  market          market_type NOT NULL,
  selection       TEXT NOT NULL,           -- what they bet on
  odds            INTEGER NOT NULL,
  point           DECIMAL(5,2),
  stake           DECIMAL(10,2),           -- units or dollar amount
  stake_type      TEXT NOT NULL DEFAULT 'units',  -- 'units', 'dollars'
  result          TEXT,                    -- NULL = pending, 'win', 'loss', 'push', 'void'
  profit_loss     DECIMAL(10,2),
  closing_odds    INTEGER,                 -- odds at game start (CLV calc)
  confidence_level INTEGER,               -- 1-5 user confidence at time of bet
  notes           TEXT,
  bet_placed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  game_starts_at  TIMESTAMPTZ,
  settled_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- SIMULATIONS --------------------------------------------
CREATE TABLE simulations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID REFERENCES profiles(id) ON DELETE SET NULL,
  game_id         UUID REFERENCES games(id),
  player_id       UUID REFERENCES players(id),
  sim_type        TEXT NOT NULL,           -- 'game', 'prop', 'lineup', 'weather', 'injury', 'scenario'
  sport           sport_key NOT NULL,
  iterations      INTEGER NOT NULL DEFAULT 10000,
  parameters      JSONB NOT NULL DEFAULT '{}',  -- simulation input params
  results         JSONB NOT NULL DEFAULT '{}',  -- outcome distributions
  home_win_prob   DECIMAL(6,4),
  away_win_prob   DECIMAL(6,4),
  over_prob       DECIMAL(6,4),
  confidence_interval JSONB,              -- {low: x, high: x, pct: 95}
  probability_curve   JSONB,              -- [{score, probability}]
  scenario_tree       JSONB,              -- branching outcome scenarios
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending, running, complete, error
  run_time_ms     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

-- ---- ALERTS -------------------------------------------------
CREATE TABLE alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  alert_type      TEXT NOT NULL,           -- 'line_move', 'sharp_action', 'injury', 'ev_threshold', 'weather', 'narrative'
  sport           sport_key,
  game_id         UUID REFERENCES games(id),
  player_id       UUID REFERENCES players(id),
  conditions      JSONB NOT NULL DEFAULT '{}',  -- trigger conditions
  channels        JSONB NOT NULL DEFAULT '{"push": true}',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  triggered_count INTEGER NOT NULL DEFAULT 0,
  last_triggered  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE alert_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id    UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  game_id     UUID REFERENCES games(id),
  player_id   UUID REFERENCES players(id),
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}',
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---- TRIGGERS -----------------------------------------------
CREATE TRIGGER ai_memories_updated_at BEFORE UPDATE ON ai_memories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER ai_sessions_updated_at BEFORE UPDATE ON ai_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER bet_tracker_updated_at BEFORE UPDATE ON bet_tracker
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER alerts_updated_at BEFORE UPDATE ON alerts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ---- RLS ----------------------------------------------------
ALTER TABLE ai_memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_research_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE narrative_intelligence ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_sentiment ENABLE ROW LEVEL SECURITY;
ALTER TABLE matchup_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE betdna_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE bet_tracker ENABLE ROW LEVEL SECURITY;
ALTER TABLE simulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own ai_memories" ON ai_memories FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own ai_sessions" ON ai_sessions FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Read global research cards" ON ai_research_cards FOR SELECT TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Authenticated read narrative" ON narrative_intelligence FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "Authenticated read sentiment" ON social_sentiment FOR SELECT TO authenticated USING (TRUE);

CREATE POLICY "Read matchup reports" ON matchup_reports FOR SELECT TO authenticated
  USING (user_id IS NULL OR auth.uid() = user_id);

CREATE POLICY "Users manage own betdna" ON betdna_profiles FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own bet_tracker" ON bet_tracker FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own simulations" ON simulations FOR ALL USING (user_id IS NULL OR auth.uid() = user_id);
CREATE POLICY "Users manage own alerts" ON alerts FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users manage own alert_events" ON alert_events FOR ALL USING (auth.uid() = user_id);

-- ---- INDEXES ------------------------------------------------
CREATE INDEX idx_ai_memories_user ON ai_memories(user_id);
CREATE INDEX idx_ai_memories_type ON ai_memories(memory_type);
CREATE INDEX idx_ai_sessions_user ON ai_sessions(user_id);
CREATE INDEX idx_ai_sessions_active ON ai_sessions(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_research_cards_game ON ai_research_cards(game_id);
CREATE INDEX idx_research_cards_player ON ai_research_cards(player_id);
CREATE INDEX idx_research_cards_type ON ai_research_cards(card_type);
CREATE INDEX idx_narrative_game ON narrative_intelligence(game_id);
CREATE INDEX idx_matchup_reports_game ON matchup_reports(game_id);
CREATE INDEX idx_betdna_user ON betdna_profiles(user_id);
CREATE INDEX idx_bet_tracker_user ON bet_tracker(user_id);
CREATE INDEX idx_bet_tracker_game ON bet_tracker(game_id);
CREATE INDEX idx_simulations_user ON simulations(user_id);
CREATE INDEX idx_simulations_game ON simulations(game_id);
CREATE INDEX idx_simulations_status ON simulations(status);
CREATE INDEX idx_alerts_user ON alerts(user_id);
CREATE INDEX idx_alerts_active ON alerts(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_alert_events_user ON alert_events(user_id);
CREATE INDEX idx_alert_events_unread ON alert_events(is_read) WHERE is_read = FALSE;
