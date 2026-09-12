# Blackspire London Reversal V3 — Adaptive Regime Filter

Status: preregistered before walk-forward results are evaluated.
Purpose: retain the London sweep/reclaim execution pattern while adapting participation to changing market regimes without future leakage.

## Base setup (unchanged from V2)
- Asia range: 20:00-00:00 America/New_York.
- London window: 02:00-05:00 ET.
- Exactly one Asia extreme is swept and price closes back inside the Asia range.
- Require confirmed 3-bar MSS in the reversal direction.
- Require displacement body >= 1.5x the prior-20 median body and a 3-candle FVG.
- Enter first retrace to the first qualifying FVG midpoint before 05:00 ET.
- Stop 1 tick beyond the sweep extreme.
- Target opposite Asia extreme, minimum 1.5R, capped at 3R.
- Same slippage, commission, sizing, time-exit, and conservative same-bar assumptions as V2.

## Structural friction guard
- Skip if reference stop distance is < 15 M6E ticks.
- Rationale: fixed 2-tick round-trip slippage plus commission overwhelms very small stops in the prior execution tests.

## Adaptive regime score
At the start of each calendar year, fit a ridge-linear model using only completed base-setups from the previous 4 calendar years. No current-year outcome is used until the next annual retrain.

Features known before entry:
1. log Asia range in ticks
2. Asia range / trailing-20 Asia-range median
3. signed Asia drift toward the swept extreme
4. sweep depth / Asia range
5. MSS lag minutes from sweep
6. displacement lag minutes from sweep
7. displacement body / prior-20 median body
8. FVG width / Asia range
9. entry minutes after 02:00 ET
10. retrace lag minutes after displacement
11. log stop distance in ticks
12. capped price RR (min(RR, 6))
13. Asia range / prior-24h range

Training target: realized post-cost R multiple from the frozen V2 execution engine.
- Standardize each feature using training-window mean/std only.
- Ridge penalty lambda = 5.0; intercept unpenalized.
- Minimum training sample = 80 completed setups. Otherwise no V3 trades that year.
- Annual fixed model: no intra-year updates.
- Take a setup only if predicted post-cost R > +0.10R and stop >=15 ticks.

## Walk-forward evaluation
- Earliest evaluation year: 2013, if the 2009-2012 training window has >=80 setups.
- Continue yearly through 2024.
- Each year is strictly out-of-sample relative to its model fit.
- Report trades, win rate, net modeled P&L, expectancy R, profit factor, max drawdown, and results by year.
- Compare against all frozen V2 base trades over the same walk-forward years.

## Decision rule
This is research only. V3 is historically promising only if the complete walk-forward series has:
- >=100 executed trades,
- expectancy > +0.10R,
- profit factor >=1.25,
- positive net modeled P&L,
- and positive expectancy in at least 60% of evaluated calendar years.

Even a historical PASS does not authorize demo/live trading. Direct prospective M6E evidence remains required.
