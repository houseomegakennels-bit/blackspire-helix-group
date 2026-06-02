// ============================================================
// ORACLE HELIX — Cron Job Routes
// Called by Vercel on schedule
// Protected by CRON_SECRET (Vercel injects automatically)
// ============================================================
import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import {
  fetchScoreboard,
  fetchTeamRoster,
  normalizeEspnGame,
  normalizeRosterAthletes,
} from '../../integrations/espn/client.js'
import { ESPN_SPORT_PATHS } from '../../lib/constants.js'
import {
  fetchOdds,
  normalizeOddsEvent,
  fetchPlayerProps,
} from '../../integrations/odds-api/client.js'
import { fetchTodaySchedule as fetchMlbSchedule, fetchScheduleRange as fetchMlbScheduleRange } from '../../integrations/mlb/client.js'
import { fetchTodaySchedule as fetchNhlSchedule } from '../../integrations/nhl/client.js'
import { fetchGameWeather } from '../../engines/weather/index.js'
import { runAgent } from '../../lib/claude.js'
import type { SportKey } from '../../types/index.js'

const cron = new Hono()

// Home-team abbreviation → home stadium name, per sport. Used to backfill
// games.stadium_id so weather can be fetched. Shared venues (MetLife, SoFi)
// map two teams to one stadium. Keep names identical to the seeded stadiums.
const STADIUM_BY_ABBR: Record<string, Record<string, string>> = {
  MLB: {
    ARI: 'Chase Field', ATL: 'Truist Park', BAL: 'Oriole Park at Camden Yards', BOS: 'Fenway Park',
    CHC: 'Wrigley Field', CWS: 'Rate Field', CIN: 'Great American Ball Park', CLE: 'Progressive Field',
    COL: 'Coors Field', DET: 'Comerica Park', HOU: 'Daikin Park', KC: 'Kauffman Stadium',
    LAA: 'Angel Stadium', LAD: 'Dodger Stadium', MIA: 'loanDepot Park', MIL: 'American Family Field',
    MIN: 'Target Field', NYM: 'Citi Field', NYY: 'Yankee Stadium', ATH: 'Sutter Health Park',
    PHI: 'Citizens Bank Park', PIT: 'PNC Park', SD: 'Petco Park', SF: 'Oracle Park',
    SEA: 'T-Mobile Park', STL: 'Busch Stadium', TB: 'Tropicana Field', TEX: 'Globe Life Field',
    TOR: 'Rogers Centre', WSH: 'Nationals Park',
  },
  NFL: {
    ARI: 'State Farm Stadium', ATL: 'Mercedes-Benz Stadium', BAL: 'M&T Bank Stadium', BUF: 'Highmark Stadium',
    CAR: 'Bank of America Stadium', CHI: 'Soldier Field', CIN: 'Paycor Stadium', CLE: 'Huntington Bank Field',
    DAL: 'AT&T Stadium', DEN: 'Empower Field at Mile High', DET: 'Ford Field', GB: 'Lambeau Field',
    HOU: 'NRG Stadium', IND: 'Lucas Oil Stadium', JAX: 'EverBank Stadium', KC: 'Arrowhead Stadium',
    LV: 'Allegiant Stadium', LAC: 'SoFi Stadium', LAR: 'SoFi Stadium', MIA: 'Hard Rock Stadium',
    MIN: 'U.S. Bank Stadium', NE: 'Gillette Stadium', NO: 'Caesars Superdome', NYG: 'MetLife Stadium',
    NYJ: 'MetLife Stadium', PHI: 'Lincoln Financial Field', PIT: 'Acrisure Stadium', SF: "Levi's Stadium",
    SEA: 'Lumen Field', TB: 'Raymond James Stadium', TEN: 'Nissan Stadium', WSH: 'Northwest Stadium',
  },
}

// ---- Auth guard — Vercel passes CRON_SECRET as Bearer -------
cron.use('*', async (c, next) => {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = c.req.header('Authorization')
    if (auth !== `Bearer ${secret}`) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
  }
  await next()
})

// ============================================================
// GET /api/cron/sync-scores
// Upserts today's games + live scores from ESPN / MLB / NHL
// ============================================================
cron.get('/sync-scores', async (c) => {
  const start = Date.now()
  const results: Record<string, string> = {}

  // ---- ESPN sports (NBA, NFL, WNBA) -------------------------
  // ESPN's scoreboard returns only the current day. To keep the board
  // populated for playoff series with off-days (NBA/NHL finals) and for
  // daily leagues whose today-slate has already gone final (WNBA), fetch a
  // forward window of calendar days and merge. Dedup is handled by the
  // external_id upsert conflict key.
  const FORWARD_DAYS = 7
  const dayStamps: string[] = []
  for (let i = 0; i < FORWARD_DAYS; i++) {
    const d = new Date(Date.now() + i * 86400000)
    dayStamps.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`)
  }

  const espnSports: SportKey[] = ['NBA', 'NFL', 'WNBA']
  for (const sport of espnSports) {
    try {
      const boards = await Promise.all(dayStamps.map(ds => fetchScoreboard(sport, ds).catch(() => ({ events: [] }))))
      const events = boards.flatMap(b => b.events ?? [])
      // Dedup events by id across days (ESPN can repeat an event near midnight)
      const seenEv = new Set<string>()
      const games = events
        .filter(e => { if (seenEv.has(e.id)) return false; seenEv.add(e.id); return true })
        .map(e => normalizeEspnGame(e, sport))

      if (games.length === 0) {
        results[sport] = '0 games in next 7 days'
        continue
      }

      const rows = games.map(g => ({
        external_id: g.externalId,
        sport,
        scheduled_at: g.scheduledAt,
        status: g.status,
        home_team_name: g.homeTeamName,
        away_team_name: g.awayTeamName,
        home_team_abbr: g.homeTeamAbbr ?? null,
        away_team_abbr: g.awayTeamAbbr ?? null,
        home_score: g.homeScore ?? null,
        away_score: g.awayScore ?? null,
        period: g.period ?? null,
        period_time: g.periodTime ?? null,
        updated_at: new Date().toISOString(),
      }))

      const { error } = await supabaseAdmin
        .from('games')
        .upsert(rows, { onConflict: 'external_id', ignoreDuplicates: false })

      if (error) {
        results[sport] = `error: ${error.message}`
      } else {
        results[sport] = `${games.length} games upserted`
      }
    } catch (e: unknown) {
      results[sport] = `error: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  // ---- MLB via official Stats API ---------------------------
  try {
    const startDate = new Date().toISOString().split('T')[0]
    const endDate = new Date(Date.now() + (FORWARD_DAYS - 1) * 86400000).toISOString().split('T')[0]
    const schedule = await fetchMlbScheduleRange(startDate, endDate).catch(() => fetchMlbSchedule())
    const games = (schedule.dates ?? []).flatMap(d => d.games ?? [])

    if (games.length === 0) {
      results['MLB'] = '0 games today'
    } else {
      const rows = games.map(g => ({
        external_id: `mlb_${g.gamePk}`,
        sport: 'MLB' as SportKey,
        scheduled_at: g.gameDate,
        status: mapMlbStatus(g.status.abstractGameState),
        home_team_name: g.teams.home.team.name,
        away_team_name: g.teams.away.team.name,
        home_team_abbr: g.teams.home.team.abbreviation ?? null,
        away_team_abbr: g.teams.away.team.abbreviation ?? null,
        home_score: g.teams.home.score ?? null,
        away_score: g.teams.away.score ?? null,
        updated_at: new Date().toISOString(),
      }))

      const { error } = await supabaseAdmin
        .from('games')
        .upsert(rows, { onConflict: 'external_id', ignoreDuplicates: false })

      results['MLB'] = error ? `error: ${error.message}` : `${games.length} games upserted`
    }
  } catch (e: unknown) {
    results['MLB'] = `error: ${e instanceof Error ? e.message : String(e)}`
  }

  // ---- NHL via NHL API v1 -----------------------------------
  try {
    const schedule = await fetchNhlSchedule()
    const games = (schedule.gameWeek ?? []).flatMap(d => d.games ?? [])

    if (games.length === 0) {
      results['NHL'] = '0 games today'
    } else {
      const rows = games.map(g => ({
        external_id: `nhl_${g.id}`,
        sport: 'NHL' as SportKey,
        scheduled_at: g.startTimeUTC,
        status: mapNhlStatus(g.gameState),
        home_team_name: g.homeTeam.name?.default ?? g.homeTeam.abbrev,
        away_team_name: g.awayTeam.name?.default ?? g.awayTeam.abbrev,
        home_team_abbr: g.homeTeam.abbrev,
        away_team_abbr: g.awayTeam.abbrev,
        home_score: g.homeTeam.score ?? null,
        away_score: g.awayTeam.score ?? null,
        period: g.period ?? null,
        updated_at: new Date().toISOString(),
      }))

      const { error } = await supabaseAdmin
        .from('games')
        .upsert(rows, { onConflict: 'external_id', ignoreDuplicates: false })

      results['NHL'] = error ? `error: ${error.message}` : `${games.length} games upserted`
    }
  } catch (e: unknown) {
    results['NHL'] = `error: ${e instanceof Error ? e.message : String(e)}`
  }

  // ---- Link games to teams by abbreviation / name ------------
  // Runs after all sports are upserted; fixes missing home_team_id / away_team_id
  try {
    const { data: unlinked } = await supabaseAdmin
      .from('games')
      .select('id, sport, home_team_name, away_team_name, home_team_abbr, away_team_abbr')
      .is('home_team_id', null)
      .gte('scheduled_at', new Date(Date.now() - 7 * 86400000).toISOString())

    if (unlinked && unlinked.length > 0) {
      const { data: allTeams } = await supabaseAdmin.from('teams').select('id, sport, name, city, abbreviation')
      const teamsByAbbr = new Map<string, string>()   // `${sport}:${abbr}` → teamId
      const teamsByName = new Map<string, string>()   // `${sport}:${city name}` → teamId
      for (const t of allTeams ?? []) {
        if (t.abbreviation) teamsByAbbr.set(`${t.sport}:${t.abbreviation.toUpperCase()}`, t.id)
        const fullName = `${t.city ?? ''} ${t.name ?? ''}`.trim().toLowerCase()
        if (fullName) teamsByName.set(`${t.sport}:${fullName}`, t.id)
        if (t.name) teamsByName.set(`${t.sport}:${t.name.toLowerCase()}`, t.id)
      }

      let linked = 0
      for (const g of unlinked) {
        const sport = g.sport as string
        const homeId = teamsByAbbr.get(`${sport}:${(g.home_team_abbr ?? '').toUpperCase()}`)
          ?? teamsByName.get(`${sport}:${(g.home_team_name ?? '').toLowerCase()}`)
        const awayId = teamsByAbbr.get(`${sport}:${(g.away_team_abbr ?? '').toUpperCase()}`)
          ?? teamsByName.get(`${sport}:${(g.away_team_name ?? '').toLowerCase()}`)
        if (homeId || awayId) {
          await supabaseAdmin.from('games').update({ home_team_id: homeId ?? null, away_team_id: awayId ?? null }).eq('id', g.id)
          linked++
        }
      }
      results['team_links'] = `${linked}/${unlinked.length} games linked to teams`
    }
  } catch (e: unknown) {
    results['team_links'] = `error: ${e instanceof Error ? e.message : String(e)}`
  }

  // ---- Link games to stadiums by home-team abbreviation -------
  // Lets sync-weather find a venue + coordinates for new games.
  try {
    const { data: unlinkedVenue } = await supabaseAdmin
      .from('games')
      .select('id, sport, home_team_abbr')
      .is('stadium_id', null)
      .in('sport', ['MLB', 'NFL'])
      .gte('scheduled_at', new Date(Date.now() - 86400000).toISOString())

    if (unlinkedVenue && unlinkedVenue.length > 0) {
      const { data: stadiums } = await supabaseAdmin.from('stadiums').select('id, name, sport')
      const stadiumByName = new Map<string, string>()  // `${sport}:${name}` → id
      for (const s of stadiums ?? []) stadiumByName.set(`${s.sport}:${s.name}`, s.id)

      let linked = 0
      for (const g of unlinkedVenue) {
        const sport = g.sport as string
        const name = STADIUM_BY_ABBR[sport]?.[(g.home_team_abbr ?? '').toUpperCase()]
        const stadiumId = name ? stadiumByName.get(`${sport}:${name}`) : undefined
        if (stadiumId) {
          await supabaseAdmin.from('games').update({ stadium_id: stadiumId }).eq('id', g.id)
          linked++
        }
      }
      results['stadium_links'] = `${linked}/${unlinkedVenue.length} games linked to stadiums`
    }
  } catch (e: unknown) {
    results['stadium_links'] = `error: ${e instanceof Error ? e.message : String(e)}`
  }

  return c.json({
    success: true,
    job: 'sync-scores',
    duration_ms: Date.now() - start,
    timestamp: new Date().toISOString(),
    results,
  })
})

// ============================================================
// GET /api/cron/sync-odds
// Fetches current lines from The Odds API and upserts them
// ============================================================
cron.get('/sync-odds', async (c) => {
  const start = Date.now()
  const results: Record<string, string> = {}

  const month = new Date().getMonth() + 1  // 1-12
  const activeSports: SportKey[] = [
    ...(month >= 10 || month <= 6 ? ['NBA'] as SportKey[] : []),
    ...(month >= 9 || month <= 1 ? ['NFL'] as SportKey[] : []),
    ...(month >= 4 && month <= 10 ? ['MLB'] as SportKey[] : []),
    ...(month >= 10 || month <= 6 ? ['NHL'] as SportKey[] : []),
  ]

  if (activeSports.length === 0) {
    return c.json({ success: true, job: 'sync-odds', message: 'No active sports this month', results })
  }

  // Fetch sportsbooks once (needed for resolving IDs)
  const { data: sportsbooks } = await supabaseAdmin.from('sportsbooks').select('id, key')
  const bookMap = Object.fromEntries((sportsbooks ?? []).map(b => [b.key, b.id]))

  for (const sport of activeSports) {
    try {
      const events = await fetchOdds(sport, ['spreads', 'h2h', 'totals'])
      const normalized = events.map(e => normalizeOddsEvent(e, sport))

      // Fetch relevant games in one query
      const externalIds = normalized.map(e => e.externalId)
      const { data: games } = await supabaseAdmin
        .from('games')
        .select('id, external_id')
        .in('external_id', externalIds)
      const gameMap = Object.fromEntries((games ?? []).map(g => [g.external_id, g.id]))

      const oddsRows: Record<string, unknown>[] = []
      for (const event of normalized) {
        for (const line of event.lines) {
          const bookId = bookMap[line.sportsbookKey]
          if (!bookId) continue

          const row: Record<string, unknown> = {
            sportsbook_id: bookId,
            sport,
            game_external_id: event.externalId,
            home_team: event.homeTeamName,
            away_team: event.awayTeamName,
            scheduled_at: event.scheduledAt,
            market_type: line.market,
            outcome_name: line.outcomeName,
            outcome_type: line.outcomeType,
            price: line.price,
            point: line.point ?? null,
            implied_prob: line.impliedProb,
            fetched_at: new Date().toISOString(),
          }
          if (gameMap[event.externalId]) row.game_id = gameMap[event.externalId]
          oddsRows.push(row)
        }
      }

      if (oddsRows.length > 0) {
        const { error } = await supabaseAdmin
          .from('odds')
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .upsert(oddsRows as any[], {
            onConflict: 'sportsbook_id,game_external_id,market_type,outcome_name',
            ignoreDuplicates: false,
          })
        results[sport] = error
          ? `error: ${error.message}`
          : `${events.length} events, ${oddsRows.length} lines upserted`
      } else {
        results[sport] = `${events.length} events, 0 lines (no matching sportsbooks)`
      }
    } catch (e: unknown) {
      results[sport] = `error: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  // ---- Link odds → games by team name + date -----------------
  // The Odds API uses its own event id (game_external_id), which never
  // matches the games table's external_id (e.g. `mlb_<gamePk>` from MLB
  // Stats, `espn_<id>` from ESPN). Without this step odds rows keep
  // game_id = null and the game-detail / odds / props endpoints (which
  // join on game_id) return empty. Match instead on sport + both team
  // names + calendar date, then backfill game_id in batches per game.
  try {
    const windowStart = new Date(Date.now() - 86400000).toISOString()
    const windowEnd = new Date(Date.now() + 86400000 * 2).toISOString()

    const dayKey = (sport: string, home: string, away: string, iso: string) =>
      `${sport}|${(home || '').toLowerCase().trim()}|${(away || '').toLowerCase().trim()}|${new Date(iso).toISOString().slice(0, 10)}`

    const { data: recentGames } = await supabaseAdmin
      .from('games')
      .select('id, sport, home_team_name, away_team_name, scheduled_at')
      .gte('scheduled_at', windowStart)
      .lte('scheduled_at', windowEnd)

    const gameKeyToId = new Map<string, string>()
    for (const g of recentGames ?? []) {
      gameKeyToId.set(dayKey(g.sport as string, g.home_team_name as string, g.away_team_name as string, g.scheduled_at as string), g.id as string)
    }

    const { data: unlinkedOdds } = await supabaseAdmin
      .from('odds')
      .select('id, sport, home_team, away_team, scheduled_at')
      .is('game_id', null)
      .gte('scheduled_at', windowStart)

    // Group odds ids by the game UUID they should link to
    const idsByGame = new Map<string, string[]>()
    for (const o of unlinkedOdds ?? []) {
      const gid = gameKeyToId.get(dayKey(o.sport as string, o.home_team as string, o.away_team as string, o.scheduled_at as string))
      if (!gid) continue
      if (!idsByGame.has(gid)) idsByGame.set(gid, [])
      idsByGame.get(gid)!.push(o.id as string)
    }

    let linked = 0
    for (const [gid, ids] of idsByGame) {
      const { error } = await supabaseAdmin.from('odds').update({ game_id: gid }).in('id', ids)
      if (!error) linked += ids.length
    }
    results['game_links'] = `${linked} odds rows linked to games`
  } catch (e: unknown) {
    results['game_links'] = `error: ${e instanceof Error ? e.message : String(e)}`
  }

  // ---- Record line movement ----------------------------------
  // The "Line Movement" panel needs a time series. Each sync run compares
  // the current line per (game, book, market, outcome) to the latest sample
  // already recorded and inserts a new row only when price/point changed
  // (or there's no prior sample). History therefore accrues across runs.
  try {
    const windowStart = new Date(Date.now() - 86400000).toISOString()
    const trackedMarkets = ['spreads', 'h2h']

    const { data: curOdds } = await supabaseAdmin
      .from('odds')
      .select('game_id, sportsbook_id, market_type, outcome_type, price, point')
      .not('game_id', 'is', null)
      .in('market_type', trackedMarkets)
      .gte('scheduled_at', windowStart)

    const gameIds = Array.from(new Set((curOdds ?? []).map(o => o.game_id as string)))
    const lmKey = (g: string, b: string, m: string, o: string) => `${g}|${b}|${m}|${o}`

    // Latest recorded sample per key
    const lastByKey = new Map<string, { price_new: number; point_new: number | null }>()
    if (gameIds.length > 0) {
      const { data: recentLm } = await supabaseAdmin
        .from('line_movement')
        .select('game_id, sportsbook_id, market, outcome_type, price_new, point_new, moved_at')
        .in('game_id', gameIds)
        .order('moved_at', { ascending: false })
      for (const r of recentLm ?? []) {
        const k = lmKey(r.game_id as string, r.sportsbook_id as string, r.market as string, r.outcome_type as string)
        if (!lastByKey.has(k)) lastByKey.set(k, { price_new: Number(r.price_new), point_new: r.point_new == null ? null : Number(r.point_new) })
      }
    }

    const lmRows: Record<string, unknown>[] = []
    for (const o of curOdds ?? []) {
      if (o.price == null || !o.sportsbook_id || !o.outcome_type) continue
      const k = lmKey(o.game_id as string, o.sportsbook_id as string, o.market_type as string, o.outcome_type as string)
      const last = lastByKey.get(k)
      const curPoint = o.point == null ? null : Number(o.point)
      const changed = !last || last.price_new !== Number(o.price) || (last.point_new ?? null) !== curPoint
      if (!changed) continue
      lmRows.push({
        game_id: o.game_id,
        sportsbook_id: o.sportsbook_id,
        market: o.market_type,
        outcome_type: o.outcome_type,
        price_old: last ? last.price_new : Number(o.price),
        price_new: Number(o.price),
        point_old: last ? last.point_new : curPoint,
        point_new: curPoint,
        move_magnitude: last && curPoint != null && last.point_new != null
          ? Math.abs(curPoint - last.point_new)
          : 0,
        moved_at: new Date().toISOString(),
      })
      // avoid duplicate inserts within this run for the same key
      lastByKey.set(k, { price_new: Number(o.price), point_new: curPoint })
    }

    if (lmRows.length > 0) {
      const { error } = await supabaseAdmin.from('line_movement').insert(lmRows as never[])
      results['line_movement'] = error ? `error: ${error.message}` : `${lmRows.length} movement samples recorded`
    } else {
      results['line_movement'] = '0 movement samples (no changes)'
    }
  } catch (e: unknown) {
    results['line_movement'] = `error: ${e instanceof Error ? e.message : String(e)}`
  }

  return c.json({
    success: true,
    job: 'sync-odds',
    duration_ms: Date.now() - start,
    timestamp: new Date().toISOString(),
    results,
  })
})

// ============================================================
// GET /api/cron/sync-teams-players
// Fetches all teams from ESPN and rosters for today's games
// ============================================================
cron.get('/sync-teams-players', async (c) => {
  const start = Date.now()
  const results: Record<string, string> = {}

  const BASE = process.env.ESPN_API_BASE || 'https://site.api.espn.com/apis/site/v2/sports'
  const syncSports: SportKey[] = ['NBA', 'NFL', 'MLB', 'NHL', 'WNBA']

  for (const sport of syncSports) {
    const path = ESPN_SPORT_PATHS[sport]
    if (!path) continue

    try {
      // ---- Fetch all teams for this sport -------------------------
      const res = await fetch(`${BASE}/${path}/teams?limit=100`, {
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) { results[sport] = `HTTP ${res.status}`; continue }

      const data = await res.json() as {
        sports?: Array<{
          leagues?: Array<{
            teams?: Array<{
              team: {
                id: string
                displayName: string
                shortDisplayName?: string
                name?: string
                abbreviation: string
                location: string
                logos?: Array<{ href: string }>
                color?: string
                alternateColor?: string
                isActive?: boolean
              }
            }>
          }>
        }>
      }

      const rawTeams = data.sports?.[0]?.leagues?.[0]?.teams ?? []
      if (rawTeams.length === 0) { results[sport] = '0 teams found'; continue }

      const teamRows = rawTeams.map(({ team: t }) => ({
        sport,
        external_id: `espn_${t.id}`,
        abbreviation: t.abbreviation,
        // full_name is a GENERATED column (city || ' ' || name) — never insert it
        name: t.name || t.shortDisplayName || t.displayName,
        city: t.location || t.displayName,
        logo_url: t.logos?.[0]?.href ?? null,
        primary_color: t.color ? `#${t.color}` : null,
        secondary_color: t.alternateColor ? `#${t.alternateColor}` : null,
        is_active: t.isActive !== false,
        updated_at: new Date().toISOString(),
      }))

      const { error: teamErr } = await supabaseAdmin
        .from('teams')
        .upsert(teamRows, { onConflict: 'sport,abbreviation', ignoreDuplicates: false })

      if (teamErr) { results[sport] = `teams error: ${teamErr.message}`; continue }

      // ---- Fetch rosters for teams playing in next 3 days ---------
      const { data: upcomingGames } = await supabaseAdmin
        .from('games')
        .select('home_team_abbr, away_team_abbr')
        .eq('sport', sport)
        .gte('scheduled_at', new Date(Date.now() - 86400000).toISOString())
        .lte('scheduled_at', new Date(Date.now() + 86400000 * 3).toISOString())

      const activeAbbrs = new Set<string>()
      for (const g of upcomingGames ?? []) {
        if (g.home_team_abbr) activeAbbrs.add(g.home_team_abbr)
        if (g.away_team_abbr) activeAbbrs.add(g.away_team_abbr)
      }

      // Skip roster sync if no upcoming games — avoids syncing all 30+ teams and timing out
      if (activeAbbrs.size === 0) {
        results[sport] = `${rawTeams.length} teams upserted, no upcoming games (rosters skipped)`
        continue
      }

      // Get DB team IDs we just upserted
      const { data: dbTeams } = await supabaseAdmin
        .from('teams')
        .select('id, external_id, abbreviation')
        .eq('sport', sport)

      const extIdToDbId = Object.fromEntries((dbTeams ?? []).map(t => [t.external_id, t.id]))

      // Fetch rosters for active teams only (cap at 12 to avoid timeout)
      const teamsToSync = rawTeams
        .filter(({ team: t }) => activeAbbrs.has(t.abbreviation))
        .slice(0, 12)

      let playerCount = 0
      const rosterErrors: string[] = []
      for (const { team: t } of teamsToSync) {
        try {
          const roster = await fetchTeamRoster(sport, t.id)
          const teamDbId = extIdToDbId[`espn_${t.id}`] ?? null
          const athletes = normalizeRosterAthletes(roster)

          if (athletes.length === 0) {
            rosterErrors.push(`${t.abbreviation}(id=${t.id}):0athletes`)
            continue
          }

          const playerRows = athletes
            .filter(p => p.id)
            .map(p => {
              const posAbbr = typeof p.position === 'object' ? p.position?.abbreviation : undefined
              // full_name is a GENERATED column (first_name || ' ' || last_name) — never insert it
              return {
                sport,
                team_id: teamDbId,
                external_id: `espn_${p.id}`,
                first_name: p.firstName ?? (p.displayName ?? '').split(' ')[0] ?? 'Unknown',
                last_name: p.lastName ?? (p.displayName ?? '').split(' ').slice(1).join(' ') ?? '',
                position: posAbbr ?? null,
                jersey_number: p.jersey ?? null,
                age: p.age ?? null,
                status: (p.injuries?.[0]?.status ?? p.status?.name ?? 'active').toLowerCase(),
                headshot_url: p.headshot?.href ?? null,
                updated_at: new Date().toISOString(),
              }
            })

          if (playerRows.length > 0) {
            const { error: pErr } = await supabaseAdmin
              .from('players')
              .upsert(playerRows, { onConflict: 'external_id', ignoreDuplicates: false })
            if (pErr) rosterErrors.push(`${t.abbreviation}:${pErr.message}`)
            else playerCount += playerRows.length
          }
        } catch (e: unknown) {
          rosterErrors.push(`${t.abbreviation}:${e instanceof Error ? e.message : String(e)}`)
        }
      }

      const errStr = rosterErrors.length > 0 ? ` [${rosterErrors.join('; ')}]` : ''
      results[sport] = `${rawTeams.length} teams, ${playerCount} players upserted${errStr}`
    } catch (e: unknown) {
      results[sport] = `error: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  return c.json({
    success: true,
    job: 'sync-teams-players',
    duration_ms: Date.now() - start,
    timestamp: new Date().toISOString(),
    results,
  })
})

// ============================================================
// GET /api/cron/generate-signals
// Derives sharp signals, EV calculations, and market psychology
// from existing odds data. No external API calls needed.
// ============================================================
cron.get('/generate-signals', async (c) => {
  const start = Date.now()
  const results: Record<string, unknown> = {}

  // ---- Step 1: Get all distinct games from odds ---------------
  const { data: oddsGames } = await supabaseAdmin
    .from('odds')
    .select('game_external_id, sport, home_team, away_team, scheduled_at')
    .order('game_external_id')

  // Deduplicate
  const seen = new Set<string>()
  const uniqueGames: Array<{
    game_external_id: string
    sport: string
    home_team: string
    away_team: string
    scheduled_at: string
  }> = []
  for (const row of oddsGames ?? []) {
    if (row.game_external_id && !seen.has(row.game_external_id)) {
      seen.add(row.game_external_id)
      uniqueGames.push(row as typeof uniqueGames[0])
    }
  }

  if (uniqueGames.length === 0) {
    return c.json({ success: true, job: 'generate-signals', message: 'No odds data found', results })
  }

  // ---- Step 2: Find or create game records --------------------
  const gameIdMap: Record<string, string> = {}  // odds external_id → games UUID

  for (const og of uniqueGames) {
    // Try to find existing game
    const { data: existingGames } = await supabaseAdmin
      .from('games')
      .select('id')
      .eq('sport', og.sport)
      .gte('scheduled_at', new Date(new Date(og.scheduled_at).getTime() - 86400000 / 2).toISOString())
      .lte('scheduled_at', new Date(new Date(og.scheduled_at).getTime() + 86400000 / 2).toISOString())
      .or(`home_team_name.eq.${og.home_team},away_team_name.eq.${og.home_team},home_team_name.eq.${og.away_team},away_team_name.eq.${og.away_team}`)

    if (existingGames && existingGames.length > 0) {
      gameIdMap[og.game_external_id] = existingGames[0].id
    } else {
      // Create a synthetic game record from odds data
      const { data: newGame } = await supabaseAdmin
        .from('games')
        .insert({
          external_id: `odds_${og.game_external_id}`,
          sport: og.sport as SportKey,
          home_team_name: og.home_team,
          away_team_name: og.away_team,
          scheduled_at: og.scheduled_at,
          status: 'scheduled',
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single()
      if (newGame) gameIdMap[og.game_external_id] = newGame.id
    }
  }

  // ---- Step 3: Get sportsbooks map ----------------------------
  const { data: sportsbooks } = await supabaseAdmin.from('sportsbooks').select('id, key')
  const bookIdMap = Object.fromEntries((sportsbooks ?? []).map(b => [b.id, b.key]))

  // ---- Step 4: For each game, fetch odds and compute signals --
  let signalCount = 0
  let evCount = 0
  let psychCount = 0

  for (const og of uniqueGames) {
    const gameId = gameIdMap[og.game_external_id]
    if (!gameId) continue

    // Get all odds for this game
    const { data: gameOdds } = await supabaseAdmin
      .from('odds')
      .select('id, sportsbook_id, market_type, outcome_name, outcome_type, price, implied_prob')
      .eq('game_external_id', og.game_external_id)

    if (!gameOdds || gameOdds.length === 0) continue

    // Filter to valid market types
    const validMarkets = new Set(['h2h', 'spreads', 'totals', 'outrights', 'player_props',
      'team_props', 'alternate_spreads', 'alternate_totals', 'first_half', 'second_half'])

    // Group by market_type + outcome_name
    const outcomeGroups = new Map<string, typeof gameOdds>()
    for (const o of gameOdds) {
      if (!o.market_type || !validMarkets.has(o.market_type)) continue
      const key = `${o.market_type}|${o.outcome_name}`
      if (!outcomeGroups.has(key)) outcomeGroups.set(key, [])
      outcomeGroups.get(key)!.push(o)
    }

    // ---- Sharp signals ------------------------------------------
    const sharpRows: Record<string, unknown>[] = []
    for (const [key, lines] of outcomeGroups) {
      if (lines.length < 3) continue  // need at least 3 books
      const [market, outcomeName] = key.split('|')
      const probs = lines.map(l => Number(l.implied_prob)).filter(p => p > 0)
      if (probs.length < 3) continue

      const avg = probs.reduce((a, b) => a + b, 0) / probs.length
      const variance = probs.reduce((sum, p) => sum + (p - avg) ** 2, 0) / probs.length
      const stdev = Math.sqrt(variance)

      if (stdev >= 0.02) {
        const signal_type = stdev >= 0.04 ? 'steam_move' : 'line_movement'
        const confidence = Math.min(0.95, stdev * 20)
        sharpRows.push({
          game_id: gameId,
          market,
          outcome_type: lines[0].outcome_type ?? 'home',
          signal_type,
          confidence,
          description: `${lines.length} books: avg ${(avg * 100).toFixed(1)}% implied, σ=${(stdev * 100).toFixed(2)}%`,
          triggered_at: new Date().toISOString(),
        })
      }
    }

    if (sharpRows.length > 0) {
      const { error } = await supabaseAdmin
        .from('sharp_signals')
        .upsert(sharpRows as never[], { onConflict: 'game_id,market,outcome_type,signal_type', ignoreDuplicates: false })
      if (!error) signalCount += sharpRows.length
    }

    // ---- EV calculations ----------------------------------------
    // Real +EV = compare each book's price to the CONSENSUS no-vig line.
    // Step 1: build cross-book consensus prob per (market, outcome_name).
    // Step 2: for each book line, ev_pct = consensusNoVigProb × bookDecimal − 1.
    //         Positive means this book is offering better than fair value.

    // Step 1 — consensus no-vig probability per market+outcome
    const outcomeAllLines = new Map<string, number[]>() // key: `market|outcome_name`
    for (const o of gameOdds) {
      if (!o.market_type || !validMarkets.has(o.market_type)) continue
      const p = Number(o.implied_prob ?? 0)
      if (p <= 0) continue
      const k = `${o.market_type}|${o.outcome_name}`
      if (!outcomeAllLines.has(k)) outcomeAllLines.set(k, [])
      outcomeAllLines.get(k)!.push(p)
    }

    // Compute average implied prob per outcome (with vig), then remove vig per-market
    // by normalising so outcomes within a market sum to 1.
    const marketOutcomes = new Map<string, Map<string, number>>() // market → (outcome → avgProb)
    for (const [key, probs] of outcomeAllLines) {
      const [market, outcome] = key.split('|')
      const avg = probs.reduce((a, b) => a + b, 0) / probs.length
      if (!marketOutcomes.has(market)) marketOutcomes.set(market, new Map())
      marketOutcomes.get(market)!.set(outcome, avg)
    }

    // Normalise per market (remove vig) → consensusNoVigProb
    const consensusNoVig = new Map<string, number>() // `market|outcome` → no-vig prob
    for (const [market, outMap] of marketOutcomes) {
      const total = Array.from(outMap.values()).reduce((a, b) => a + b, 0)
      if (total <= 0) continue
      for (const [outcome, avg] of outMap) {
        consensusNoVig.set(`${market}|${outcome}`, avg / total)
      }
    }

    // Step 2 — per-book EV vs consensus
    const evRows: Record<string, unknown>[] = []
    for (const o of gameOdds) {
      if (!o.market_type || !validMarkets.has(o.market_type)) continue
      const price = o.price
      if (!price) continue
      const decimal = price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price)
      const noVigProb = consensusNoVig.get(`${o.market_type}|${o.outcome_name}`) ?? 0
      if (noVigProb <= 0) continue

      const evPct = parseFloat((noVigProb * decimal - 1).toFixed(5))
      const kelly = evPct > 0 ? parseFloat((evPct / (decimal - 1)).toFixed(5)) : 0

      evRows.push({
        game_id: gameId,
        sportsbook_id: o.sportsbook_id,
        market: o.market_type,
        outcome_type: o.outcome_type ?? 'home',
        price,
        no_vig_prob: parseFloat(noVigProb.toFixed(5)),
        ev_pct: evPct,
        kelly_fraction: Math.min(kelly, 0.25),
        is_positive_ev: evPct > 0,
        calculated_at: new Date().toISOString(),
      })
    }

    if (evRows.length > 0) {
      const { error } = await supabaseAdmin
        .from('ev_calculations')
        .upsert(evRows as never[], { onConflict: 'game_id,sportsbook_id,market,outcome_type', ignoreDuplicates: false })
      if (!error) evCount += evRows.length
    }

    // ---- Market psychology --------------------------------------
    const h2hLines = gameOdds.filter(o => o.market_type === 'h2h')
    const spreadsLines = gameOdds.filter(o => o.market_type === 'spreads')

    for (const market of ['h2h', 'spreads', 'totals'] as const) {
      const marketLines = gameOdds.filter(o => o.market_type === market)
      if (marketLines.length < 2) continue

      const probs = marketLines.map(l => Number(l.implied_prob)).filter(p => p > 0)
      if (probs.length === 0) continue

      const avgProb = probs.reduce((a, b) => a + b, 0) / probs.length
      const probRange = Math.max(...probs) - Math.min(...probs)
      const variance = probs.reduce((sum, p) => sum + (p - avgProb) ** 2, 0) / probs.length
      const stdev = Math.sqrt(variance)

      // Sharp consensus: how much do books agree on the top outcome
      const outcomeProbMap = new Map<string, number[]>()
      for (const l of marketLines) {
        if (!outcomeProbMap.has(l.outcome_name)) outcomeProbMap.set(l.outcome_name, [])
        outcomeProbMap.get(l.outcome_name)!.push(Number(l.implied_prob))
      }
      let sharpConsensus: number | null = null
      let topProb = 0
      for (const [, ps] of outcomeProbMap) {
        const avg = ps.reduce((a, b) => a + b, 0) / ps.length
        if (avg > topProb) { topProb = avg; sharpConsensus = parseFloat(avg.toFixed(4)) }
      }

      const lineMovementScore = parseFloat(Math.min(stdev / 0.05, 1).toFixed(4))
      const volatilityScore = parseFloat(Math.min(probRange / 0.1, 1).toFixed(4))
      const overreactionFlag = volatilityScore > 0.6
      const publicFadeSignal = market === 'h2h' && sharpConsensus !== null && sharpConsensus < 0.4

      const psychRow = {
        game_id: gameId,
        market,
        public_fade_signal: publicFadeSignal,
        sharp_consensus: sharpConsensus,
        line_movement_score: lineMovementScore,
        volatility_score: volatilityScore,
        overreaction_flag: overreactionFlag,
        summary: `${marketLines.length} lines across books. Movement score: ${lineMovementScore}. ${overreactionFlag ? 'High volatility detected.' : ''}`,
        calculated_at: new Date().toISOString(),
      }

      const { error } = await supabaseAdmin
        .from('market_psychology')
        .upsert(psychRow, { onConflict: 'game_id,market', ignoreDuplicates: false })
      if (!error) psychCount++
    }
  }

  results.games_processed = uniqueGames.length
  results.sharp_signals = signalCount
  results.ev_calculations = evCount
  results.market_psychology = psychCount

  return c.json({
    success: true,
    job: 'generate-signals',
    duration_ms: Date.now() - start,
    timestamp: new Date().toISOString(),
    results,
  })
})

// ============================================================
// GET /api/cron/generate-research-cards
// Calls Claude AI to generate public research cards for today's games
// ============================================================
cron.get('/generate-research-cards', async (c) => {
  const start = Date.now()

  // Fetch today's top games with odds context (limit to 5 to control AI cost)
  const { data: todayGames } = await supabaseAdmin
    .from('games')
    .select('id, sport, home_team_name, away_team_name, home_team_abbr, away_team_abbr, scheduled_at')
    .gte('scheduled_at', new Date(Date.now() - 3600000).toISOString())
    .lte('scheduled_at', new Date(Date.now() + 86400000 * 2).toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(5)

  if (!todayGames || todayGames.length === 0) {
    return c.json({ success: true, job: 'generate-research-cards', message: 'No games found', cards: 0 })
  }

  let cardCount = 0
  const errors: string[] = []

  for (const game of todayGames) {
    try {
      // Check if we already have a card for this game today
      const { data: existing } = await supabaseAdmin
        .from('ai_research_cards')
        .select('id')
        .eq('game_id', game.id)
        .eq('card_type', 'matchup')
        .gte('generated_at', new Date(Date.now() - 86400000).toISOString())
        .limit(1)

      if (existing && existing.length > 0) { errors.push(`${game.id}:already_exists`); continue }

      // Get odds context for this game
      const { data: gameOdds } = await supabaseAdmin
        .from('odds')
        .select('market_type, outcome_name, price, implied_prob')
        .eq('sport', game.sport)
        .or(`home_team.eq.${game.home_team_name},away_team.eq.${game.home_team_name}`)
        .limit(20)

      // Build concise context string for the AI
      const oddsLines = (gameOdds ?? [])
        .filter(o => o.market_type === 'h2h' || o.market_type === 'spreads')
        .slice(0, 8)
        .map(o => `${o.outcome_name} (${o.market_type}): ${o.price > 0 ? '+' : ''}${o.price} | ${(Number(o.implied_prob) * 100).toFixed(1)}%`)
        .join('\n')

      // Get market psychology if available
      const { data: psych } = await supabaseAdmin
        .from('market_psychology')
        .select('sharp_consensus, line_movement_score, public_fade_signal, overreaction_flag')
        .eq('game_id', game.id)
        .eq('market', 'h2h')
        .single()

      const psychInfo = psych
        ? `Sharp consensus: ${((psych.sharp_consensus ?? 0) * 100).toFixed(1)}% | Line movement: ${psych.line_movement_score} | Public fade: ${psych.public_fade_signal} | Overreaction: ${psych.overreaction_flag}`
        : 'No market psychology data available'

      const gameTime = new Date(game.scheduled_at).toLocaleString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: true })

      const prompt = `Analyze this upcoming ${game.sport} matchup for ORACLE HELIX users:

**${game.away_team_name} @ ${game.home_team_name}** — ${gameTime} ET

CURRENT ODDS:
${oddsLines || 'No odds available'}

MARKET INTELLIGENCE:
${psychInfo}

Generate a concise research card with:
1. **MATCHUP OVERVIEW** (2-3 sentences on the key storyline)
2. **MARKET EDGE** (what the odds/market signals suggest)
3. **KEY FACTORS** (2-3 bullet points on what matters most)
4. **INTEL SUMMARY** (one sharp, decisive sentence)

Keep it professional, data-driven, and under 300 words. This is intelligence, not advice.`

      const analysis = await runAgent({
        agentType: 'research',
        messages: [{ role: 'user', content: prompt, timestamp: new Date().toISOString() }],
        sport: game.sport as SportKey,
        maxTokens: 600,
      })

      const homeAbbr = game.home_team_abbr ?? game.home_team_name?.split(' ').pop() ?? '???'
      const awayAbbr = game.away_team_abbr ?? game.away_team_name?.split(' ').pop() ?? '???'

      await supabaseAdmin.from('ai_research_cards').insert({
        user_id: null,  // public card
        game_id: game.id,
        card_type: 'matchup',
        sport: game.sport,
        title: `${awayAbbr} @ ${homeAbbr} — ${game.sport} Intel`,
        headline: `AI matchup analysis for ${game.away_team_name} at ${game.home_team_name}`,
        content: analysis,
        insights: [
          { key: 'sport', value: game.sport, confidence: 1 },
          { key: 'market_edge', value: psych?.public_fade_signal ? 'public_fade' : 'standard', confidence: 0.8 },
        ],
        tags: [game.sport.toLowerCase(), 'matchup', 'research', awayAbbr.toLowerCase(), homeAbbr.toLowerCase()],
        agent_type: 'research',
        is_featured: true,
      })

      cardCount++
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`${game.home_team_abbr ?? game.id}:${msg}`)
    }
  }

  return c.json({
    success: true,
    job: 'generate-research-cards',
    duration_ms: Date.now() - start,
    timestamp: new Date().toISOString(),
    cards_generated: cardCount,
    games_processed: todayGames.length,
    errors: errors.length > 0 ? errors : undefined,
  })
})

// ============================================================
// GET /api/cron/sync-injuries
// Syncs player injury status from ESPN roster data into player_injuries
// player_injuries requires player_id FK (UUID) — we match via players.external_id
// ============================================================
cron.get('/sync-injuries', async (c) => {
  const start = Date.now()
  const results: Record<string, string> = {}

  // Strategy: pull all players with non-active status from roster syncs,
  // then upsert into player_injuries using the player UUID FK.
  const sports: SportKey[] = ['NBA', 'NFL', 'MLB', 'NHL', 'WNBA']

  for (const sport of sports) {
    try {
      // Find players with non-active status (populated by sync-teams-players)
      const { data: injuredPlayers } = await supabaseAdmin
        .from('players')
        .select('id, full_name, status, team_id')
        .eq('sport', sport)
        .not('status', 'in', '("active","Active","active-a")')

      if (!injuredPlayers || injuredPlayers.length === 0) {
        results[sport] = '0 injured players found'
        continue
      }

      // Build player_injuries rows
      const rows = injuredPlayers.map(p => ({
        player_id: p.id,
        injury_type: 'Unknown',  // ESPN roster doesn't provide type; filled in when details available
        status: p.status,
        description: `${p.full_name} listed as ${p.status} per latest roster data`,
        reported_at: new Date().toISOString(),
        is_active: true,
      }))

      // Upsert — use player_id as the conflict key (one active record per player)
      // Since there's no unique constraint on player_id yet, delete existing active + reinsert
      const playerIds = rows.map(r => r.player_id)
      await supabaseAdmin.from('player_injuries').delete().in('player_id', playerIds).eq('is_active', true)

      const { error } = await supabaseAdmin.from('player_injuries').insert(rows)
      results[sport] = error
        ? `error: ${error.message}`
        : `${rows.length} injury records upserted`
    } catch (e: unknown) {
      results[sport] = `error: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  return c.json({
    success: true,
    job: 'sync-injuries',
    duration_ms: Date.now() - start,
    timestamp: new Date().toISOString(),
    results,
  })
})

// ============================================================
// GET /api/cron/sync-props
// Fetches player props per upcoming game from The Odds API and
// upserts the props table. BOUNDED: caps the number of events to
// protect the Odds API monthly quota (player props are billed per
// market and only on plans that include them — a 422 is caught
// per-game and reported, not fatal).
//
// Player props arrive as names; the props table requires a
// player_id FK, so each prop is matched to a player in our DB by
// normalized name within the game's two teams. Unmatched props are
// skipped (we don't fabricate player rows).
//
// Query params:
//   ?limit=N   max events to fetch (default 3, hard cap 8)
// ============================================================
cron.get('/sync-props', async (c) => {
  const start = Date.now()
  const results: Record<string, unknown> = {}
  const limitParam = Number(c.req.query('limit') ?? '3')
  const maxEvents = Math.max(1, Math.min(8, Number.isFinite(limitParam) ? limitParam : 3))

  // Sportsbook key → id
  const { data: sportsbooks } = await supabaseAdmin.from('sportsbooks').select('id, key')
  const bookMap = Object.fromEntries((sportsbooks ?? []).map(b => [b.key, b.id]))

  // Candidate games: linked odds rows that carry the Odds API event id,
  // for games starting soon. One event id per game.
  const { data: oddsRows } = await supabaseAdmin
    .from('odds')
    .select('game_id, game_external_id, sport, scheduled_at')
    .not('game_id', 'is', null)
    .not('game_external_id', 'is', null)
    .gte('scheduled_at', new Date(Date.now() - 3600000).toISOString())
    .lte('scheduled_at', new Date(Date.now() + 86400000 * 2).toISOString())
    .order('scheduled_at', { ascending: true })

  const seenGames = new Set<string>()
  const events: Array<{ gameId: string; eventId: string; sport: SportKey }> = []
  for (const o of oddsRows ?? []) {
    const gid = o.game_id as string
    if (seenGames.has(gid)) continue
    seenGames.add(gid)
    events.push({ gameId: gid, eventId: o.game_external_id as string, sport: o.sport as SportKey })
    if (events.length >= maxEvents) break
  }

  if (events.length === 0) {
    return c.json({ success: true, job: 'sync-props', message: 'No upcoming linked events to fetch props for', results })
  }

  const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
  let totalProps = 0
  const perEvent: Record<string, string> = {}

  for (const ev of events) {
    try {
      // Build player name → id map for this game's two teams
      const { data: game } = await supabaseAdmin
        .from('games')
        .select('home_team_id, away_team_id')
        .eq('id', ev.gameId)
        .single()
      const teamIds = [game?.home_team_id, game?.away_team_id].filter(Boolean) as string[]
      if (teamIds.length === 0) { perEvent[ev.gameId] = 'no team ids'; continue }

      // On-demand roster backfill: if either team has no players synced,
      // pull its ESPN roster now (ESPN is free / unmetered) so prop player
      // names can be matched to player_id. Only the two teams in this game.
      const { data: teamRows } = await supabaseAdmin
        .from('teams')
        .select('id, sport, external_id')
        .in('id', teamIds)
      for (const t of teamRows ?? []) {
        const { count } = await supabaseAdmin
          .from('players')
          .select('id', { count: 'exact', head: true })
          .eq('team_id', t.id)
        if ((count ?? 0) > 0) continue
        const espnId = String(t.external_id ?? '').replace(/^espn_/, '')
        if (!espnId) continue
        try {
          const roster = await fetchTeamRoster(t.sport as SportKey, espnId)
          const athletes = normalizeRosterAthletes(roster)
          const playerRows = athletes.filter(p => p.id).map(p => {
            const posAbbr = typeof p.position === 'object' ? p.position?.abbreviation : undefined
            return {
              sport: t.sport,
              team_id: t.id,
              external_id: `espn_${p.id}`,
              first_name: p.firstName ?? (p.displayName ?? '').split(' ')[0] ?? 'Unknown',
              last_name: p.lastName ?? (p.displayName ?? '').split(' ').slice(1).join(' ') ?? '',
              position: posAbbr ?? null,
              jersey_number: p.jersey ?? null,
              age: p.age ?? null,
              status: (p.injuries?.[0]?.status ?? p.status?.name ?? 'active').toLowerCase(),
              headshot_url: p.headshot?.href ?? null,
              updated_at: new Date().toISOString(),
            }
          })
          if (playerRows.length > 0) {
            await supabaseAdmin.from('players').upsert(playerRows, { onConflict: 'external_id', ignoreDuplicates: false })
          }
        } catch { /* roster backfill is best-effort; unmatched props are skipped below */ }
      }

      const { data: players } = await supabaseAdmin
        .from('players')
        .select('id, full_name')
        .in('team_id', teamIds)
      const nameToId = new Map<string, string>()
      for (const p of players ?? []) nameToId.set(norm(p.full_name as string), p.id as string)

      const outcomes = await fetchPlayerProps(ev.sport, ev.eventId)
      if (outcomes.length === 0) { perEvent[ev.gameId] = '0 prop outcomes returned'; continue }

      // Group by player + stat_type + sportsbook, combine over/under
      type Agg = { line: number; over_price?: number; under_price?: number; bookId: string; playerId: string; stat_type: string }
      const agg = new Map<string, Agg>()
      let unmatched = 0
      for (const o of outcomes) {
        const playerId = nameToId.get(norm(o.player_name))
        if (!playerId) { unmatched++; continue }
        const bookId = bookMap[o.sportsbookKey]
        if (!bookId) continue
        const key = `${playerId}|${o.stat_type}|${bookId}|${o.line}`
        if (!agg.has(key)) agg.set(key, { line: o.line, bookId, playerId, stat_type: o.stat_type })
        const a = agg.get(key)!
        if (o.side === 'over') a.over_price = o.price
        else a.under_price = o.price
      }

      // Only keep complete two-sided props (both prices present & NOT NULL columns)
      const rows = Array.from(agg.values())
        .filter(a => a.over_price != null && a.under_price != null)
        .map(a => ({
          game_id: ev.gameId,
          player_id: a.playerId,
          sportsbook_id: a.bookId,
          stat_type: a.stat_type,
          line: a.line,
          over_price: a.over_price!,
          under_price: a.under_price!,
          is_alternate: false,
          fetched_at: new Date().toISOString(),
        }))

      if (rows.length === 0) {
        perEvent[ev.gameId] = `${outcomes.length} outcomes, 0 matched players (${unmatched} unmatched)`
        continue
      }

      // No upsert conflict key on props → replace this game's props
      await supabaseAdmin.from('props').delete().eq('game_id', ev.gameId)
      const { error } = await supabaseAdmin.from('props').insert(rows)
      if (error) { perEvent[ev.gameId] = `insert error: ${error.message}`; continue }
      totalProps += rows.length
      perEvent[ev.gameId] = `${rows.length} props (${unmatched} unmatched names)`
    } catch (e: unknown) {
      perEvent[ev.gameId] = `error: ${e instanceof Error ? e.message : String(e)}`
    }
  }

  results.events_processed = events.length
  results.props_inserted = totalProps
  results.per_event = perEvent

  return c.json({
    success: true,
    job: 'sync-props',
    duration_ms: Date.now() - start,
    timestamp: new Date().toISOString(),
    results,
  })
})

// ============================================================
// GET /api/cron/sync-weather
// Fetches game-time forecast for upcoming OUTDOOR games (open-air
// stadiums with coordinates) via Open-Meteo (free, no key) and
// stores it in weather_data. Dome games are skipped — no weather
// impact and no point spending a forecast call.
// ============================================================
cron.get('/sync-weather', async (c) => {
  const start = Date.now()
  const results: Record<string, unknown> = {}

  // Upcoming games at open-air stadiums with coordinates
  const { data: games } = await supabaseAdmin
    .from('games')
    .select('id, scheduled_at, stadium_id, stadium:stadiums!inner(id, name, latitude, longitude, is_dome)')
    .gte('scheduled_at', new Date(Date.now() - 3600000).toISOString())
    .lte('scheduled_at', new Date(Date.now() + 86400000 * 3).toISOString())
    .not('stadium_id', 'is', null)

  type GameRow = { id: string; scheduled_at: string; stadium_id: string; stadium?: { id?: string; name?: string; latitude?: number | null; longitude?: number | null; is_dome?: boolean } }
  const candidates = ((games ?? []) as unknown as GameRow[]).filter(g =>
    g.stadium && g.stadium.is_dome === false && g.stadium.latitude != null && g.stadium.longitude != null)

  if (candidates.length === 0) {
    return c.json({ success: true, job: 'sync-weather', message: 'No upcoming outdoor games to fetch weather for', results })
  }

  let stored = 0
  const errors: string[] = []
  for (const g of candidates) {
    try {
      const wx = await fetchGameWeather({
        latitude: Number(g.stadium!.latitude),
        longitude: Number(g.stadium!.longitude),
        gameTime: g.scheduled_at,
      })
      const row = {
        game_id: g.id,
        stadium_id: g.stadium_id,
        forecast_time: wx.forecastTime ?? g.scheduled_at,
        temperature_f: wx.temperatureF ?? null,
        humidity_pct: wx.humidity ?? null,
        wind_speed_mph: wx.windSpeedMph ?? null,
        wind_direction: wx.windDirection ?? null,
        wind_gust_mph: wx.windGustMph ?? null,
        precipitation_in: wx.precipitationIn ?? null,
        precip_chance: wx.precipChance ?? null,
        cloud_cover_pct: wx.cloud_cover_pct ?? null,
        condition: wx.condition ?? null,
        dew_point_f: wx.dew_point_f ?? null,
        impact_score: wx.impactScore ?? null,
        impact_summary: wx.impactSummary ?? null,
        fetched_at: new Date().toISOString(),
      }
      await supabaseAdmin.from('weather_data').delete().eq('game_id', g.id)
      const { error } = await supabaseAdmin.from('weather_data').insert(row)
      if (error) errors.push(`${g.id}:${error.message}`)
      else stored++
    } catch (e: unknown) {
      errors.push(`${g.id}:${e instanceof Error ? e.message : String(e)}`)
    }
  }

  results.outdoor_games = candidates.length
  results.weather_stored = stored
  if (errors.length) results.errors = errors.slice(0, 10)

  return c.json({
    success: true,
    job: 'sync-weather',
    duration_ms: Date.now() - start,
    timestamp: new Date().toISOString(),
    results,
  })
})

// ============================================================
// GET /api/cron/sync-player-stats
// Populates player_game_stats with recent MLB game logs for every
// player that currently has props, so the Props Lab hit-rate chart
// has a real per-game series to draw. Game logs are keyed by
// (player_id, game_date) and stand alone from the games table —
// only today's slate lives in games, but a prop's chart needs the
// player's last ~15 games regardless of whether we track those games.
// Source: MLB Stats API (free, no key). Hitting vs pitching group is
// chosen per player based on whether any of their props is a
// pitcher stat (e.g. pitcher_strikeouts).
// ============================================================
cron.get('/sync-player-stats', async (c) => {
  const start = Date.now()
  const SEASON = String(new Date().getFullYear())
  const MLB = 'https://statsapi.mlb.com/api/v1'
  const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

  try {
    // 1. Players that have props, and whether they need pitching stats
    const { data: props } = await supabaseAdmin.from('props').select('player_id, stat_type')
    const needPitch = new Map<string, boolean>()
    for (const p of props ?? []) {
      const pid = p.player_id as string
      needPitch.set(pid, (needPitch.get(pid) || false) || p.stat_type === 'pitcher_strikeouts')
    }
    const ids = [...needPitch.keys()]
    if (ids.length === 0) {
      return c.json({ success: true, job: 'sync-player-stats', message: 'No prop players to sync', timestamp: new Date().toISOString() })
    }
    const { data: players } = await supabaseAdmin.from('players').select('id, full_name, team_id').in('id', ids)

    // 2. MLB id + team-abbr maps
    const sp = await fetch(`${MLB}/sports/1/players?season=${SEASON}`).then(r => r.json()) as { people?: Array<{ id: number; fullName: string }> }
    const idByName = new Map<string, number>()
    for (const p of sp.people ?? []) idByName.set(norm(p.fullName), p.id)
    const teamsRes = await fetch(`${MLB}/teams?sportId=1`).then(r => r.json()) as { teams?: Array<{ name: string; abbreviation: string }> }
    const abbrByName = new Map<string, string>()
    for (const t of teamsRes.teams ?? []) abbrByName.set(t.name, t.abbreviation)

    // 3. Fetch game logs and build rows
    type Row = { player_id: string; team_id: string | null; game_date: string; opponent_abbr: string | null; source: string; stats: Record<string, number> }
    const rows: Row[] = []
    let matched = 0
    const unmatched: string[] = []
    const work = async (pl: { id: string; full_name: string; team_id: string | null }) => {
      const mlbId = idByName.get(norm(pl.full_name))
      if (!mlbId) { unmatched.push(pl.full_name); return }
      matched++
      const group = needPitch.get(pl.id) ? 'pitching' : 'hitting'
      try {
        const gl = await fetch(`${MLB}/people/${mlbId}/stats?stats=gameLog&group=${group}&season=${SEASON}`).then(r => r.json()) as {
          stats?: Array<{ splits?: Array<{ date?: string; opponent?: { name?: string }; stat?: Record<string, unknown> }> }>
        }
        const splits = (gl.stats?.[0]?.splits ?? []).slice(-15)
        for (const s of splits) {
          const st = s.stat ?? {}
          const stats: Record<string, number> = group === 'pitching'
            ? { strikeouts: Number(st.strikeOuts ?? 0) }
            : { hits: Number(st.hits ?? 0), total_bases: Number(st.totalBases ?? 0), at_bats: Number(st.atBats ?? 0) }
          rows.push({
            player_id: pl.id, team_id: pl.team_id, game_date: s.date as string,
            opponent_abbr: abbrByName.get(s.opponent?.name ?? '') ?? null,
            source: 'mlb_statsapi', stats,
          })
        }
      } catch (e: unknown) { unmatched.push(pl.full_name + ':' + (e instanceof Error ? e.message : String(e))) }
    }
    const list = players ?? []
    for (let i = 0; i < list.length; i += 8) {
      await Promise.all(list.slice(i, i + 8).map(p => work(p as { id: string; full_name: string; team_id: string | null })))
    }

    // Dedup by (player_id, game_date) — doubleheaders yield two splits on one
    // date; the unique index keys on date, so keep the latest game that day.
    const byKey = new Map<string, Row>()
    for (const r of rows) byKey.set(`${r.player_id}|${r.game_date}`, r)
    const deduped = [...byKey.values()].filter(r => r.game_date)

    // 4. Upsert in batches
    let inserted = 0
    let upsertError: string | undefined
    for (let i = 0; i < deduped.length; i += 300) {
      const chunk = deduped.slice(i, i + 300)
      const { error } = await supabaseAdmin.from('player_game_stats')
        .upsert(chunk as never[], { onConflict: 'player_id,game_date', ignoreDuplicates: false })
      if (error) { upsertError = error.message; break }
      inserted += chunk.length
    }

    return c.json({
      success: !upsertError,
      job: 'sync-player-stats',
      duration_ms: Date.now() - start,
      timestamp: new Date().toISOString(),
      results: { prop_players: ids.length, matched, unmatched: unmatched.length, rows: deduped.length, upserted: inserted, error: upsertError },
    })
  } catch (e: unknown) {
    return c.json({ success: false, job: 'sync-player-stats', error: e instanceof Error ? e.message : String(e) }, 500)
  }
})

// ---- Helpers ------------------------------------------------
function mapMlbStatus(abstractState: string): string {
  const map: Record<string, string> = {
    Preview: 'scheduled', Pre: 'scheduled',
    Live: 'live', Final: 'final', Postponed: 'postponed',
  }
  return map[abstractState] ?? 'scheduled'
}

function mapNhlStatus(gameState: string): string {
  const map: Record<string, string> = {
    FUT: 'scheduled', PRE: 'scheduled',
    LIVE: 'live', CRIT: 'live',
    OVER: 'final', OFF: 'final', FINAL: 'final',
  }
  return map[gameState?.toUpperCase()] ?? 'scheduled'
}

export default cron
