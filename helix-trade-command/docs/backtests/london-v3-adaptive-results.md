# Blackspire London Reversal V3 — Walk-Forward Results

## Method
V3 was preregistered before its walk-forward run. The frozen London sweep/reclaim/MSS/displacement/FVG setup remained intact. V3 added a minimum 15-tick friction guard and a once-per-year ridge regime model trained only on the previous four calendar years of completed base setups. Each evaluation year was therefore out-of-sample relative to its fitted model.

Evaluation window: 2013-2024. Historical source: HistData EUR/USD spot proxy normalized from fixed EST-no-DST to UTC and resampled to 5-minute bars. This is robustness research, not direct M6E validation.

## Aggregate V3 result
- Executed trades: 39
- Wins: 10
- Win rate: 25.64%
- Modeled net P&L: -$1,167.75
- Mean post-cost expectancy: -0.360R
- Profit factor: 0.602
- Max drawdown: $1,761.00 / 3.49%
- Positive-expectancy active years: 5 of 11

## Baseline V2 over the same years
- Trades: 364
- Wins: 102
- Win rate: 28.02%
- Modeled net P&L: -$5,151.38
- Mean post-cost expectancy: -0.864R
- Profit factor: 0.636
- Max drawdown: $5,553.38 / 11.02%

V3 reduced exposure and drawdown versus the unfiltered V2 baseline, but it did not create a positive edge and failed every preregistered advancement requirement.

## Additional fixed-target check
After the adaptive V3 failure, a separate development-only check tested fixed targets and minimum-stop guards without changing the entry pattern. The best 2009-2018 development combination among the tested grid was minimum 18-tick stop plus 2.5R target: 68 trades, 33.82% wins, -0.030R expectancy, PF 0.975. Applied to 2019-2024 it produced 17 trades, 23.53% wins, -0.377R expectancy, PF 0.619. Shortening or standardizing the target therefore did not rescue the reversal pattern.

## Decision
FAIL. Do not promote London V3 to demo or live automation. The evidence now points away from a reversal-only London sweep strategy. The next research family should explicitly model two London states: rejection/reversal versus accepted breakout/continuation, with rules frozen before testing.
