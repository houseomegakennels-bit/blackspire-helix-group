// ============================================================
// ORACLE HELIX — Core TypeScript Types
// ============================================================

export type SportKey = 'NBA' | 'NFL' | 'MLB' | 'NHL' | 'WNBA' | 'PGA' | 'UFC' | 'SOCCER' | 'NCAA_BB' | 'NCAA_FB' | 'TENNIS' | 'NASCAR' | 'ESPORTS'
export type MarketType = 'h2h' | 'spreads' | 'totals' | 'outrights' | 'player_props' | 'team_props' | 'alternate_spreads' | 'alternate_totals' | 'first_half' | 'second_half'
export type GameStatus = 'scheduled' | 'live' | 'halftime' | 'final' | 'postponed' | 'canceled' | 'suspended'
export type SubscriptionTier = 'free' | 'starter' | 'pro' | 'elite' | 'enterprise'
export type AgentType = 'research' | 'risk' | 'market' | 'prop' | 'weather' | 'narrative' | 'simulation' | 'coach'

// ---- SPORTS DATA TYPES -------------------------------------
export interface Game {
  id: string
  sport: SportKey
  externalId?: string
  season: string
  seasonType: string
  scheduledAt: string
  status: GameStatus
  homeTeamId: string
  awayTeamId: string
  homeScore?: number
  awayScore?: number
  period?: number
  periodTime?: string
  stadiumId?: string
  homeTeam?: Team
  awayTeam?: Team
  stadium?: Stadium
  oddsSnapshot?: OddsSnapshot
  weatherImpact?: number
}

export interface Team {
  id: string
  sport: SportKey
  abbreviation: string
  name: string
  city: string
  fullName: string
  conference?: string
  division?: string
  logoUrl?: string
  primaryColor?: string
  stadiumId?: string
}

export interface Player {
  id: string
  sport: SportKey
  teamId?: string
  externalId?: string
  firstName: string
  lastName: string
  fullName: string
  position?: string
  jerseyNumber?: string
  age?: number
  status: string
  headshotUrl?: string
  team?: Team
}

export interface PlayerInjury {
  id: string
  playerId: string
  injuryType: string
  bodyPart?: string
  status: string
  description?: string
  reportedAt: string
  expectedReturn?: string
  isActive: boolean
}

export interface Stadium {
  id: string
  name: string
  city: string
  state?: string
  isDome: boolean
  capacity?: number
  surface?: string
  latitude?: number
  longitude?: number
  sport?: SportKey
}

// ---- ODDS & MARKET TYPES -----------------------------------
export interface Odds {
  id: string
  gameId: string
  sportsbookId: string
  market: MarketType
  outcomeName: string
  outcomeType: string
  price: number
  point?: number
  impliedProb?: number
  fetchedAt: string
  sportsbook?: Sportsbook
}

export interface OddsSnapshot {
  spread?: OddsLine[]
  total?: OddsLine[]
  h2h?: OddsLine[]
}

export interface OddsLine {
  book: string
  outcome: string
  price: number
  point?: number
}

export interface LineMovement {
  id: string
  gameId: string
  sportsbookId: string
  market: MarketType
  outcomeType: string
  priceOld: number
  priceNew: number
  pointOld?: number
  pointNew?: number
  movedAt: string
  moveMagnitude?: number
}

export interface Prop {
  id: string
  gameId: string
  playerId: string
  sportsbookId: string
  statType: string
  line: number
  overPrice: number
  underPrice: number
  overProb?: number
  underProb?: number
  bestBook?: string
  bestBookPrice?: number
  isAlternate: boolean
  fetchedAt: string
  player?: Player
}

export interface Sportsbook {
  id: string
  key: string
  name: string
  logoUrl?: string
  affiliateUrl?: string
  isActive: boolean
}

export interface SharpSignal {
  id: string
  gameId: string
  market: MarketType
  outcomeType: string
  signalType: string
  confidence: number
  description?: string
  triggeredAt: string
}

export interface MarketPsychology {
  id: string
  gameId: string
  market: MarketType
  publicFadeSignal: boolean
  sharpConsensus?: number
  lineMovementScore?: number
  volatilityScore?: number
  overreactionFlag: boolean
  narrativeBiasScore?: number
  injuryAdjustment?: number
  summary?: string
  calculatedAt: string
}

export interface EvCalculation {
  id: string
  gameId: string
  playerId?: string
  sportsbookId: string
  market: MarketType
  outcomeType: string
  price: number
  noVigProb?: number
  evPct: number
  kellyFraction?: number
  isPositiveEv: boolean
  calculatedAt: string
  sportsbook?: Sportsbook
  matchup?: string
  playerName?: string
}

export interface WeatherData {
  id: string
  gameId: string
  stadiumId?: string
  forecastTime: string
  temperatureF?: number
  humidity?: number
  windSpeedMph?: number
  windDirection?: string
  windGustMph?: number
  precipitationIn?: number
  precipChance?: number
  condition?: string
  cloud_cover_pct?: number
  dew_point_f?: number
  airDensity?: number
  impactScore?: number
  impactSummary?: string
}

// ---- AI TYPES ----------------------------------------------
export interface AiMemory {
  id: string
  userId: string
  memoryType: string
  sport?: SportKey
  key: string
  value: unknown
  confidence: number
  source: string
  expiresAt?: string
}

export interface AiSession {
  id: string
  userId: string
  agentType: AgentType
  title?: string
  messages: ChatMessage[]
  context: Record<string, unknown>
  isActive: boolean
  createdAt: string
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  agentType?: AgentType
}

export interface AiResearchCard {
  id: string
  gameId?: string
  playerId?: string
  teamId?: string
  cardType: string
  sport?: SportKey
  title: string
  headline: string
  content: string
  insights: ResearchInsight[]
  tags: string[]
  agentType?: string
  generatedAt: string
}

export interface ResearchInsight {
  key: string
  value: string | number
  confidence: number
}

// ---- BETDNA TYPES ------------------------------------------
export interface BetDnaProfile {
  id: string
  userId: string
  sport?: SportKey
  totalBetsTracked: number
  wins: number
  losses: number
  pushes: number
  roiPct: number
  roiByMarket: Record<string, number>
  roiBySport: Record<string, number>
  tiltScore: number
  emotionalPatterns: Record<string, unknown>
  disciplineScore: number
  confidenceAccuracy?: number
  hotStreakFlag: boolean
  coldStreakFlag: boolean
  bestMarket?: string
  worstMarket?: string
}

export interface BetEntry {
  id: string
  userId: string
  gameId?: string
  playerId?: string
  sportsbookId?: string
  sport: SportKey
  market: MarketType
  selection: string
  odds: number
  point?: number
  stake: number
  stakeType: 'units' | 'dollars'
  result?: 'win' | 'loss' | 'push' | 'void'
  profitLoss?: number
  closingOdds?: number
  confidenceLevel?: number
  notes?: string
  betPlacedAt: string
  gameStartsAt?: string
  settledAt?: string
}

// ---- SIMULATION TYPES -------------------------------------
export interface SimulationParams {
  gameId?: string
  playerId?: string
  sport: SportKey
  simType: 'game' | 'prop' | 'lineup' | 'weather' | 'injury' | 'scenario'
  iterations?: number
  parameters: Record<string, unknown>
}

export interface SimulationResult {
  id: string
  status: 'pending' | 'running' | 'complete' | 'error'
  homeWinProb?: number
  awayWinProb?: number
  overProb?: number
  confidenceInterval?: { low: number; high: number; pct: number }
  probabilityCurve?: Array<{ score: number; probability: number }>
  scenarioTree?: ScenarioNode[]
  results: Record<string, unknown>
  runTimeMs?: number
  completedAt?: string
}

export interface ScenarioNode {
  id: string
  description: string
  probability: number
  outcome: string
  children?: ScenarioNode[]
}

// ---- MATCHUP REPORT ----------------------------------------
export interface MatchupReport {
  id: string
  gameId: string
  offensiveEdge?: 'home' | 'away' | 'even'
  defensiveEdge?: 'home' | 'away' | 'even'
  homeWinProb?: number
  awayWinProb?: number
  overProb?: number
  underProb?: number
  keyMatchups: KeyMatchup[]
  atsTrends: AtsTrends
  fatigueScore: { home: number; away: number }
  travelScore: { home: number; away: number }
  coachingNotes?: string
  environmentScore?: number
  weatherImpact?: number
  summary: string
  generatedAt: string
}

export interface KeyMatchup {
  playerVs: string
  advantage: 'home' | 'away' | 'even'
  description: string
}

export interface AtsTrends {
  home?: { record: string; pct: number }
  away?: { record: string; pct: number }
  overall?: { record: string; pct: number }
}

// ---- API RESPONSE WRAPPERS ---------------------------------
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
  meta?: {
    total?: number
    page?: number
    limit?: number
    cached?: boolean
    fetchedAt?: string
  }
}

export interface PaginationParams {
  page?: number
  limit?: number
  sport?: SportKey
  date?: string
}
