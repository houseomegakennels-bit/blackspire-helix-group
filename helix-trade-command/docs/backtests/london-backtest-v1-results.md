# London Pattern Backtest V1 — Results

## Scope
Research-only historical execution simulation on the public M6E 5-minute dataset `M6E_5min_20260120_20260415.csv` (SHA-256 `2063a184f4be50b0344b6ef25362e5b0718476500d5e22c3a01a8a1b7be05682`). The execution rules were frozen in `london-backtest-v1-spec.md` before results were run.

Data window: 2026-01-20 14:45 UTC through 2026-04-15 23:25 UTC. Starting equity is $50,000 per variant. Risk budget is 0.50% of current equity, max 6 M6E contracts, 1 tick adverse slippage on entry and exit, $1.50 round-turn commission/fees per contract, and a 2R target.

## Results

| Metric | Original London single-sweep (A) | R1-H1 confirmation |
| --- | ---: | ---: |
| Executed trades | 13 | 4 |
| Wins / losses | 7 / 6 | 0 / 4 |
| Win rate | 53.85% | 0.00% |
| Net P&L | **+$193.50** | **-$433.50** |
| Return on $50k | +0.387% | -0.867% |
| Average trade | +$14.88 | -$108.37 |
| Expectancy | -0.162R | -0.919R |
| Profit factor | 1.326 | 0.000 |
| Max drawdown | $306.00 / 0.607% | $433.50 / 0.867% |
| Longest losing streak | 2 | 4 |
| Average contracts | 5.85 | 6.00 |
| Stops / targets / time exits | 6 / 3 / 4 | 2 / 0 / 2 |

## Interpretation
The original single-sweep variant produced a small positive dollar result in this sample, but it is **not a validated edge**. Only 13 trades were executable under the frozen stop rule, and expectancy measured in normalized R was negative because risk size varied substantially across trades. The sample is far too small for a production decision, and it follows the earlier premise test that already failed the preregistered evidence gate.

R1-H1 produced four executable confirmed trades and all four lost under the frozen entry/stop/2R execution rules. This does not contradict the earlier 3/4 directional-close debug result: that earlier statistic only asked whether the 10:00 ET close finished in the expected direction relative to the NY open. A real trade entered after MSS/displacement can still stop out or finish negative before/at the time exit. This backtest therefore shows why directional accuracy and executable strategy profitability must be kept separate.

## Important sample mechanics
The historical dataset produced 21 complete single-London-sweep candidates after the existing 85% session-quality gate. Eight of those did not produce an executable Variant A trade because the 07:00 NY reference entry was already beyond the frozen London-extreme stop level, making the stop invalid for the intended reversal direction. Those days were skipped rather than given an artificial stop.

The R1-H1 event count was reconciled against the existing frozen research validator. A later NY bar that swept both Asia extremes invalidates that day as ambiguous even if an earlier same-side sweep occurred; after enforcing that rule, the backtester matches the validator at four R1-H1 events.

## Decision
**Do not promote either V1 execution model to live/demo automation.** Preserve these results as descriptive research. The prospective R1 evidence pipeline remains the authoritative validation track beginning 2026-09-12. Any V2 execution model must be specified before rerunning results and must not reinterpret this sample as out-of-sample evidence.
