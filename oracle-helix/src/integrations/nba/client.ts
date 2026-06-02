// Ball Don't Lie — NBA Stats API (free tier)
// Docs: https://docs.balldontlie.io

const BASE = process.env.BALLDONTLIE_API_BASE || 'https://api.balldontlie.io/v1'
const KEY = process.env.BALLDONTLIE_API_KEY

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString(), {
    headers: {
      'Accept': 'application/json',
      ...(KEY ? { Authorization: KEY } : {}),
    },
  })
  if (!res.ok) throw new Error(`BallDontLie NBA error: ${res.status}`)
  return res.json() as T
}

export async function fetchTodayGames() {
  const today = new Date().toISOString().split('T')[0]
  return get<BdlGamesResponse>('/games', { dates: today, per_page: '25' })
}

export async function fetchPlayerStats(playerId: string, season: string) {
  return get<BdlStatsResponse>('/season_averages', { season, player_ids: playerId })
}

export async function fetchPlayerGameLog(playerId: string) {
  return get<BdlStatsResponse>('/stats', {
    player_ids: playerId,
    per_page: '20',
    sort: 'date',
    direction: 'desc',
  })
}

export async function fetchLiveBoxscores() {
  return get<BdlBoxscoreResponse>('/box_scores/live')
}

export async function fetchInjuries() {
  return get<BdlInjuriesResponse>('/injuries')
}

export interface BdlGamesResponse {
  data: BdlGame[]
  meta: { total_pages: number; current_page: number }
}

export interface BdlGame {
  id: number
  date: string
  home_team: BdlTeam
  visitor_team: BdlTeam
  home_team_score: number
  visitor_team_score: number
  status: string
  period: number
  time: string
  postseason: boolean
  season: number
}

export interface BdlTeam {
  id: number
  abbreviation: string
  city: string
  conference: string
  division: string
  full_name: string
  name: string
}

export interface BdlStatsResponse {
  data: Array<{
    pts: number
    reb: number
    ast: number
    stl: number
    blk: number
    min: string
    fgm: number
    fga: number
    fg3m: number
    fg3a: number
    ftm: number
    fta: number
    turnover: number
    player: { id: number; first_name: string; last_name: string }
    team: BdlTeam
    game: { id: number; date: string }
  }>
}

export interface BdlBoxscoreResponse {
  data: Array<{
    game: BdlGame
    home_team_score: number
    visitor_team_score: number
  }>
}

export interface BdlInjuriesResponse {
  data: Array<{
    player: { id: number; first_name: string; last_name: string; team: BdlTeam }
    status: string
    return_date?: string
    description: string
  }>
}
