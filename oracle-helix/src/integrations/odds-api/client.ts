// The Odds API — free tier: 500 req/mo | theoddsapi.com
import { ODDS_API_SPORT_KEYS } from '../../lib/constants.js'
import type { SportKey, MarketType } from '../../types/index.js'

const BASE = process.env.THE_ODDS_API_BASE || 'https://api.the-odds-api.com/v4'
const KEY = process.env.THE_ODDS_API_KEY

interface OddsApiEvent {
  id: string
  sport_key: string
  sport_title: string
  commence_time: string
  home_team: string
  away_team: string
  bookmakers: OddsApiBookmaker[]
}

interface OddsApiBookmaker {
  key: string
  title: string
  last_update: string
  markets: OddsApiMarket[]
}

interface OddsApiMarket {
  key: string
  last_update: string
  outcomes: OddsApiOutcome[]
}

interface OddsApiOutcome {
  name: string
  price: number
  point?: number
}

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!KEY) throw new Error('THE_ODDS_API_KEY not configured')
  const url = new URL(`${BASE}${path}`)
  url.searchParams.set('apiKey', KEY)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`Odds API error: ${res.status} ${res.statusText}`)
  return res.json() as T
}

export async function fetchOdds(sport: SportKey, markets: MarketType[] = ['spreads', 'h2h', 'totals']): Promise<OddsApiEvent[]> {
  const sportKey = ODDS_API_SPORT_KEYS[sport]
  if (!sportKey) throw new Error(`Sport ${sport} not supported by Odds API`)

  return get<OddsApiEvent[]>(`/sports/${sportKey}/odds`, {
    regions: 'us',
    markets: markets.join(','),
    oddsFormat: 'american',
    dateFormat: 'iso',
  })
}

export async function fetchEventOdds(sport: SportKey, eventId: string): Promise<OddsApiEvent> {
  const sportKey = ODDS_API_SPORT_KEYS[sport]
  if (!sportKey) throw new Error(`Sport ${sport} not supported`)

  return get<OddsApiEvent>(`/sports/${sportKey}/events/${eventId}/odds`, {
    regions: 'us',
    markets: 'spreads,h2h,totals',
    oddsFormat: 'american',
  })
}

// Player-prop market keys per sport (The Odds API). Player props are only
// available on the per-event endpoint and require a plan that includes them;
// on plans without props the API returns 422, which the caller must handle.
export const PLAYER_PROP_MARKETS: Partial<Record<SportKey, string[]>> = {
  NBA: ['player_points', 'player_rebounds', 'player_assists', 'player_threes'],
  WNBA: ['player_points', 'player_rebounds', 'player_assists'],
  NFL: ['player_pass_yds', 'player_rush_yds', 'player_reception_yds', 'player_anytime_td'],
  MLB: ['batter_hits', 'batter_home_runs', 'batter_total_bases', 'pitcher_strikeouts'],
  NHL: ['player_points', 'player_shots_on_goal', 'player_goals'],
}

export interface PlayerPropOutcome {
  stat_type: string       // market key, e.g. player_points
  player_name: string     // from outcome.description
  side: 'over' | 'under'  // from outcome.name
  line: number            // outcome.point
  price: number           // american odds
  sportsbookKey: string
  sportsbookName: string
}

// Fetch player props for a single event. Returns a flat list of outcomes.
// Throws if the plan/sport doesn't support props (caller catches per-game).
export async function fetchPlayerProps(sport: SportKey, eventId: string): Promise<PlayerPropOutcome[]> {
  const sportKey = ODDS_API_SPORT_KEYS[sport]
  if (!sportKey) throw new Error(`Sport ${sport} not supported`)
  const markets = PLAYER_PROP_MARKETS[sport]
  if (!markets || markets.length === 0) return []

  const event = await get<OddsApiEvent & { bookmakers: OddsApiBookmaker[] }>(
    `/sports/${sportKey}/events/${eventId}/odds`,
    { regions: 'us', markets: markets.join(','), oddsFormat: 'american', dateFormat: 'iso' },
  )

  const out: PlayerPropOutcome[] = []
  for (const book of event.bookmakers ?? []) {
    for (const market of book.markets ?? []) {
      for (const o of market.outcomes ?? []) {
        const desc = (o as OddsApiOutcome & { description?: string }).description
        if (!desc) continue // player props carry the player in `description`
        const side = o.name?.toLowerCase() === 'over' ? 'over'
                   : o.name?.toLowerCase() === 'under' ? 'under' : null
        if (!side || o.point == null) continue
        out.push({
          stat_type: market.key,
          player_name: desc,
          side,
          line: o.point,
          price: o.price,
          sportsbookKey: book.key,
          sportsbookName: book.title,
        })
      }
    }
  }
  return out
}

// Normalize Odds API format to our internal format
export function normalizeOddsEvent(event: OddsApiEvent, sport: SportKey) {
  const lines: Array<{
    sportsbookKey: string
    sportsbookName: string
    market: string
    outcomeName: string
    outcomeType: string
    price: number
    point?: number
    impliedProb: number
  }> = []

  for (const book of event.bookmakers) {
    for (const market of book.markets) {
      for (const outcome of market.outcomes) {
        lines.push({
          sportsbookKey: book.key,
          sportsbookName: book.title,
          market: market.key,
          outcomeName: outcome.name,
          outcomeType: outcome.name.toLowerCase().includes('over') ? 'over'
                     : outcome.name.toLowerCase().includes('under') ? 'under'
                     : outcome.name === event.home_team ? 'home' : 'away',
          price: outcome.price,
          point: outcome.point,
          impliedProb: americanToImpliedProb(outcome.price),
        })
      }
    }
  }

  return {
    externalId: event.id,
    sport,
    scheduledAt: event.commence_time,
    homeTeamName: event.home_team,
    awayTeamName: event.away_team,
    lines,
  }
}

function americanToImpliedProb(americanOdds: number): number {
  if (americanOdds < 0) return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100)
  return 100 / (americanOdds + 100)
}
