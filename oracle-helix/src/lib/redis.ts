import { Redis } from '@upstash/redis'

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

// TTL constants (seconds)
export const TTL = {
  LIVE_ODDS: 30,          // 30s for live game odds
  ODDS: 120,              // 2m for pre-game odds
  GAMES_TODAY: 300,       // 5m for today's schedule
  PLAYER_STATS: 600,      // 10m for player stats
  MATCHUP_REPORT: 1800,   // 30m for AI-generated matchup report
  WEATHER: 900,           // 15m for weather data
  MARKET_PSYCH: 300,      // 5m for market psychology
  SIMULATIONS: 3600,      // 1h for simulation results
  RESEARCH_CARDS: 7200,   // 2h for AI research cards
  SPORTS_META: 86400,     // 24h for teams, players (rarely changes)
}

export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const val = await redis.get<T>(key)
    return val
  } catch {
    return null
  }
}

export async function setCache<T>(key: string, value: T, ttl: number): Promise<void> {
  try {
    await redis.set(key, value, { ex: ttl })
  } catch {
    // Non-fatal: cache miss is acceptable
  }
}

export async function invalidatePattern(pattern: string): Promise<void> {
  try {
    const keys = await redis.keys(pattern)
    if (keys.length > 0) {
      await redis.del(...keys)
    }
  } catch {
    // Non-fatal
  }
}

// Cache key builders — consistent naming across the codebase
export const CacheKey = {
  todaysGames: (sport?: string) => `oracle:games:today:${sport ?? 'all'}`,
  gameOdds: (gameId: string) => `oracle:odds:game:${gameId}`,
  gameProps: (gameId: string) => `oracle:props:game:${gameId}`,
  lineMovement: (gameId: string) => `oracle:lines:game:${gameId}`,
  matchupReport: (gameId: string) => `oracle:matchup:${gameId}`,
  weatherData: (gameId: string) => `oracle:weather:game:${gameId}`,
  marketPsych: (gameId: string) => `oracle:market:game:${gameId}`,
  playerStats: (playerId: string) => `oracle:player:${playerId}:stats`,
  positiveEv: () => `oracle:ev:positive`,
  sharpFeed: () => `oracle:sharp:feed`,
  teams: (sport: string) => `oracle:teams:${sport}`,
  players: (teamId: string) => `oracle:players:team:${teamId}`,
}
