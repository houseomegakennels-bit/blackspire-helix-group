import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { getCached, setCache, CacheKey, TTL } from '../../lib/redis.js'
import { optionalAuth } from '../middleware/auth.js'
import type { ApiResponse, Game, SportKey } from '../../types/index.js'

const router = new Hono()

// GET /api/games — today's games with odds snapshot
router.get('/', optionalAuth, async (c) => {
  const sport = c.req.query('sport') as SportKey | undefined
  const date = c.req.query('date')
  const status = c.req.query('status')

  const cacheKey = CacheKey.todaysGames(sport)
  const cached = await getCached<Game[]>(cacheKey)
  if (cached && !date) {
    return c.json<ApiResponse<Game[]>>({ success: true, data: cached, meta: { cached: true } })
  }

  let query = supabaseAdmin
    .from('v_todays_games')
    .select('*')

  if (sport) query = query.eq('sport', sport)
  if (status) query = query.eq('status', status)
  if (date) query = query.eq('scheduled_at::date', date)

  const { data, error } = await query.order('scheduled_at', { ascending: true })

  if (error) return c.json<ApiResponse<never>>({ success: false, error: error.message }, 500)

  if (!date) await setCache(cacheKey, data, status === 'live' ? TTL.LIVE_ODDS : TTL.GAMES_TODAY)

  return c.json<ApiResponse<typeof data>>({ success: true, data: data ?? [], meta: { total: data?.length ?? 0 } })
})

// GET /api/games/:id — single game detail
router.get('/:id', optionalAuth, async (c) => {
  const id = c.req.param('id')

  const { data: game, error } = await supabaseAdmin
    .from('games')
    .select(`
      *,
      home_team:teams!games_home_team_id_fkey(id, abbreviation, name, city, logo_url, primary_color),
      away_team:teams!games_away_team_id_fkey(id, abbreviation, name, city, logo_url, primary_color),
      stadium:stadiums(*)
    `)
    .eq('id', id)
    .single()

  if (error) return c.json<ApiResponse<never>>({ success: false, error: 'Game not found' }, 404)

  // Enrich with odds, weather, market psychology, signals, EV, line movement
  const gameExternalId = (game as any).external_id as string | null
  const [oddsById, weatherResult, marketResult, injuriesResult, signalsResult, evResult, lineMoveResult] = await Promise.all([
    supabaseAdmin.from('odds').select('*, sportsbook:sportsbooks(key, name)').eq('game_id', id).order('fetched_at', { ascending: false }).limit(50),
    supabaseAdmin.from('weather_data').select('*').eq('game_id', id).order('fetched_at', { ascending: false }).limit(1).single(),
    supabaseAdmin.from('market_psychology').select('*').eq('game_id', id).order('calculated_at', { ascending: false }).limit(1).single(),
    supabaseAdmin.from('player_injuries').select('*, player:players(full_name, position, team:teams(abbreviation))').eq('is_active', true),
    supabaseAdmin.from('sharp_signals').select('*').eq('game_id', id).order('triggered_at', { ascending: false }).limit(20),
    supabaseAdmin.from('ev_calculations').select('market, outcome_type, no_vig_prob').eq('game_id', id).eq('market', 'h2h'),
    supabaseAdmin.from('line_movement').select('*').eq('game_id', id).order('moved_at', { ascending: true }).limit(50),
  ])

  // Fallback: match odds by game_external_id if no game_id FK match found
  let oddsData = oddsById.data ?? []
  if (!oddsData.length && gameExternalId) {
    const { data: oddsByExt } = await supabaseAdmin
      .from('odds')
      .select('*, sportsbook:sportsbooks(key, name)')
      .eq('game_external_id', gameExternalId)
      .order('fetched_at', { ascending: false })
      .limit(50)
    oddsData = oddsByExt ?? []
  }
  const oddsResult = { data: oddsData }

  // Normalize joined team objects → flat strings the frontend expects
  type TeamObj = { id?: string; abbreviation?: string; name?: string; city?: string; logo_url?: string; primary_color?: string } | null
  function teamName(t: TeamObj): string | null {
    if (!t || typeof t !== 'object') return t as unknown as string | null
    return t.city ? `${t.city} ${t.name}` : (t.name ?? t.abbreviation ?? null)
  }
  const homeTeam = game.home_team as unknown as TeamObj
  const awayTeam = game.away_team as unknown as TeamObj

  // Normalize injuries: group by home/away team
  type RawInj = { player?: { full_name?: string; position?: string; team?: { abbreviation?: string } }; status?: string; injury_type?: string; [k: string]: unknown }
  const homeAbbr = typeof homeTeam === 'object' ? homeTeam?.abbreviation : (game as any).home_team_abbr
  const awayAbbr = typeof awayTeam === 'object' ? awayTeam?.abbreviation : (game as any).away_team_abbr
  const injFlat = (injuriesResult.data ?? []) as RawInj[]
  const injHome = injFlat.filter(i => i.player?.team?.abbreviation === homeAbbr).map(i => ({
    player_name: i.player?.full_name ?? 'Unknown', position: i.player?.position ?? '—', team: i.player?.team?.abbreviation ?? '—', status: i.status ?? i.injury_type ?? 'Injured'
  }))
  const injAway = injFlat.filter(i => i.player?.team?.abbreviation === awayAbbr).map(i => ({
    player_name: i.player?.full_name ?? 'Unknown', position: i.player?.position ?? '—', team: i.player?.team?.abbreviation ?? '—', status: i.status ?? i.injury_type ?? 'Injured'
  }))

  // ---- Win probability from h2h no-vig consensus -------------------
  // ev_calculations stores the cross-book no-vig probability per outcome.
  type EvRow = { market?: string; outcome_type?: string; no_vig_prob?: number | null }
  const evRows = (evResult.data ?? []) as EvRow[]
  const avgProb = (outcome: string): number | null => {
    const ps = evRows.filter(r => r.outcome_type === outcome).map(r => Number(r.no_vig_prob)).filter(p => p > 0)
    if (!ps.length) return null
    return ps.reduce((a, b) => a + b, 0) / ps.length
  }
  let homeWinProb = avgProb('home')
  let awayWinProb = avgProb('away')
  // Normalize the pair to sum to 1 when both present (defensive against vig residue)
  if (homeWinProb != null && awayWinProb != null) {
    const tot = homeWinProb + awayWinProb
    if (tot > 0) { homeWinProb = homeWinProb / tot; awayWinProb = awayWinProb / tot }
  } else if (homeWinProb != null && awayWinProb == null) {
    awayWinProb = 1 - homeWinProb
  } else if (awayWinProb != null && homeWinProb == null) {
    homeWinProb = 1 - awayWinProb
  }

  // ---- Sharp signals → frontend shape {id, team, signal_type, magnitude}
  type SigRow = { id?: string; outcome_type?: string; signal_type?: string; confidence?: number | null }
  const sharpSignals = ((signalsResult.data ?? []) as SigRow[]).map(s => ({
    id: s.id,
    team: s.outcome_type === 'home' ? (homeAbbr ?? 'Home')
        : s.outcome_type === 'away' ? (awayAbbr ?? 'Away')
        : (s.outcome_type ?? ''),
    signal_type: s.signal_type ?? 'signal',
    magnitude: Number(s.confidence ?? 0),
  }))

  // ---- Line movement → frontend shape {value}[] (chronological) -----
  // The panel shows a single "Open → Now" series, so collapse the raw rows
  // (which span every book/market/outcome) to one coherent series: prefer
  // spreads/home, fall back to h2h/home, then pick the sportsbook with the
  // most samples, ordered oldest→newest.
  type LmRow = { sportsbook_id?: string; market?: string; outcome_type?: string; point_new?: number | null; price_new?: number | null; moved_at?: string }
  const lmAll = (lineMoveResult.data ?? []) as LmRow[]
  const pickSeries = (rows: LmRow[]): LmRow[] => {
    const byBook = new Map<string, LmRow[]>()
    for (const r of rows) {
      const b = r.sportsbook_id ?? 'unknown'
      if (!byBook.has(b)) byBook.set(b, [])
      byBook.get(b)!.push(r)
    }
    let best: LmRow[] = []
    for (const [, arr] of byBook) if (arr.length > best.length) best = arr
    return best.slice().sort((a, b) => new Date(a.moved_at ?? 0).getTime() - new Date(b.moved_at ?? 0).getTime())
  }
  let lmSeries = pickSeries(lmAll.filter(m => m.market === 'spreads' && m.outcome_type === 'home'))
  if (!lmSeries.length) lmSeries = pickSeries(lmAll.filter(m => m.market === 'h2h' && m.outcome_type === 'home'))
  const lineMovement = lmSeries.map(m => ({
    value: m.point_new != null ? Number(m.point_new) : Number(m.price_new ?? 0),
  }))

  // ---- Recent form + record from each team's last 5 final games -----
  const homeTeamId = (game as any).home_team_id as string | null
  const awayTeamId = (game as any).away_team_id as string | null
  async function teamForm(teamId: string | null): Promise<{ form: string[]; record: string | null }> {
    if (!teamId) return { form: [], record: null }
    const { data: pastGames } = await supabaseAdmin
      .from('games')
      .select('home_team_id, away_team_id, home_score, away_score, scheduled_at, status')
      .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
      .eq('status', 'final')
      .not('home_score', 'is', null)
      .order('scheduled_at', { ascending: false })
      .limit(20)
    let wins = 0, losses = 0
    const form: string[] = []
    for (const g of pastGames ?? []) {
      const isHome = (g as any).home_team_id === teamId
      const my = isHome ? (g as any).home_score : (g as any).away_score
      const opp = isHome ? (g as any).away_score : (g as any).home_score
      if (my == null || opp == null) continue
      const won = Number(my) > Number(opp)
      if (won) wins++; else losses++
      if (form.length < 5) form.push(won ? 'W' : 'L')
    }
    return { form, record: (wins + losses) > 0 ? `${wins}-${losses}` : null }
  }
  const [homeFormData, awayFormData] = await Promise.all([teamForm(homeTeamId), teamForm(awayTeamId)])

  // ---- Key stats derived from available data ------------------------
  const stats: Array<{ label: string; away: string; home: string }> = []
  if (homeWinProb != null && awayWinProb != null) {
    stats.push({ label: 'Win Probability', away: `${Math.round(awayWinProb * 100)}%`, home: `${Math.round(homeWinProb * 100)}%` })
  }
  if (homeFormData.record || awayFormData.record) {
    stats.push({ label: 'Record (recent)', away: awayFormData.record ?? '—', home: homeFormData.record ?? '—' })
  }
  if (homeFormData.form.length || awayFormData.form.length) {
    stats.push({ label: 'Last 5', away: awayFormData.form.join(' ') || '—', home: homeFormData.form.join(' ') || '—' })
  }
  const sigHome = sharpSignals.filter(s => s.team === (homeAbbr ?? 'Home')).length
  const sigAway = sharpSignals.filter(s => s.team === (awayAbbr ?? 'Away')).length
  if (sharpSignals.length) {
    stats.push({ label: 'Sharp Signals', away: String(sigAway), home: String(sigHome) })
  }

  return c.json({
    success: true,
    data: {
      ...game,
      home_team: teamName(homeTeam),
      away_team: teamName(awayTeam),
      home_team_abbr: (typeof homeTeam === 'object' ? homeTeam?.abbreviation : null) ?? (game as any).home_team_abbr,
      away_team_abbr: (typeof awayTeam === 'object' ? awayTeam?.abbreviation : null) ?? (game as any).away_team_abbr,
      venue: (game as any).stadium?.name ?? (game as any).venue ?? null,
      start_time: (game as any).scheduled_at ?? (game as any).start_time ?? null,
      odds: oddsResult.data ?? [],
      weather: weatherResult.data ? (() => {
        const w = weatherResult.data as Record<string, unknown>
        return {
          ...w,
          temp: w.temperature_f ?? null,
          wind_speed: w.wind_speed_mph ?? null,
          wind_direction: w.wind_direction ?? null,
          precipitation: w.precipitation_in ?? null,
          condition: w.condition ?? null,
          impact: w.impact_score ?? null,
          impact_summary: w.impact_summary ?? null,
        }
      })() : null,
      marketPsychology: marketResult.data ?? null,
      injuries: { home: injHome, away: injAway },
      home_win_prob: homeWinProb,
      away_win_prob: awayWinProb,
      sharp_signals: sharpSignals,
      line_movement: lineMovement,
      home_form: homeFormData.form,
      away_form: awayFormData.form,
      home_record: homeFormData.record,
      away_record: awayFormData.record,
      stats,
    },
  })
})

// GET /api/games/:id/odds — all sportsbook odds for a game
router.get('/:id/odds', optionalAuth, async (c) => {
  const id = c.req.param('id')
  const market = c.req.query('market') ?? 'spreads'

  const cacheKey = CacheKey.gameOdds(id)
  const cached = await getCached(cacheKey)
  if (cached) return c.json({ success: true, data: cached, meta: { cached: true } })

  const { data, error } = await supabaseAdmin
    .from('odds')
    .select('*, sportsbook:sportsbooks(key, name, logo_url)')
    .eq('game_id', id)
    .eq('market', market)
    .order('fetched_at', { ascending: false })

  if (error) return c.json({ success: false, error: error.message }, 500)

  await setCache(cacheKey, data, TTL.ODDS)
  return c.json({ success: true, data })
})

// GET /api/games/:id/line-movement — line history
router.get('/:id/line-movement', optionalAuth, async (c) => {
  const id = c.req.param('id')
  const market = c.req.query('market') ?? 'spreads'

  const cacheKey = CacheKey.lineMovement(id)
  const cached = await getCached(cacheKey)
  if (cached) return c.json({ success: true, data: cached, meta: { cached: true } })

  const { data, error } = await supabaseAdmin
    .from('line_movement')
    .select('*, sportsbook:sportsbooks(key, name)')
    .eq('game_id', id)
    .eq('market', market)
    .order('moved_at', { ascending: true })

  if (error) return c.json({ success: false, error: error.message }, 500)

  await setCache(cacheKey, data, TTL.ODDS)
  return c.json({ success: true, data })
})

// GET /api/games/:id/props — player props for a game
router.get('/:id/props', optionalAuth, async (c) => {
  const id = c.req.param('id')
  const statType = c.req.query('stat_type')

  const cacheKey = CacheKey.gameProps(id)
  const cached = await getCached(cacheKey)
  if (cached && !statType) return c.json({ success: true, data: cached, meta: { cached: true } })

  let query = supabaseAdmin
    .from('props')
    .select('*, player:players(full_name, position, headshot_url), sportsbook:sportsbooks(key, name)')
    .eq('game_id', id)
    .order('stat_type')

  if (statType) query = query.eq('stat_type', statType)

  const { data, error } = await query

  if (error) return c.json({ success: false, error: error.message }, 500)

  if (!statType) await setCache(cacheKey, data, TTL.ODDS)
  return c.json({ success: true, data })
})

// GET /api/games/:id/matchup — AI matchup report
router.get('/:id/matchup', optionalAuth, async (c) => {
  const id = c.req.param('id')

  const cacheKey = CacheKey.matchupReport(id)
  const cached = await getCached(cacheKey)
  if (cached) return c.json({ success: true, data: cached, meta: { cached: true } })

  const { data, error } = await supabaseAdmin
    .from('matchup_reports')
    .select('*')
    .eq('game_id', id)
    .order('generated_at', { ascending: false })
    .limit(1)
    .single()

  if (error) return c.json({ success: false, error: 'No matchup report available' }, 404)

  await setCache(cacheKey, data, TTL.MATCHUP_REPORT)
  return c.json({ success: true, data })
})

export default router
