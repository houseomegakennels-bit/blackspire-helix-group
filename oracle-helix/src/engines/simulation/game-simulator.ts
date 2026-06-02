// Game Simulation Engine — Monte Carlo
import type { SimulationParams, SimulationResult, ScenarioNode } from '../../types/index.js'

interface GameSimInput {
  sport: string
  homeTeamStrength: number  // 0-100
  awayTeamStrength: number  // 0-100
  homeAdvantage: number     // 0-10 HFA points
  weatherImpact: number     // 0-1
  injuryImpact: { home: number; away: number }  // 0-1 penalty
  spread?: number
  total?: number
}

export async function runGameSimulation(params: SimulationParams): Promise<SimulationResult> {
  const startTime = Date.now()
  const iterations = params.iterations ?? 10000
  const input = params.parameters as unknown as GameSimInput

  const results = {
    homeWins: 0,
    awayWins: 0,
    ties: 0,
    scores: [] as number[],
    homeScores: [] as number[],
    awayScores: [] as number[],
    spreadResults: [] as number[],
  }

  const homeStr = (input.homeTeamStrength ?? 75) * (1 - (input.injuryImpact?.home ?? 0))
  const awayStr = (input.awayTeamStrength ?? 75) * (1 - (input.injuryImpact?.away ?? 0))
  const hfa = input.homeAdvantage ?? 3
  const weatherPenalty = (input.weatherImpact ?? 0) * 5  // points off scoring

  for (let i = 0; i < iterations; i++) {
    const { homeScore, awayScore } = simulateSingleGame({
      sport: params.sport,
      homeStr,
      awayStr,
      hfa,
      weatherPenalty,
    })

    const total = homeScore + awayScore
    const spread = homeScore - awayScore

    if (homeScore > awayScore) results.homeWins++
    else if (awayScore > homeScore) results.awayWins++
    else results.ties++

    results.scores.push(total)
    results.homeScores.push(homeScore)
    results.awayScores.push(awayScore)
    results.spreadResults.push(spread)
  }

  const homeWinProb = results.homeWins / iterations
  const awayWinProb = results.awayWins / iterations
  const avgTotal = results.scores.reduce((a, b) => a + b, 0) / iterations
  const overProb = input.total
    ? results.scores.filter(s => s > input.total!).length / iterations
    : undefined

  const probabilityCurve = buildProbabilityCurve(results.scores)
  const ci = confidenceInterval(results.scores, 0.95)

  return {
    id: crypto.randomUUID(),
    status: 'complete',
    homeWinProb,
    awayWinProb,
    overProb,
    confidenceInterval: ci,
    probabilityCurve,
    scenarioTree: buildScenarioTree(homeWinProb, awayWinProb, params.sport),
    results: {
      iterations,
      avgTotal,
      avgSpread: results.spreadResults.reduce((a, b) => a + b, 0) / iterations,
      homeScoreAvg: results.homeScores.reduce((a, b) => a + b, 0) / iterations,
      awayScoreAvg: results.awayScores.reduce((a, b) => a + b, 0) / iterations,
    },
    runTimeMs: Date.now() - startTime,
    completedAt: new Date().toISOString(),
  }
}

function simulateSingleGame(params: {
  sport: string
  homeStr: number
  awayStr: number
  hfa: number
  weatherPenalty: number
}): { homeScore: number; awayScore: number } {
  const basePPG = getSportBasePPG(params.sport)
  const homeAdj = (params.homeStr / 100) + (params.hfa / 100)
  const awayAdj = params.awayStr / 100

  const homeScore = Math.max(0, Math.round(
    basePPG * homeAdj + gaussianNoise(0, basePPG * 0.15) - params.weatherPenalty * 0.5
  ))
  const awayScore = Math.max(0, Math.round(
    basePPG * awayAdj + gaussianNoise(0, basePPG * 0.15) - params.weatherPenalty * 0.5
  ))

  return { homeScore, awayScore }
}

function getSportBasePPG(sport: string): number {
  const baselines: Record<string, number> = {
    NBA: 112,
    NFL: 23,
    MLB: 4.5,
    NHL: 3.0,
    WNBA: 80,
  }
  return baselines[sport] ?? 50
}

function gaussianNoise(mean: number, stddev: number): number {
  // Box-Muller transform
  const u = 1 - Math.random()
  const v = Math.random()
  return mean + stddev * Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v)
}

function buildProbabilityCurve(scores: number[]): Array<{ score: number; probability: number }> {
  const freq: Record<number, number> = {}
  for (const s of scores) {
    const bucket = Math.round(s / 2) * 2  // 2-point buckets
    freq[bucket] = (freq[bucket] ?? 0) + 1
  }
  const total = scores.length
  return Object.entries(freq)
    .map(([score, count]) => ({ score: Number(score), probability: count / total }))
    .sort((a, b) => a.score - b.score)
}

function confidenceInterval(values: number[], confidence: number): { low: number; high: number; pct: number } {
  const sorted = [...values].sort((a, b) => a - b)
  const tail = (1 - confidence) / 2
  return {
    low: sorted[Math.floor(sorted.length * tail)],
    high: sorted[Math.floor(sorted.length * (1 - tail))],
    pct: confidence * 100,
  }
}

function buildScenarioTree(homeWinProb: number, awayWinProb: number, sport: string): ScenarioNode[] {
  return [
    {
      id: 'home-win',
      description: 'Home team wins',
      probability: homeWinProb,
      outcome: 'home_win',
      children: [
        {
          id: 'home-win-covers',
          description: 'Wins and covers spread',
          probability: homeWinProb * 0.6,
          outcome: 'home_cover',
        },
        {
          id: 'home-win-no-cover',
          description: 'Wins but does not cover',
          probability: homeWinProb * 0.4,
          outcome: 'home_no_cover',
        },
      ],
    },
    {
      id: 'away-win',
      description: 'Away team wins',
      probability: awayWinProb,
      outcome: 'away_win',
      children: [
        {
          id: 'away-win-covers',
          description: 'Away wins and covers',
          probability: awayWinProb * 0.55,
          outcome: 'away_cover',
        },
        {
          id: 'away-win-no-cover',
          description: 'Away wins but does not cover',
          probability: awayWinProb * 0.45,
          outcome: 'away_no_cover',
        },
      ],
    },
  ]
}
