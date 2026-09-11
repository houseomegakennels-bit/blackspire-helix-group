# London Sweep Execution Backtest V2 — Preregistered Rules

Status: frozen before evaluating V2 outcomes.
Purpose: test whether a confirmation-and-retrace execution model improves on V1 without changing the underlying London/Asia liquidity premise.

## Instrument and data
- Primary: M6E 5-minute CME continuous-futures historical data.
- Robustness only: 6E 5-minute data; never substitutes for M6E evidence.
- Timezone: America/New_York.
- Asia range: 20:00-00:00 ET.
- London observation/entry window: 02:00-05:00 ET.

## Candidate
- Exactly one Asia extreme is swept during the London window.
- High sweep: high trades at least 1 tick above Asia high and subsequently closes back at/below Asia high.
- Low sweep: low trades at least 1 tick below Asia low and subsequently closes back at/above Asia low.
- If both Asia extremes are swept before entry, exclude the day.

## Confirmation sequence
After the first valid sweep, require all of the following in order before 05:00 ET:
1. Price closes back inside the Asia range.
2. A 3-bar market-structure shift occurs in the reversal direction using the most recent confirmed 3-bar swing.
3. A same-direction displacement candle has real body >= 1.5x the median real body of the previous 20 five-minute candles.
4. The displacement creates a three-candle FVG: bearish if current high < low two bars earlier; bullish if current low > high two bars earlier.

## Entry
- Use the first qualifying FVG only.
- Entry is a limit at the 50% midpoint of that FVG.
- Entry must be touched after FVG formation and before 05:00 ET; no same-bar fill on the FVG-creation bar.
- If not retraced by 05:00 ET, no trade.

## Risk and exits
- Stop: 1 tick beyond the London sweep extreme.
- Primary target: opposite Asia range extreme.
- Minimum reward:risk at entry: 1.5R after price-only distances; otherwise skip.
- If target is farther than 3R, cap target at 3R to avoid over-crediting extreme ranges.
- Time exit: 10:00 ET final available close if neither stop nor target is hit.
- If stop and target are both touched in one 5-minute bar, assume stop first.

## Costs and sizing
- Starting equity: $50,000.
- Risk budget: 0.5% of current equity per trade.
- Max position: 6 M6E contracts.
- M6E tick size/value: 0.00005 / $0.625 per contract.
- 6E robustness tick size/value: 0.00005 / $6.25 per contract.
- Slippage: 1 adverse tick on entry and 1 adverse tick on exit.
- Commission: $1.50 round turn per M6E contract; $4.00 round turn per 6E contract for robustness modeling.

## Success criteria
This is exploratory execution research, not authorization. Report trades, win rate, net P&L, profit factor, expectancy in R, max drawdown, losing streak, skipped-reason counts, and trade ledger. No parameter optimization is permitted after results are seen in V2; any change requires V3 preregistration.
