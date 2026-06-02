import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { getCached, setCache, CacheKey, TTL } from '../../lib/redis.js'
import { optionalAuth } from '../middleware/auth.js'

const router = new Hono()

// GET /api/market/ev — positive EV opportunities
router.get('/ev', optionalAuth, async (c) => {
  const sport = c.req.query('sport')

  const cacheKey = sport ? `oracle:ev:${sport}` : CacheKey.positiveEv()
  const cached = await getCached(cacheKey)
  if (cached) return c.json({ success: true, data: cached, meta: { cached: true } })

  let query = supabaseAdmin
    .from('v_positive_ev')
    .select('*')
    .order('ev_pct', { ascending: false })
    .limit(50)

  if (sport) query = query.eq('sport', sport)

  const { data, error } = await query
  if (error) return c.json({ success: false, error: error.message }, 500)

  // Normalize field names to match frontend expectations
  // Frontend reads: ev, ev_percent, edge | book, sportsbook | odds | matchup, market
  const normalized = (data ?? []).map(row => ({
    ...row,
    ev:           row.ev_pct,
    ev_percent:   row.ev_pct != null ? parseFloat((Number(row.ev_pct) * 100).toFixed(2)) : null,
    edge:         row.ev_pct,
    odds:         row.price,
    book:         row.sportsbook_name ?? row.sportsbook,
    market:       row.market,
    matchup:      row.matchup,
    selection:    row.outcome_type,
  }))

  await setCache(cacheKey, normalized, TTL.MARKET_PSYCH)
  return c.json({ success: true, data: normalized })
})

// GET /api/market/odds — current odds scanner (game-centric pivot)
router.get('/odds', optionalAuth, async (c) => {
  const sport = c.req.query('sport') ?? 'MLB'

  const cacheKey = `oracle:market:odds:${sport}`
  const cached = await getCached(cacheKey)
  if (cached) return c.json({ success: true, data: cached, meta: { cached: true } })

  // Fetch all relevant odds rows for this sport with sportsbook join
  const { data: rows, error } = await supabaseAdmin
    .from('odds')
    .select('game_external_id, home_team, away_team, scheduled_at, market_type, outcome_type, price, point, sportsbook:sportsbooks(key, name)')
    .eq('sport', sport)
    .in('market_type', ['h2h', 'spreads', 'totals'])
    .gte('scheduled_at', new Date(Date.now() - 3 * 3600_000).toISOString())   // -3h
    .lte('scheduled_at', new Date(Date.now() + 48 * 3600_000).toISOString())  // +48h
    .order('scheduled_at', { ascending: true })
    .limit(500)

  if (error) return c.json({ success: false, error: error.message }, 500)

  // Pivot: group flat rows by game, then by sportsbook
  type BookEntry = { spread?: number; spread_price?: number; total?: number; total_price?: number; moneyline?: number }
  type GameEntry = {
    game_id: string
    matchup: string
    home_team: string
    away_team: string
    home_team_abbr: string
    away_team_abbr: string
    scheduled_at: string
    sport: string
    books: Record<string, BookEntry>
  }

  const gameMap = new Map<string, GameEntry>()

  for (const row of rows ?? []) {
    const extId = row.game_external_id as string
    if (!extId) continue

    const sb = row.sportsbook as unknown as { key: string; name: string } | null
    const bookName = sb?.name ?? sb?.key ?? 'Unknown'

    if (!gameMap.has(extId)) {
      const home = String(row.home_team ?? '')
      const away = String(row.away_team ?? '')
      const homeAbbr = abbr(home)
      const awayAbbr = abbr(away)
      gameMap.set(extId, {
        game_id:        extId,
        matchup:        `${awayAbbr} @ ${homeAbbr}`,
        home_team:      home,
        away_team:      away,
        home_team_abbr: homeAbbr,
        away_team_abbr: awayAbbr,
        scheduled_at:   row.scheduled_at as string,
        sport,
        books:          {},
      })
    }

    const game = gameMap.get(extId)!
    if (!game.books[bookName]) game.books[bookName] = {}
    const book = game.books[bookName]
    const market = row.market_type as string
    const side = row.outcome_type as string
    const price = Number(row.price)
    const point = row.point != null ? Number(row.point) : null

    if (market === 'h2h' && side === 'home') {
      book.moneyline = price
    } else if (market === 'spreads' && side === 'away') {
      book.spread = point ?? undefined
      book.spread_price = price
    } else if (market === 'totals' && side === 'over') {
      book.total = point ?? undefined
      book.total_price = price
    }
  }

  const games = Array.from(gameMap.values())
  await setCache(cacheKey, games, TTL.LIVE_ODDS)
  return c.json({ success: true, data: games })
})

// GET /api/market/sharp — sharp action signals with game context
router.get('/sharp', optionalAuth, async (c) => {
  const sport = c.req.query('sport')
  const hours = parseInt(c.req.query('hours') ?? '24')

  const cacheKey = sport ? `oracle:sharp:${sport}` : CacheKey.sharpFeed()
  const cached = await getCached(cacheKey)
  if (cached) return c.json({ success: true, data: cached, meta: { cached: true } })

  let query = supabaseAdmin
    .from('sharp_signals')
    .select('*, game:games(sport, scheduled_at, home_team_name, away_team_name, home_team:teams!games_home_team_id_fkey(abbreviation), away_team:teams!games_away_team_id_fkey(abbreviation))')
    .gte('triggered_at', new Date(Date.now() - hours * 3600_000).toISOString())
    .order('triggered_at', { ascending: false })
    .limit(30)

  if (sport) query = query.eq('game.sport', sport)

  const { data, error } = await query
  if (error) return c.json({ success: false, error: error.message }, 500)

  // Normalize: add magnitude, created_at, team context
  type RawSharp = {
    id?: string; signal_type?: string; confidence?: number; triggered_at?: string
    game?: { sport?: string; home_team_name?: string; away_team_name?: string
             home_team?: { abbreviation?: string }; away_team?: { abbreviation?: string } }
    [key: string]: unknown
  }
  const normalized = (data as RawSharp[]).map(s => {
    const homeAbbr = s.game?.home_team?.abbreviation
    const awayAbbr = s.game?.away_team?.abbreviation
    const homeName = s.game?.home_team_name
    const awayName = s.game?.away_team_name
    const teamAbbr = homeAbbr ?? awayAbbr ?? (homeName ? abbr(homeName) : null) ?? '—'
    const teamName = homeName ?? awayName ?? teamAbbr
    return {
      ...s,
      team_abbr:  teamAbbr,
      team:       teamName,
      magnitude:  s.confidence ?? 0,
      created_at: s.triggered_at,
      sport:      s.game?.sport,
      matchup:    `${awayAbbr ?? (awayName ? abbr(awayName) : '?')} @ ${homeAbbr ?? (homeName ? abbr(homeName) : '?')}`,
    }
  })

  await setCache(cacheKey, normalized, TTL.LIVE_ODDS)
  return c.json({ success: true, data: normalized })
})

// GET /api/market/sharp-feed — alias kept for compatibility
router.get('/sharp-feed', optionalAuth, async (c) => {
  return c.redirect('/api/market/sharp', 307)
})

// GET /api/market/psychology/:gameId — market psychology for a game
router.get('/psychology/:gameId', optionalAuth, async (c) => {
  const gameId = c.req.param('gameId')

  const cacheKey = CacheKey.marketPsych(gameId)
  const cached = await getCached(cacheKey)
  if (cached) return c.json({ success: true, data: cached, meta: { cached: true } })

  const { data, error } = await supabaseAdmin
    .from('market_psychology')
    .select('*')
    .eq('game_id', gameId)
    .order('calculated_at', { ascending: false })
    .limit(1)
    .single()

  if (error) return c.json({ success: false, error: 'No market data available' }, 404)

  await setCache(cacheKey, data, TTL.MARKET_PSYCH)
  return c.json({ success: true, data })
})

// GET /api/market/public-betting/:gameId — public betting percentages
router.get('/public-betting/:gameId', optionalAuth, async (c) => {
  const gameId = c.req.param('gameId')
  const market = c.req.query('market') ?? 'spreads'

  const { data, error } = await supabaseAdmin
    .from('public_betting')
    .select('*')
    .eq('game_id', gameId)
    .eq('market', market)
    .order('fetched_at', { ascending: false })

  if (error) return c.json({ success: false, error: error.message }, 500)
  return c.json({ success: true, data })
})

// GET /api/market/arbitrage — active arbitrage opportunities
router.get('/arbitrage', optionalAuth, async (c) => {
  // Check if arbitrage_opportunities table has data; if not, compute on the fly
  const { data: arbData, error: arbError } = await supabaseAdmin
    .from('arbitrage_opportunities')
    .select('*, game:games(sport, scheduled_at, home_team:teams!games_home_team_id_fkey(abbreviation), away_team:teams!games_away_team_id_fkey(abbreviation)), book1:sportsbooks!arbitrage_opportunities_book_1_id_fkey(key, name), book2:sportsbooks!arbitrage_opportunities_book_2_id_fkey(key, name)')
    .eq('is_active', true)
    .order('arb_pct', { ascending: false })

  // If table query fails or empty, compute simple h2h arb from odds table
  if (arbError || !arbData?.length) {
    const arbs = await computeArb()
    return c.json({ success: true, data: arbs })
  }

  const normalized = (arbData ?? []).map(r => ({
    ...r,
    matchup: r.game ? `${r.game.away_team?.abbreviation ?? '?'} @ ${r.game.home_team?.abbreviation ?? '?'}` : '—',
    book_a: r.book1?.name ?? r.book1?.key ?? '—',
    book_b: r.book2?.name ?? r.book2?.key ?? '—',
    profit_percent: r.arb_pct,
    profit: r.arb_pct,
  }))
  return c.json({ success: true, data: normalized })
})

// GET /api/market/narrative/:gameId — narrative intelligence
router.get('/narrative/:gameId', optionalAuth, async (c) => {
  const gameId = c.req.param('gameId')

  const { data, error } = await supabaseAdmin
    .from('narrative_intelligence')
    .select('*')
    .eq('game_id', gameId)
    .order('hype_score', { ascending: false })

  if (error) return c.json({ success: false, error: error.message }, 500)
  return c.json({ success: true, data })
})

// ---- helpers ----

function abbr(teamName: string): string {
  const words = teamName.trim().split(/\s+/)
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase()
  if (words.length === 2) return (words[0].slice(0, 2) + words[1][0]).toUpperCase()
  return (words[0][0] + words[1][0] + words[2][0]).toUpperCase()
}

// Compute simple cross-book h2h arbitrage from the odds table on the fly
async function computeArb() {
  const { data: rows } = await supabaseAdmin
    .from('odds')
    .select('game_external_id, home_team, away_team, scheduled_at, sport, market_type, outcome_type, outcome_name, price, sportsbook:sportsbooks(key, name)')
    .eq('market_type', 'h2h')
    .gte('scheduled_at', new Date(Date.now() - 3 * 3600_000).toISOString())
    .lte('scheduled_at', new Date(Date.now() + 48 * 3600_000).toISOString())
    .limit(500)

  if (!rows?.length) return []

  // Group by game + outcome_type, collect best price per book
  type LineGroup = Map<string, { book: string; price: number }>  // outcome_type → best by book
  const games = new Map<string, { home: string; away: string; sport: string; lines: Map<string, number[]> }>()

  for (const r of rows) {
    const gid = r.game_external_id as string
    const sb = r.sportsbook as unknown as { key: string; name: string } | null
    const bookName = sb?.name ?? sb?.key ?? ''
    if (!gid || !bookName) continue

    if (!games.has(gid)) {
      games.set(gid, { home: String(r.home_team ?? ''), away: String(r.away_team ?? ''), sport: String(r.sport ?? ''), lines: new Map() })
    }

    const outcome = r.outcome_type as string  // 'home' | 'away'
    const key = `${gid}:${outcome}:${bookName}`
    const price = Number(r.price)

    const g = games.get(gid)!
    if (!g.lines.has(outcome)) g.lines.set(outcome, [])
    g.lines.get(outcome)!.push(price)
  }

  const arbs: Record<string, unknown>[] = []
  for (const [gid, g] of games) {
    const homePrices = g.lines.get('home') ?? []
    const awayPrices = g.lines.get('away') ?? []
    if (!homePrices.length || !awayPrices.length) continue

    const bestHome = Math.max(...homePrices)
    const bestAway = Math.max(...awayPrices)

    const decHome = bestHome > 0 ? 1 + bestHome / 100 : 1 + 100 / Math.abs(bestHome)
    const decAway = bestAway > 0 ? 1 + bestAway / 100 : 1 + 100 / Math.abs(bestAway)
    const arbPct = (1 / decHome + 1 / decAway)

    if (arbPct < 1.0) {
      // True arbitrage — total implied < 100%
      const profit = parseFloat(((1 / arbPct - 1) * 100).toFixed(3))
      arbs.push({
        id: gid,
        matchup: `${abbr(g.away)} @ ${abbr(g.home)}`,
        book_a:  `Best home book`,
        book_b:  `Best away book`,
        side_a:  g.home,
        side_b:  g.away,
        odds_a:  bestHome,
        odds_b:  bestAway,
        profit:  profit,
        profit_percent: profit,
        margin:  profit,
        sport:   g.sport,
      })
    }
  }

  return arbs.sort((a, b) => Number(b.profit) - Number(a.profit)).slice(0, 20)
}

export default router
