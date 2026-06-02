// Positive EV & No-Vig Calculator
import type { Odds, EvCalculation } from '../../types/index.js'

interface OddsGroup {
  gameId: string
  market: string
  outcomes: Array<{ price: number; outcomeType: string; sportsbookId: string; sportsbook: string }>
}

// Remove vig and get true probabilities
export function removeVig(prices: number[]): number[] {
  const rawProbs = prices.map(americanToProb)
  const totalProb = rawProbs.reduce((a, b) => a + b, 0)
  return rawProbs.map(p => p / totalProb)  // normalize to 100%
}

// Calculate EV% against true probability
export function calculateEv(price: number, trueProb: number): number {
  const decimalOdds = americanToDecimal(price)
  return (decimalOdds * trueProb) - 1
}

// Kelly Criterion fraction
export function kellyFraction(price: number, trueProb: number): number {
  const decimalOdds = americanToDecimal(price)
  const b = decimalOdds - 1
  return Math.max(0, (b * trueProb - (1 - trueProb)) / b)
}

// Find positive EV opportunities across sportsbooks
export function findPositiveEv(
  gameId: string,
  playerId: string | undefined,
  oddsGroups: OddsGroup[]
): Omit<EvCalculation, 'id' | 'calculatedAt'>[] {
  const results: Omit<EvCalculation, 'id' | 'calculatedAt'>[] = []

  for (const group of oddsGroups) {
    // Group by outcome type to find the consensus market
    const byOutcome: Record<string, number[]> = {}
    for (const o of group.outcomes) {
      if (!byOutcome[o.outcomeType]) byOutcome[o.outcomeType] = []
      byOutcome[o.outcomeType].push(o.price)
    }

    const outcomeTypes = Object.keys(byOutcome)
    if (outcomeTypes.length < 2) continue

    // Use consensus (average) to establish no-vig line
    const consensusPrices = outcomeTypes.map(ot => {
      const prices = byOutcome[ot]
      return prices.reduce((a, b) => a + b, 0) / prices.length
    })
    const trueProbs = removeVig(consensusPrices)

    // Check each individual book line for +EV
    outcomeTypes.forEach((outcomeType, idx) => {
      const trueProb = trueProbs[idx]
      for (const outcome of group.outcomes.filter(o => o.outcomeType === outcomeType)) {
        const ev = calculateEv(outcome.price, trueProb)
        const kelly = kellyFraction(outcome.price, trueProb)
        const isPositiveEv = ev > 0.02  // > 2% EV threshold

        results.push({
          gameId,
          playerId,
          sportsbookId: outcome.sportsbookId,
          market: group.market as any,
          outcomeType,
          price: outcome.price,
          noVigProb: trueProb,
          evPct: ev,
          kellyFraction: kelly,
          isPositiveEv,
        })
      }
    })
  }

  return results.filter(r => r.isPositiveEv)
}

// Detect arbitrage opportunities
export function detectArbitrage(
  oddsGroups: OddsGroup[]
): Array<{
  market: string
  book1Key: string
  book2Key: string
  outcome1: string
  outcome2: string
  price1: number
  price2: number
  arbPct: number
}> {
  const opportunities = []

  for (const group of oddsGroups) {
    const outcomes = [...new Set(group.outcomes.map(o => o.outcomeType))]
    if (outcomes.length !== 2) continue

    const [o1, o2] = outcomes
    const best1 = Math.max(...group.outcomes.filter(o => o.outcomeType === o1).map(o => o.price))
    const best2 = Math.max(...group.outcomes.filter(o => o.outcomeType === o2).map(o => o.price))
    const book1 = group.outcomes.find(o => o.outcomeType === o1 && o.price === best1)!
    const book2 = group.outcomes.find(o => o.outcomeType === o2 && o.price === best2)!

    const prob1 = americanToProb(best1)
    const prob2 = americanToProb(best2)
    const totalImplied = prob1 + prob2

    if (totalImplied < 1.0) {
      opportunities.push({
        market: group.market,
        book1Key: book1.sportsbook,
        book2Key: book2.sportsbook,
        outcome1: o1,
        outcome2: o2,
        price1: best1,
        price2: best2,
        arbPct: (1 - totalImplied) * 100,
      })
    }
  }

  return opportunities
}

function americanToProb(americanOdds: number): number {
  if (americanOdds < 0) return Math.abs(americanOdds) / (Math.abs(americanOdds) + 100)
  return 100 / (americanOdds + 100)
}

function americanToDecimal(americanOdds: number): number {
  if (americanOdds < 0) return 1 + (100 / Math.abs(americanOdds))
  return 1 + (americanOdds / 100)
}
