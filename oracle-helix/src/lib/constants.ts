export const ORACLE_VERSION = '1.0.0'
export const BRAND = 'ORACLE HELIX | BLACKSPIRE HELIX GROUP'

// Sports that are fully supported in Phase 1
export const ACTIVE_SPORTS = ['NBA', 'NFL', 'MLB', 'NHL', 'WNBA', 'PGA'] as const

// The Odds API sport keys (maps to our SportKey enum)
export const ODDS_API_SPORT_KEYS: Record<string, string> = {
  NBA: 'basketball_nba',
  NFL: 'americanfootball_nfl',
  MLB: 'baseball_mlb',
  NHL: 'icehockey_nhl',
  WNBA: 'basketball_wnba',
  NCAABB: 'basketball_ncaab',
  NCAAFB: 'americanfootball_ncaaf',
}

// ESPN API sport/league paths
export const ESPN_SPORT_PATHS: Record<string, string> = {
  NBA: 'basketball/nba',
  NFL: 'football/nfl',
  MLB: 'baseball/mlb',
  NHL: 'hockey/nhl',
  WNBA: 'basketball/wnba',
  NCAABB: 'basketball/mens-college-basketball',
}

// Subscription feature gates
export const TIER_FEATURES = {
  free: ['dashboard', 'games', 'basic_odds'],
  starter: ['dashboard', 'games', 'odds', 'props', 'players', 'alerts_basic'],
  pro: ['dashboard', 'games', 'odds', 'props', 'players', 'alerts', 'simulations', 'betdna', 'ai_chat'],
  elite: ['all', 'war_room', 'ai_agents', 'sharp_feed', 'market_psychology'],
  enterprise: ['all'],
} as const

// Market type display labels
export const MARKET_LABELS: Record<string, string> = {
  h2h: 'Moneyline',
  spreads: 'Spread',
  totals: 'Total (O/U)',
  player_props: 'Player Props',
  team_props: 'Team Props',
  alternate_spreads: 'Alt Spread',
  alternate_totals: 'Alt Total',
  first_half: '1st Half',
  second_half: '2nd Half',
  outrights: 'Futures',
}

// Player prop stat types by sport
export const PROP_STAT_TYPES: Record<string, string[]> = {
  NBA: ['points', 'rebounds', 'assists', 'threes', 'steals', 'blocks', 'turnovers', 'pra', 'pr', 'pa', 'ra'],
  NFL: ['passing_yards', 'passing_tds', 'rushing_yards', 'receiving_yards', 'receptions', 'completions', 'interceptions', 'sacks'],
  MLB: ['strikeouts', 'hits_allowed', 'earned_runs', 'total_bases', 'hits', 'rbi', 'runs', 'home_runs', 'stolen_bases'],
  NHL: ['goals', 'assists', 'points', 'shots_on_goal', 'saves', 'goals_allowed'],
}

// Weather impact thresholds
export const WEATHER_THRESHOLDS = {
  WIND_SIGNIFICANT_MPH: 15,
  WIND_HIGH_MPH: 25,
  TEMP_COLD_F: 35,
  TEMP_VERY_COLD_F: 20,
  PRECIP_CHANCE_NOTABLE: 30,
  HUMIDITY_HIGH: 80,
}
