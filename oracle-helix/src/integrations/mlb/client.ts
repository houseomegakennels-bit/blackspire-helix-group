// MLB Stats API — Official, free, no key required
// Docs: https://statsapi.mlb.com/api/v1

const BASE = process.env.MLB_API_BASE || 'https://statsapi.mlb.com/api/v1'

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } })
  if (!res.ok) throw new Error(`MLB API error: ${res.status}`)
  return res.json() as T
}

export async function fetchTodaySchedule() {
  const today = new Date().toISOString().split('T')[0]
  return get<MlbScheduleResponse>('/schedule', {
    sportId: '1',
    date: today,
    hydrate: 'team,linescore,probablePitcher,weather',
  })
}

// Fetch a multi-day schedule window (inclusive). YYYY-MM-DD dates. The MLB
// Stats API returns one entry per calendar day under `dates`; callers flatten
// across all days. Used to keep the games board populated several days out.
export async function fetchScheduleRange(startDate: string, endDate: string) {
  return get<MlbScheduleResponse>('/schedule', {
    sportId: '1',
    startDate,
    endDate,
    hydrate: 'team,linescore,probablePitcher,weather',
  })
}

export async function fetchGameProbablePitchers(gamePk: string) {
  return get<unknown>(`/game/${gamePk}/boxscore`)
}

export async function fetchPlayerPitchingStats(playerId: string, season: string) {
  return get<unknown>(`/people/${playerId}/stats`, {
    stats: 'season',
    season,
    group: 'pitching',
  })
}

export async function fetchPlayerBattingStats(playerId: string, season: string) {
  return get<unknown>(`/people/${playerId}/stats`, {
    stats: 'season',
    season,
    group: 'hitting',
  })
}

export async function fetchTeamRoster(teamId: string) {
  return get<unknown>(`/teams/${teamId}/roster`, { rosterType: '40Man' })
}

export async function fetchVenueWeather(gamePk: string) {
  const data = await get<{ gameData: { weather?: MlbWeather; venue?: { location?: { defaultCoordinates?: { latitude: number; longitude: number } } } } }>(`/game/${gamePk}/feed/live`)
  return {
    weather: data.gameData.weather,
    coordinates: data.gameData.venue?.location?.defaultCoordinates,
  }
}

export interface MlbScheduleResponse {
  dates: Array<{
    date: string
    games: MlbGame[]
  }>
}

export interface MlbGame {
  gamePk: number
  gameDate: string
  status: { detailedState: string; abstractGameState: string }
  teams: {
    home: MlbTeamEntry
    away: MlbTeamEntry
  }
  venue: { id: number; name: string }
  weather?: MlbWeather
  probablePitchers?: {
    home?: MlbPitcher
    away?: MlbPitcher
  }
}

export interface MlbTeamEntry {
  team: { id: number; name: string; abbreviation?: string }
  score?: number
}

export interface MlbPitcher {
  id: number
  fullName: string
  stats?: { era: string; wins: number; losses: number; strikeOuts: number }
}

export interface MlbWeather {
  condition: string
  temp: string
  wind: string
}
