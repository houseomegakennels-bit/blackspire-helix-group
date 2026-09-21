# Blackspire London Dual-State V4 — Results

## Frozen design
V4 was preregistered before outcomes. It classifies a London Asia-range break as either:
- **REJECTION:** break then close back inside, reversal MSS + displacement/FVG, FVG-midpoint retrace entry.
- **ACCEPTANCE:** break and close outside, outside acceptance + continuation displacement/FVG, FVG-midpoint retrace entry while price remains outside.

Both branches use fixed 2R targets, the existing cost/slippage model, and branch-specific minimum-stop friction guards.

## 2009-2024 long-history EUR/USD proxy
- 443 total trades, 152 wins, 34.31% win rate.
- Net modeled P&L: **-$9,732.31** (-19.46% on $50k model).
- Expectancy: **-0.239R**; profit factor: **0.700**.
- Max drawdown: **$10,891.44 / 21.41%**; longest losing streak: 14.
- Positive net years: **4 of 16 (25%)**.
- Advancement gate: **FAIL**.

### Branches
- Rejection: 129 trades, 31.78% wins, -$4,108.13, -0.231R, PF 0.626.
- Acceptance: 314 trades, 35.35% wins, -$5,624.19, -0.242R, PF 0.737.

Acceptance improved hit rate and PF relative to rejection, but remained negative and did not rescue the combined strategy.

## 2026 robustness checks
### Direct M6E (Jan-Apr public history)
- 6 trades, 2 wins, -$286.50, -0.290R, PF 0.339.
- Rejection: 1 trade, 0 wins, -1.220R.
- Acceptance: 5 trades, 2 wins, -0.104R.

### Separate EUR/USD 2026 proxy
- 14 trades, 4 wins, -$442.13, -0.381R, PF 0.453.

## Decision
V4 is rejected for advancement. The long test and the direct M6E check both fail, so the dual-state formulation is not authorized for demo/live trading. The useful finding is that simple break acceptance versus rejection classification alone is insufficient; future work should move away from a fixed 2R London-only execution assumption and test whether the predictive information lies in *post-London NY behavior*, cross-session context, or a different market-state representation.
