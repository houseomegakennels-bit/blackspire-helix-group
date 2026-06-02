import { Hono } from 'hono'
import { supabaseAdmin } from '../../lib/supabase.js'
import { getCached, setCache, CacheKey, TTL } from '../../lib/redis.js'
import { fetchGameWeather } from '../../engines/weather/index.js'
import { optionalAuth } from '../middleware/auth.js'

const router = new Hono()

// GET /api/weather/:gameId — weather for a specific game
router.get('/:gameId', optionalAuth, async (c) => {
  const gameId = c.req.param('gameId')
  const forceRefresh = c.req.query('refresh') === 'true'

  const cacheKey = CacheKey.weatherData(gameId)
  if (!forceRefresh) {
    const cached = await getCached(cacheKey)
    if (cached) return c.json({ success: true, data: cached, meta: { cached: true } })
  }

  // Check DB first
  const { data: existing } = await supabaseAdmin
    .from('weather_data')
    .select('*')
    .eq('game_id', gameId)
    .gte('fetched_at', new Date(Date.now() - TTL.WEATHER * 1000).toISOString())
    .order('fetched_at', { ascending: false })
    .limit(1)
    .single()

  if (existing && !forceRefresh) {
    await setCache(cacheKey, existing, TTL.WEATHER)
    return c.json({ success: true, data: existing })
  }

  // Fetch fresh weather
  const { data: game } = await supabaseAdmin
    .from('games')
    .select('scheduled_at, stadium:stadiums(latitude, longitude, is_dome)')
    .eq('id', gameId)
    .single()

  if (!game) return c.json({ success: false, error: 'Game not found' }, 404)

  const stadium = game.stadium as { latitude?: number; longitude?: number; is_dome?: boolean } | null

  if (stadium?.is_dome) {
    const domeData = {
      game_id: gameId,
      forecast_time: game.scheduled_at,
      condition: 'dome',
      impact_score: 0,
      impact_summary: 'Indoor stadium — no weather impact',
      fetched_at: new Date().toISOString(),
    }
    await setCache(cacheKey, domeData, TTL.WEATHER)
    return c.json({ success: true, data: domeData })
  }

  if (!stadium?.latitude || !stadium?.longitude) {
    return c.json({ success: false, error: 'Stadium location not available' }, 404)
  }

  const weatherData = await fetchGameWeather({
    latitude: stadium.latitude,
    longitude: stadium.longitude,
    gameTime: game.scheduled_at,
  })

  // Save to DB
  const { data: saved } = await supabaseAdmin
    .from('weather_data')
    .upsert({ ...weatherData, game_id: gameId })
    .select()
    .single()

  await setCache(cacheKey, saved, TTL.WEATHER)
  return c.json({ success: true, data: saved })
})

// GET /api/weather/today — all outdoor games today with weather
router.get('/', optionalAuth, async (c) => {
  const sport = c.req.query('sport')

  const { data, error } = await supabaseAdmin
    .from('weather_data')
    .select('*, game:games(sport, scheduled_at, home_team:teams!games_home_team_id_fkey(abbreviation), away_team:teams!games_away_team_id_fkey(abbreviation))')
    .gte('fetched_at', new Date(Date.now() - TTL.WEATHER * 1000).toISOString())
    .gt('impact_score', 0.1)
    .order('impact_score', { ascending: false })
    .limit(20)

  if (error) return c.json({ success: false, error: error.message }, 500)
  return c.json({ success: true, data: data ?? [] })
})

export default router
