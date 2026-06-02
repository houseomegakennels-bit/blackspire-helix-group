import { Hono } from 'hono'
import type { AppVariables } from '../../types/hono.js'
import { supabaseAdmin } from '../../lib/supabase.js'
import { getCached, setCache, TTL } from '../../lib/redis.js'
import { optionalAuth } from '../middleware/auth.js'

const router = new Hono<{ Variables: AppVariables }>()

// GET /api/dashboard — intelligence dashboard aggregated data
router.get('/', optionalAuth, async (c) => {
  const userId = c.get('userId') as string | undefined
  const sport = c.req.query('sport')

  const cacheKey = `oracle:dashboard:${sport ?? 'all'}:${userId ?? 'anon'}`
  const cached = await getCached(cacheKey)
  // NOTE: cached value is already the unwrapped payload shape
  if (cached) return c.json(cached)

  // Parallel fetch all dashboard data
  const [todayGamesRaw, positiveEvRaw, sharpFeedRaw, injuriesRaw, researchCards, unreadCount] = await Promise.all([
    // v_todays_games — returns home_abbr/away_abbr/scheduled_at (fixed in migration 010)
    supabaseAdmin.from('v_todays_games').select('*').limit(sport ? 20 : 10).then(r => r.data ?? []),

    // v_positive_ev
    supabaseAdmin.from('v_positive_ev').select('*').limit(8).then(r => r.data ?? []),

    // sharp_signals with game join for team context
    supabaseAdmin
      .from('sharp_signals')
      .select('*, game:games(sport, scheduled_at, home_team_name, away_team_name, home_team:teams!games_home_team_id_fkey(abbreviation), away_team:teams!games_away_team_id_fkey(abbreviation))')
      .gte('triggered_at', new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString())
      .order('triggered_at', { ascending: false })
      .limit(10)
      .then(r => r.data ?? []),

    // player_injuries with player + team joins
    supabaseAdmin
      .from('player_injuries')
      .select('*, player:players(full_name, position, team:teams(abbreviation, sport))')
      .eq('is_active', true)
      .limit(10)
      .then(r => r.data ?? []),

    // ai_research_cards (public, no user_id)
    supabaseAdmin
      .from('ai_research_cards')
      .select('id, card_type, sport, title, headline, content, tags, generated_at')
      .is('user_id', null)
      .order('generated_at', { ascending: false })
      .limit(5)
      .then(r => r.data ?? []),

    // unread alert count for authenticated users
    userId
      ? supabaseAdmin
          .from('alert_events')
          .select('*', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('is_read', false)
          .then(r => r.count ?? 0)
      : Promise.resolve(0),
  ])

  // ---- Normalize todayGames to the shape the frontend expects ----
  // v_todays_games returns: home_abbr, away_abbr, scheduled_at
  // Frontend expects:       home_team_abbr, away_team_abbr, start_time
  // If no team FK exists (synthetic game), derive abbreviation from team name.
  function teamAbbreviation(abbr: unknown, name: unknown): string | null {
    if (abbr && typeof abbr === 'string') return abbr
    if (!name || typeof name !== 'string') return null
    const words = name.trim().split(/\s+/)
    if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
    if (words.length === 2) return (words[0].slice(0, 2) + words[1][0]).toUpperCase()
    return (words[0][0] + words[1][0] + words[2][0]).toUpperCase()
  }
  type RawGame = Record<string, unknown>
  const todayGames = (todayGamesRaw as RawGame[]).map(g => ({
    ...g,
    home_team_abbr: teamAbbreviation(g.home_team_abbr ?? g.home_abbr, g.home_team),
    away_team_abbr: teamAbbreviation(g.away_team_abbr ?? g.away_abbr, g.away_team),
    start_time:     g.start_time ?? g.scheduled_at,
  }))

  // ---- Normalize sharpFeed ----------------------------------------
  // Table: triggered_at | game: { home_team_name, home_team.abbreviation }
  // Frontend: created_at, team_abbr, team, signal_type, magnitude
  type RawSharp = {
    id?: string
    signal_type?: string
    magnitude?: number
    triggered_at?: string
    game?: {
      sport?: string
      home_team_name?: string
      away_team_name?: string
      home_team?: { abbreviation?: string }
      away_team?: { abbreviation?: string }
    }
    [key: string]: unknown
  }
  const sharpFeed = (sharpFeedRaw as RawSharp[]).map(s => {
    const homeAbbr = s.game?.home_team?.abbreviation
    const awayAbbr = s.game?.away_team?.abbreviation
    const homeName = s.game?.home_team_name
    const awayName = s.game?.away_team_name
    const teamAbbr = homeAbbr ?? awayAbbr ?? (homeName?.slice(0, 3).toUpperCase()) ?? '—'
    const teamName = homeName ?? awayName ?? teamAbbr
    return {
      ...s,
      team_abbr: teamAbbr,
      team: teamName,
      magnitude: s.confidence ?? s.magnitude,   // table uses "confidence", frontend reads "magnitude"
      created_at: s.triggered_at,
      sport: s.game?.sport,
    }
  })

  // ---- Normalize injuries -----------------------------------------
  // Backend join: player.full_name, player.position, player.team.abbreviation
  // Frontend expects: player_name, position, team, status
  type RawInjury = {
    id?: string
    status?: string
    injury_type?: string
    is_active?: boolean
    player?: {
      full_name?: string
      position?: string
      team?: { abbreviation?: string; sport?: string }
    }
    [key: string]: unknown
  }
  const injuries = (injuriesRaw as RawInjury[]).map(inj => ({
    ...inj,
    player_name: inj.player?.full_name ?? 'Unknown Player',
    position:    inj.player?.position ?? '—',
    team:        inj.player?.team?.abbreviation ?? '—',
    sport:       inj.player?.team?.sport ?? '—',
    status:      inj.status ?? inj.injury_type ?? 'Injured',
  }))

  // ---- Normalize positiveEv ---------------------------------------
  // v_positive_ev returns: matchup, market, ev_pct, sportsbook, sportsbook_name
  // Frontend expects: matchup, market, ev_pct, sportsbook, game
  type RawEv = Record<string, unknown>
  const positiveEv = (positiveEvRaw as RawEv[]).map(ev => ({
    ...ev,
    game:      ev.matchup ?? ev.game,
    sportsbook: ev.sportsbook_name ?? ev.sportsbook,
  }))

  // Alias content → summary so frontend card renders the body text
  type RawCard = Record<string, unknown>
  const normalizedCards = (researchCards as RawCard[]).map(card => ({
    ...card,
    summary: card.content ?? card.summary,
  }))

  const payload = {
    todayGames,
    positiveEv,
    sharpFeed,
    injuries,
    researchCards: normalizedCards,
    unreadAlerts: unreadCount ?? 0,
    generatedAt: new Date().toISOString(),
    disclaimer: 'ORACLE HELIX provides sports intelligence and analytics only. Not financial or gambling advice.',
  }

  await setCache(cacheKey, payload, userId ? TTL.MARKET_PSYCH : TTL.GAMES_TODAY)

  // Return payload directly — frontend reads json.researchCards etc. (not json.data.researchCards)
  return c.json(payload)
})

// GET /api/dashboard/layout — user's War Room layout
router.get('/layout', optionalAuth, async (c) => {
  const userId = c.get('userId') as string | undefined
  if (!userId) return c.json({ success: false, error: 'Auth required' }, 401)

  const { data, error } = await supabaseAdmin
    .from('saved_layouts')
    .select('*')
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .order('updated_at', { ascending: false })

  if (error) return c.json({ success: false, error: error.message }, 500)
  return c.json({ success: true, data })
})

// POST /api/dashboard/layout — save a layout
router.post('/layout', optionalAuth, async (c) => {
  const userId = c.get('userId') as string | undefined
  if (!userId) return c.json({ success: false, error: 'Auth required' }, 401)

  const body = await c.req.json()

  if (body.isDefault) {
    await supabaseAdmin.from('saved_layouts').update({ is_default: false }).eq('user_id', userId)
  }

  const { data, error } = await supabaseAdmin
    .from('saved_layouts')
    .upsert({ ...body, user_id: userId }, { onConflict: 'id' })
    .select()
    .single()

  if (error) return c.json({ success: false, error: error.message }, 500)
  return c.json({ success: true, data })
})

export default router
