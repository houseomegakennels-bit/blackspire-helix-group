import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { getCached, setCache, CacheKey, TTL } from '../../lib/redis.js'
import { optionalAuth } from '../middleware/auth.js'

const router = new Hono()

// GET /api/players — search players
router.get('/', optionalAuth, async (c) => {
  const sport = c.req.query('sport')
  const teamId = c.req.query('team_id')
  const search = c.req.query('search')
  const position = c.req.query('position')

  let query = supabaseAdmin
    .from('players')
    .select('*, team:teams(abbreviation, name, city, logo_url)')
    .or('status.eq.active,status.eq.Active,status.eq.active-a')

  if (sport) query = query.eq('sport', sport)
  if (teamId) query = query.eq('team_id', teamId)
  if (position) query = query.eq('position', position)
  if (search) query = query.ilike('full_name', `%${search}%`)

  query = query.order('last_name').limit(50)

  const { data, error } = await query
  if (error) return c.json({ success: false, error: error.message }, 500)

  return c.json({ success: true, data, meta: { total: data?.length ?? 0 } })
})

// GET /api/players/:id — player detail with stats
router.get('/:id', optionalAuth, async (c) => {
  const id = c.req.param('id')

  const cacheKey = CacheKey.playerStats(id)
  const cached = await getCached(cacheKey)
  if (cached) return c.json({ success: true, data: cached, meta: { cached: true } })

  const { data: player, error } = await supabaseAdmin
    .from('players')
    .select('*, team:teams(*)')
    .eq('id', id)
    .single()

  if (error) return c.json({ success: false, error: 'Player not found' }, 404)

  // Fetch recent game stats
  const { data: recentStats } = await supabaseAdmin
    .from('player_game_stats')
    .select('*, game:games(scheduled_at, status, home_team:teams!games_home_team_id_fkey(abbreviation), away_team:teams!games_away_team_id_fkey(abbreviation))')
    .eq('player_id', id)
    // game_date drives standalone game logs; fall back to created_at for legacy
    // rows that were tied to a scheduled game instead of a date.
    .order('game_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(15)

  // Fetch active injuries
  const { data: injuries } = await supabaseAdmin
    .from('player_injuries')
    .select('*')
    .eq('player_id', id)
    .eq('is_active', true)

  // Fetch current props
  const { data: currentProps } = await supabaseAdmin
    .from('props')
    .select('*, sportsbook:sportsbooks(key, name)')
    .eq('player_id', id)
    .order('fetched_at', { ascending: false })
    .limit(20)

  const enriched = { ...player, recentStats: recentStats ?? [], injuries: injuries ?? [], currentProps: currentProps ?? [] }
  await setCache(cacheKey, enriched, TTL.PLAYER_STATS)

  return c.json({ success: true, data: enriched })
})

// GET /api/players/:id/props — all props for a player
router.get('/:id/props', optionalAuth, async (c) => {
  const id = c.req.param('id')

  const { data, error } = await supabaseAdmin
    .from('props')
    .select('*, game:games(scheduled_at, home_team:teams!games_home_team_id_fkey(abbreviation), away_team:teams!games_away_team_id_fkey(abbreviation)), sportsbook:sportsbooks(key, name)')
    .eq('player_id', id)
    .gte('fetched_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('stat_type')

  if (error) return c.json({ success: false, error: error.message }, 500)
  return c.json({ success: true, data })
})

// GET /api/players/:id/spray-chart — MLB spray chart data
router.get('/:id/spray-chart', optionalAuth, async (c) => {
  const id = c.req.param('id')
  const season = c.req.query('season') ?? new Date().getFullYear().toString()

  const { data, error } = await supabaseAdmin
    .from('mlb_spray_charts')
    .select('*')
    .eq('player_id', id)
    .gte('created_at', `${season}-01-01`)
    .lte('created_at', `${season}-12-31`)

  if (error) return c.json({ success: false, error: error.message }, 500)
  return c.json({ success: true, data, meta: { season } })
})

// GET /api/players/:id/pitch-data — MLB pitcher data
router.get('/:id/pitch-data', optionalAuth, async (c) => {
  const id = c.req.param('id')

  const { data, error } = await supabaseAdmin
    .from('mlb_pitch_data')
    .select('*')
    .eq('pitcher_id', id)
    .order('game_date', { ascending: false })
    .limit(30)

  if (error) return c.json({ success: false, error: error.message }, 500)
  return c.json({ success: true, data })
})

export default router
