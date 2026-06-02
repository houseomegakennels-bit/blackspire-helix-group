-- ============================================================
-- ORACLE HELIX — Migration 005: Realtime + Helper Functions
-- ============================================================

-- ---- ENABLE REALTIME ----------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE games;
ALTER PUBLICATION supabase_realtime ADD TABLE odds;
ALTER PUBLICATION supabase_realtime ADD TABLE line_movement;
ALTER PUBLICATION supabase_realtime ADD TABLE props;
ALTER PUBLICATION supabase_realtime ADD TABLE sharp_signals;
ALTER PUBLICATION supabase_realtime ADD TABLE player_injuries;
ALTER PUBLICATION supabase_realtime ADD TABLE alert_events;
ALTER PUBLICATION supabase_realtime ADD TABLE simulations;
ALTER PUBLICATION supabase_realtime ADD TABLE market_psychology;

-- ---- HELPER: role check (consistent with Buyer Engine pattern)
CREATE OR REPLACE FUNCTION public.has_role(user_id UUID, check_role app_role)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = has_role.user_id
      AND user_roles.role = has_role.check_role
  );
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- ---- HELPER: get today's games for a sport ------------------
CREATE OR REPLACE FUNCTION get_todays_games(p_sport sport_key DEFAULT NULL)
RETURNS SETOF games AS $$
  SELECT * FROM games
  WHERE DATE(scheduled_at AT TIME ZONE 'America/New_York') = CURRENT_DATE
    AND (p_sport IS NULL OR sport = p_sport)
    AND status NOT IN ('canceled', 'postponed')
  ORDER BY scheduled_at ASC;
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- ---- HELPER: get best odds across books for a game ----------
CREATE OR REPLACE FUNCTION get_best_odds(p_game_id UUID, p_market market_type DEFAULT 'spreads')
RETURNS TABLE (
  outcome_type    TEXT,
  best_price      INTEGER,
  sportsbook_name TEXT,
  point           DECIMAL
) AS $$
  SELECT DISTINCT ON (o.outcome_type)
    o.outcome_type,
    o.price AS best_price,
    s.name  AS sportsbook_name,
    o.point
  FROM odds o
  JOIN sportsbooks s ON s.id = o.sportsbook_id
  WHERE o.game_id = p_game_id
    AND o.market = p_market
    AND o.fetched_at > NOW() - INTERVAL '4 hours'
  ORDER BY o.outcome_type, o.price DESC;
$$ LANGUAGE SQL STABLE SECURITY DEFINER;

-- ---- HELPER: calculate BetDNA after a bet is settled --------
CREATE OR REPLACE FUNCTION recalculate_betdna(p_user_id UUID, p_sport sport_key DEFAULT NULL)
RETURNS VOID AS $$
DECLARE
  v_stats RECORD;
BEGIN
  SELECT
    COUNT(*) FILTER (WHERE result IN ('win','loss','push','void')) AS total_bets,
    COUNT(*) FILTER (WHERE result = 'win') AS wins,
    COUNT(*) FILTER (WHERE result = 'loss') AS losses,
    COUNT(*) FILTER (WHERE result = 'push') AS pushes,
    ROUND(
      (SUM(profit_loss) / NULLIF(SUM(stake) FILTER (WHERE result IN ('win','loss')), 0)) * 100,
      4
    ) AS roi
  INTO v_stats
  FROM bet_tracker
  WHERE user_id = p_user_id
    AND (p_sport IS NULL OR sport = p_sport)
    AND result IS NOT NULL;

  INSERT INTO betdna_profiles (user_id, sport, total_bets_tracked, wins, losses, pushes, roi_pct, last_updated)
  VALUES (p_user_id, p_sport, v_stats.total_bets, v_stats.wins, v_stats.losses, v_stats.pushes,
          COALESCE(v_stats.roi, 0), NOW())
  ON CONFLICT (user_id, sport) DO UPDATE SET
    total_bets_tracked = EXCLUDED.total_bets_tracked,
    wins               = EXCLUDED.wins,
    losses             = EXCLUDED.losses,
    pushes             = EXCLUDED.pushes,
    roi_pct            = EXCLUDED.roi_pct,
    last_updated       = NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger BetDNA recalc whenever a bet is settled
CREATE OR REPLACE FUNCTION trigger_betdna_recalc()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.result IS NOT NULL AND (OLD.result IS NULL OR OLD.result <> NEW.result) THEN
    PERFORM recalculate_betdna(NEW.user_id, NEW.sport);
    PERFORM recalculate_betdna(NEW.user_id, NULL);  -- overall
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER bet_settled_recalc_betdna
  AFTER UPDATE ON bet_tracker
  FOR EACH ROW EXECUTE FUNCTION trigger_betdna_recalc();

-- ---- HELPER: line movement magnitude ------------------------
CREATE OR REPLACE FUNCTION calculate_movement_magnitude(p_price_old INTEGER, p_price_new INTEGER)
RETURNS DECIMAL AS $$
DECLARE
  old_prob DECIMAL;
  new_prob DECIMAL;
BEGIN
  old_prob := CASE
    WHEN p_price_old < 0 THEN ABS(p_price_old)::DECIMAL / (ABS(p_price_old) + 100)
    ELSE 100.0 / (p_price_old + 100)
  END;
  new_prob := CASE
    WHEN p_price_new < 0 THEN ABS(p_price_new)::DECIMAL / (ABS(p_price_new) + 100)
    ELSE 100.0 / (p_price_new + 100)
  END;
  RETURN ABS(new_prob - old_prob);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ---- VIEWS --------------------------------------------------

-- Today's games with odds summary
CREATE OR REPLACE VIEW v_todays_games AS
SELECT
  g.id,
  g.sport,
  g.season,
  g.status,
  g.scheduled_at,
  g.home_score,
  g.away_score,
  g.period,
  ht.abbreviation AS home_abbr,
  ht.city || ' ' || ht.name AS home_team,
  at.abbreviation AS away_abbr,
  at.city || ' ' || at.name AS away_team,
  st.name AS stadium,
  st.is_dome,
  (SELECT jsonb_build_object(
    'spread', (SELECT jsonb_agg(jsonb_build_object('book', s.key, 'outcome', o.outcome_type, 'price', o.price, 'point', o.point))
               FROM odds o JOIN sportsbooks s ON s.id = o.sportsbook_id
               WHERE o.game_id = g.id AND o.market = 'spreads' LIMIT 6),
    'total',  (SELECT jsonb_agg(jsonb_build_object('book', s.key, 'outcome', o.outcome_type, 'price', o.price, 'point', o.point))
               FROM odds o JOIN sportsbooks s ON s.id = o.sportsbook_id
               WHERE o.game_id = g.id AND o.market = 'totals' LIMIT 6)
  )) AS odds_snapshot,
  (SELECT impact_score FROM weather_data WHERE game_id = g.id ORDER BY fetched_at DESC LIMIT 1) AS weather_impact
FROM games g
JOIN teams ht ON ht.id = g.home_team_id
JOIN teams at ON at.id = g.away_team_id
LEFT JOIN stadiums st ON st.id = g.stadium_id
WHERE DATE(g.scheduled_at AT TIME ZONE 'America/New_York') = CURRENT_DATE
ORDER BY g.scheduled_at ASC;

-- Active alerts with unread counts
CREATE OR REPLACE VIEW v_alert_feed AS
SELECT
  ae.id,
  ae.user_id,
  ae.title,
  ae.message,
  ae.data,
  ae.is_read,
  ae.triggered_at,
  a.alert_type,
  g.sport,
  ht.abbreviation || ' vs ' || at.abbreviation AS matchup
FROM alert_events ae
JOIN alerts a ON a.id = ae.alert_id
LEFT JOIN games g ON g.id = ae.game_id
LEFT JOIN teams ht ON ht.id = g.home_team_id
LEFT JOIN teams at ON at.id = g.away_team_id
ORDER BY ae.triggered_at DESC;

-- Positive EV with book + game details
CREATE OR REPLACE VIEW v_positive_ev AS
SELECT
  ev.id,
  ev.game_id,
  ev.market,
  ev.outcome_type,
  ev.price,
  ev.ev_pct,
  ev.kelly_fraction,
  ev.no_vig_prob,
  ev.calculated_at,
  s.key AS sportsbook,
  s.name AS sportsbook_name,
  g.sport,
  g.scheduled_at,
  ht.abbreviation || ' vs ' || at.abbreviation AS matchup,
  p.full_name AS player_name
FROM ev_calculations ev
JOIN sportsbooks s ON s.id = ev.sportsbook_id
JOIN games g ON g.id = ev.game_id
JOIN teams ht ON ht.id = g.home_team_id
JOIN teams at ON at.id = g.away_team_id
LEFT JOIN players p ON p.id = ev.player_id
WHERE ev.is_positive_ev = TRUE
  AND ev.calculated_at > NOW() - INTERVAL '6 hours'
ORDER BY ev.ev_pct DESC;
