// NHL Stats API v1 — Official, free, no key required
// Docs: https://api-web.nhle.com/v1

const BASE = process.env.NHL_API_BASE || 'https://api-web.nhle.com/v1'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: { 'Accept': 'application/json' } })
  if (!res.ok) throw new Error(`NHL API error: ${res.status}`)
  return res.json() as T
}

export async function fetchTodaySchedule() {
  const today = new Date().toISOString().split('T')[0]
  return get<NhlScheduleDay>(`/schedule/${today}`)
}

export async function fetchGameBoxscore(gameId: string) {
  return get<unknown>(`/gamecenter/${gameId}/boxscore`)
}

export async function fetchPlayerGameLog(playerId: string, season: string) {
  return get<unknown>(`/player/${playerId}/game-log/${season}/2`)  // 2 = regular season
}

export async function fetchTeamRoster(teamAbbrev: string) {
  return get<NhlRoster>(`/roster/${teamAbbrev}/current`)
}

export async function fetchStandings() {
  return get<unknown>('/standings/now')
}

export interface NhlScheduleDay {
  gameWeek: Array<{
    date: string
    games: NhlGame[]
  }>
}

export interface NhlGame {
  id: number
  season: number
  gameType: number
  gameDate: string
  startTimeUTC: string
  gameState: string
  homeTeam: { abbrev: string; name: Record<string, string>; score?: number; id: number }
  awayTeam: { abbrev: string; name: Record<string, string>; score?: number; id: number }
  venue: { default: string }
  period?: number
  clock?: { timeRemaining: string }
}

export interface NhlRoster {
  forwards: NhlPlayer[]
  defensemen: NhlPlayer[]
  goalies: NhlPlayer[]
}

export interface NhlPlayer {
  id: number
  headshot: string
  firstName: Record<string, string>
  lastName: Record<string, string>
  sweaterNumber: number
  positionCode: string
  shootsCatches: string
  heightInInches: number
  weightInPounds: number
  birthDate: string
  birthCountry: string
}
