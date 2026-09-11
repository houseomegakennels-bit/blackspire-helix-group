# London V2 — Extended Historical Robustness Backtest

Status: robustness-only; does not replace direct M6E futures validation.

## Scope
- Frozen London V2 rules were not changed.
- Direct M6E remains primary. The freely available CME M6E 5-minute history currently covers Jan 20-Apr 15, 2026.
- To push farther back, EUR/USD spot bid data from HistData was used from 2009 through 2024 because M6E launched in 2009.
- HistData M1 timestamps are fixed EST without DST; preprocessing converts fixed EST -> UTC, after which the existing America/New_York session logic is used.
- A separate public EUR/USD 5-minute sample covering Mar-Sep 2026 was also tested.

## Long-history result (2009-2024 spot proxy)
- Trades: **459**
- Wins / losses: **125 / 334**
- Win rate: **27.23%**
- Net hypothetical M6E P&L: **$-6440.63**
- Return on $50k model: **-12.88%**
- Profit factor: **0.682**
- Expectancy: **-0.775R**
- Max drawdown: **$6778.88 / 13.47%**
- Longest losing streak: **14**

This fails the V2 advancement thresholds by a wide margin. The recent positive 2026 samples therefore should be treated as regime-specific until direct prospective M6E evidence proves otherwise.

## Year-by-year
| Year | Trades | Wins | Win rate | Net P&L | Expectancy | PF |
|---:|---:|---:|---:|---:|---:|---:|
| 2009 | 22 | 8 | 36.4% | $312.00 | -0.018R | 1.250 |
| 2010 | 31 | 7 | 22.6% | $-927.75 | -0.525R | 0.591 |
| 2011 | 19 | 5 | 26.3% | $241.12 | -0.240R | 1.182 |
| 2012 | 23 | 3 | 13.0% | $-914.63 | -0.878R | 0.270 |
| 2013 | 37 | 11 | 29.7% | $-261.38 | -0.607R | 0.821 |
| 2014 | 34 | 7 | 20.6% | $-411.38 | -1.582R | 0.634 |
| 2015 | 33 | 10 | 30.3% | $-474.75 | -0.288R | 0.708 |
| 2016 | 31 | 9 | 29.0% | $-690.00 | -0.495R | 0.536 |
| 2017 | 28 | 10 | 35.7% | $-158.25 | -0.310R | 0.829 |
| 2018 | 40 | 8 | 20.0% | $-901.50 | -2.039R | 0.424 |
| 2019 | 22 | 6 | 27.3% | $-154.88 | -1.388R | 0.735 |
| 2020 | 25 | 6 | 24.0% | $-724.13 | -1.195R | 0.398 |
| 2021 | 21 | 8 | 38.1% | $-25.88 | -0.402R | 0.957 |
| 2022 | 39 | 10 | 25.6% | $-648.75 | -0.487R | 0.655 |
| 2023 | 23 | 8 | 34.8% | $-255.38 | -0.294R | 0.666 |
| 2024 | 31 | 9 | 29.0% | $-445.13 | -0.917R | 0.511 |

## 2026 public EUR/USD proxy sample
- Trades: **11**
- Wins / losses: **6 / 5**
- Win rate: **54.55%**
- Net hypothetical M6E P&L: **$138.75**
- Profit factor: **1.636**
- Expectancy: **0.309R**

The 2026 sample is positive, but its 11 trades are too few and conflict with the much larger 2009-2024 robustness sample.

## Decision
- Do **not** promote V2 based on historical backtests.
- Keep the frozen prospective M6E collector running because genuinely unseen direct-futures data is still the cleanest test.
- No broker/demo/live execution authorization.
- Any V3 redesign must be preregistered and should specifically investigate why V2 only appears favorable in recent conditions.
