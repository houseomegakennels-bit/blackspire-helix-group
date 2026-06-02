// ESPN Unofficial API — no key required, public endpoints
import { ESPN_SPORT_PATHS } from '../../lib/constants.js'
import type { SportKey } from '../../types/index.js'

const BASE = process.env.ESPN_API_BASE || 'https://site.api.espn.com/apis/site/v2/sports'

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Accept': 'application/json' },
  })
  if (!res.ok) throw new Error(`ESPN API error: ${res.status}`)
  return res.json() as T
}

// Fetch a scoreboard. Without `dates`, ESPN returns the current day only.
// Pass `dates` as YYYYMMDD to fetch a specific calendar day — used to pull a
// forward schedule window so out-of-season-today / off-day sports (playoff
// series with gaps, daily-but-already-final slates) still populate the board.
export async function fetchScoreboard(sport: SportKey, dates?: string): Promise<EspnScoreboard> {
  const path = ESPN_SPORT_PATHS[sport]
  if (!path) throw new Error(`Sport ${sport} not supported by ESPN`)
  const q = dates ? `?dates=${dates}` : ''
  return get<EspnScoreboard>(`/${path}/scoreboard${q}`)
}

// Fetch team roster
export async function fetchTeamRoster(sport: SportKey, teamId: string): Promise<EspnRoster> {
  const path = ESPN_SPORT_PATHS[sport]
  return get<EspnRoster>(`/${path}/teams/${teamId}/roster`)
}

// Fetch player news / injury reports
export async function fetchPlayerNews(sport: SportKey, playerId: string): Promise<EspnNews> {
  const path = ESPN_SPORT_PATHS[sport]
  return get<EspnNews>(`/${path}/athletes/${playerId}/news`)
}

// Fetch standings
export async function fetchStandings(sport: SportKey): Promise<unknown> {
  const path = ESPN_SPORT_PATHS[sport]
  return get<unknown>(`/${path}/standings`)
}

// Normalize ESPN scoreboard game to our Game shape
export function normalizeEspnGame(event: EspnEvent, sport: SportKey) {
  const competition = event.competitions[0]
  const home = competition.competitors.find(c => c.homeAway === 'home')
  const away = competition.competitors.find(c => c.homeAway === 'away')

  return {
    externalId: `espn_${event.id}`,
    sport,
    scheduledAt: event.date,
    status: mapEspnStatus(competition.status.type.name),
    homeTeamExternalId: home?.team.id,
    awayTeamExternalId: away?.team.id,
    homeTeamName: home?.team.displayName,
    awayTeamName: away?.team.displayName,
    homeTeamAbbr: home?.team.abbreviation,
    awayTeamAbbr: away?.team.abbreviation,
    homeScore: home?.score ? parseInt(home.score) : undefined,
    awayScore: away?.score ? parseInt(away.score) : undefined,
    period: competition.status.period,
    periodTime: competition.status.displayClock,
    broadcasts: competition.broadcasts?.map((b: { names: string[] }) => b.names).flat() ?? [],
  }
}

function mapEspnStatus(espnStatus: string): string {
  const map: Record<string, string> = {
    'STATUS_SCHEDULED': 'scheduled',
    'STATUS_IN_PROGRESS': 'live',
    'STATUS_HALFTIME': 'halftime',
    'STATUS_FINAL': 'final',
    'STATUS_POSTPONED': 'postponed',
    'STATUS_CANCELED': 'canceled',
  }
  return map[espnStatus] ?? 'scheduled'
}

// ESPN type stubs
export interface EspnScoreboard {
  events: EspnEvent[]
}

export interface EspnEvent {
  id: string
  date: string
  name: string
  competitions: EspnCompetition[]
}

export interface EspnCompetition {
  competitors: EspnCompetitor[]
  status: {
    type: { name: string; completed: boolean }
    period: number
    displayClock: string
  }
  broadcasts?: Array<{ names: string[] }>
}

export interface EspnCompetitor {
  team: { id: string; displayName: string; abbreviation: string; logo: string }
  homeAway: 'home' | 'away'
  score?: string
  statistics?: Array<{ name: string; value: string }>
}

// ESPN roster endpoint can return grouped or flat athlete arrays
export interface EspnRoster {
  // Grouped format: athletes[n].items[]
  athletes?: Array<{
    position?: { name: string; abbreviation: string } | string
    items?: EspnAthlete[]
  } | EspnAthlete>
  // Flat format: athlete[]
  athlete?: EspnAthlete[]
}

export interface EspnAthlete {
  id: string
  firstName?: string
  lastName?: string
  displayName?: string
  fullName?: string
  jersey?: string
  position?: { abbreviation?: string; name?: string } | string
  age?: number
  injuries?: Array<{ status: string; type: string }>
  headshot?: { href: string }
  status?: { id?: string; name?: string }
}

// Normalize ESPN roster response to a flat list of athletes (handles both formats)
export function normalizeRosterAthletes(roster: EspnRoster): EspnAthlete[] {
  const results: EspnAthlete[] = []

  // Flat format: roster.athlete
  if (Array.isArray(roster.athlete)) {
    return roster.athlete
  }

  // Grouped format: roster.athletes[n].items[] OR flat roster.athletes[]
  for (const entry of roster.athletes ?? []) {
    if (!entry) continue
    // Check if it's a position group with items
    const group = entry as { items?: EspnAthlete[] }
    if (Array.isArray(group.items)) {
      results.push(...group.items)
    } else if ((entry as EspnAthlete).id) {
      // It's a direct athlete
      results.push(entry as EspnAthlete)
    }
  }

  return results
}

export interface EspnNews {
  articles: Array<{
    headline: string
    description: string
    published: string
    links: { web: { href: string } }
  }>
}
